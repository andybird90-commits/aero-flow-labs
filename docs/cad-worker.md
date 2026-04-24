# CAD Worker — HTTP Contract (CadQuery reference)

## Design rule (read this first)

> **The AI never writes CadQuery code.**
> The AI only generates **validated parameters** for **trusted builder
> functions** that the worker already implements. The worker decides which
> builder to call based on `builder` in the request payload.

This eliminates the entire class of "AI hallucinated an unbuildable sketch"
failures (open profiles, self-intersecting splines, zero-area faces, etc.).
Adding new part types is a code change in the worker, not a prompt change.

---

## Endpoints

### `POST /jobs`

Auth: `Authorization: Bearer <CAD_WORKER_TOKEN>` required.

**Request — v2 (current, builder-based)**
```json
{
  "builder": "build_front_arch",
  "part_type": "front_arch",
  "part_kind": "front_arch",
  "params": {
    "side": "left",
    "radius": 330,
    "arch_width": 90,
    "flare_out": 55,
    "thickness": 3,
    "lip_return": 18,
    "length_front": 380,
    "length_rear": 480,
    "height_above_wheel": 100
  },
  "inputs": {
    "base_mesh_url": "https://.../car.stl"
  }
}
```

The worker MUST:
1. Look `builder` up in its trusted-builder registry. Reject unknown builders with HTTP 400.
2. Re-validate `params` against the builder's schema (defence in depth — Lovable already validates).
3. Call the builder.
4. Export the result as STEP, STL, GLB, plus a small preview PNG.
5. Upload outputs to a publicly fetchable host and return the URLs in `GET /jobs/:id`.

**Request — v1 (legacy free-form recipe, deprecated)**
Still accepted for backward compatibility. If `recipe.features[]` is present
the worker should run the legacy interpreter. New parts should NOT use this
path.

**Response (both)**
```json
{ "task_id": "cad-abc-123" }
```

### `GET /jobs/:task_id`

Same as before:

```json
{ "status": "running", "progress": 0.42 }
```
```json
{
  "status": "succeeded",
  "progress": 1,
  "outputs": {
    "step_url":        "https://.../part.step",
    "stl_url":         "https://.../part.stl",
    "glb_url":         "https://.../part.glb",
    "preview_png_url": "https://.../preview.png"
  }
}
```
```json
{ "status": "failed", "error": "validation: radius=0.5 below min 200" }
```

---

## Trusted builders (v2)

All dimensions in **millimetres**. Vehicle-local coordinates: forward = -Z,
up = +Y, right = +X.

### `build_front_arch`

Solid wheel arch / fender flare for the front. Curved sweep around the wheel
with optional outward flare and an inward lip return. Built standalone — does
NOT need the car STL to succeed.

| param | type | range | required | default | meaning |
|-------|------|-------|----------|---------|---------|
| `side` | enum | `left` / `right` | ✔ | `left` | which side of the car |
| `radius` | number | 200–600 mm | ✔ | 330 | wheel arch radius |
| `arch_width` | number | 30–250 mm | ✔ | 90 | width along tyre axis (X) |
| `flare_out` | number | 0–200 mm | ✔ | 55 | outward flare beyond the body |
| `thickness` | number | 1–20 mm | ✔ | 3 | panel wall thickness |
| `lip_return` | number | 0–60 mm | ✔ | 18 | inward return lip depth |
| `length_front` | number | 50–800 mm | ✔ | 380 | extent forward of wheel centre |
| `length_rear` | number | 50–800 mm | ✔ | 480 | extent rearward of wheel centre |
| `height_above_wheel` | number | 20–400 mm | ✖ | 100 | how high above the wheel centre the arch reaches |
| `wheel_centre` | `[x,y,z]` | — | ✖ | — | optional translate to vehicle wheel-centre |

More builders (`build_rear_arch`, `build_splitter_blade`, `build_side_skirt`,
`build_wing_blade`, `build_canard`…) get added the same way — register the
schema in Lovable's `BUILDERS` list AND implement the function in the worker.

---

## Reference Python implementation

```python
# worker.py — minimal, builder-based
from __future__ import annotations
from typing import Any, Callable
import math
import cadquery as cq

# ---------- validation ----------

class ValidationError(Exception): pass

def _v_num(p: dict, k: str, lo: float, hi: float, default: float | None = None, required: bool = True):
    v = p.get(k, default)
    if v is None:
        if required: raise ValidationError(f'missing required param "{k}"')
        return None
    try: v = float(v)
    except Exception: raise ValidationError(f'param "{k}" must be a number, got {v!r}')
    if not math.isfinite(v): raise ValidationError(f'param "{k}" not finite')
    if v < 1.0 and any(s in k for s in ("radius","width","thickness","length")):
        raise ValidationError(f'dimension "{k}"={v}mm sub-millimetre, rejected')
    if v < lo or v > hi: raise ValidationError(f'param "{k}"={v} outside [{lo},{hi}]')
    return v

def _v_enum(p: dict, k: str, values: list[str], default: str | None = None, required: bool = True):
    v = p.get(k, default)
    if v is None:
        if required: raise ValidationError(f'missing required param "{k}"')
        return None
    if v not in values: raise ValidationError(f'param "{k}" must be one of {values}, got {v!r}')
    return v

def _v_vec3(p: dict, k: str, required: bool = False):
    v = p.get(k)
    if v is None:
        if required: raise ValidationError(f'missing required param "{k}"')
        return None
    if not (isinstance(v, (list, tuple)) and len(v) == 3): raise ValidationError(f'param "{k}" must be [x,y,z]')
    try: return [float(x) for x in v]
    except Exception: raise ValidationError(f'param "{k}" must be 3 numbers')

# ---------- builder: build_front_arch ----------

def build_front_arch(params: dict) -> cq.Workplane:
    """
    Builds a curved front wheel arch / fender flare as a SOLID body.
    Stage-1 contract: standalone in empty space, no car-STL trim.
    """
    side               = _v_enum(params, "side", ["left","right"], default="left")
    radius             = _v_num(params, "radius", 200, 600, default=330)
    arch_width         = _v_num(params, "arch_width", 30, 250, default=90)
    flare_out          = _v_num(params, "flare_out", 0, 200, default=55)
    thickness          = _v_num(params, "thickness", 1, 20, default=3)
    lip_return         = _v_num(params, "lip_return", 0, 60, default=18)
    length_front       = _v_num(params, "length_front", 50, 800, default=380)
    length_rear        = _v_num(params, "length_rear", 50, 800, default=480)
    height_above_wheel = _v_num(params, "height_above_wheel", 20, 400, default=100, required=False)
    wheel_centre       = _v_vec3(params, "wheel_centre", required=False)

    # Sweep angle controlled by length_front / length_rear projected onto the arch.
    span_front_deg = math.degrees(min(math.pi, length_front / radius))
    span_rear_deg  = math.degrees(min(math.pi, length_rear  / radius))
    a_start = 90.0 - span_front_deg     # measured from +Y (up), going forward (-Z)
    a_end   = 90.0 + span_rear_deg

    # Build cross-section in the YZ plane: an L-shaped panel = main flare + inward lip.
    half_w = arch_width / 2.0
    flare_pts = [
        (-half_w, 0),
        ( half_w, 0),
        ( half_w + flare_out * 0.0, -thickness),  # outer face stays flush radially
        (-half_w,                  -thickness),
    ]
    cross_section = (
        cq.Sketch()
        .polygon([(half_w, 0),
                  (half_w + flare_out, 0),
                  (half_w + flare_out, -thickness),
                  (-half_w - flare_out, -thickness),
                  (-half_w - flare_out, 0),
                  (-half_w, 0),
                  (-half_w, lip_return),
                  (-half_w - thickness, lip_return),
                  (-half_w - thickness, -thickness - lip_return),
                  ( half_w + thickness, -thickness - lip_return),
                  ( half_w + thickness, lip_return),
                  ( half_w, lip_return),
                  (half_w, 0)])
        .assemble()
    )

    # Sweep that cross-section along an arc of `radius` from a_start to a_end
    # in the XY plane (will rotate to wheel orientation after).
    arc_pts = []
    n = 24
    for i in range(n + 1):
        t = i / n
        ang = math.radians(a_start + (a_end - a_start) * t)
        arc_pts.append((radius * math.cos(ang), radius * math.sin(ang), 0))

    path = cq.Workplane("XY").spline(arc_pts).val()
    body = (
        cq.Workplane("YZ")
        .placeSketch(cross_section)
        .sweep(path, isFrenet=True)
    )

    # Cap the height: trim away anything above (height_above_wheel + small epsilon)
    if height_above_wheel:
        cap = (
            cq.Workplane("XY")
            .box(2000, 2000, 2000, centered=(True, True, False))
            .translate((0, 0, height_above_wheel))
        )
        body = body.cut(cap)

    # Mirror to the right side if requested.
    if side == "right":
        body = body.mirror("YZ")

    # Translate to the wheel centre, if provided (Stage-2).
    if wheel_centre:
        body = body.translate(tuple(wheel_centre))

    # Sanity: must have at least one solid.
    solids = body.val().Solids() if hasattr(body.val(), "Solids") else []
    if not solids:
        raise ValidationError("build_front_arch produced no solid — params may be self-intersecting")

    return body

# ---------- registry ----------

BUILDERS: dict[str, Callable[[dict], cq.Workplane]] = {
    "build_front_arch": build_front_arch,
    # "build_rear_arch":    build_rear_arch,
    # "build_splitter_blade": build_splitter_blade,
    # "build_side_skirt":   build_side_skirt,
    # "build_wing_blade":   build_wing_blade,
}

# ---------- entrypoint ----------

def run_job(payload: dict) -> dict:
    """
    Called by the HTTP layer. Returns a dict { step_url, stl_url, glb_url, preview_png_url }.
    """
    builder_name = payload.get("builder")
    if not builder_name:
        # legacy v1 free-form recipe path
        return run_legacy_recipe(payload.get("recipe", {}), payload.get("inputs", {}))

    fn = BUILDERS.get(builder_name)
    if fn is None:
        raise ValidationError(f'unknown builder "{builder_name}". Available: {sorted(BUILDERS)}')

    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise ValidationError("params must be an object")

    # Defence-in-depth: re-validate. Reject if anything is missing or empty.
    if not params:
        raise ValidationError("params is empty — refusing to build with all defaults silently")

    wp = fn(params)

    # Export STL / STEP / GLB / preview.
    outdir = make_tmpdir()
    cq.exporters.export(wp, f"{outdir}/part.step")
    cq.exporters.export(wp, f"{outdir}/part.stl",  tolerance=0.1)
    try:
        cq.exporters.export(wp, f"{outdir}/part.glb")
        glb_url = upload_public(f"{outdir}/part.glb", "model/gltf-binary")
    except Exception:
        glb_url = None

    step_url    = upload_public(f"{outdir}/part.step", "model/step")
    stl_url     = upload_public(f"{outdir}/part.stl",  "model/stl")
    preview_url = render_preview_png(wp, f"{outdir}/preview.png")

    return {
        "step_url":        step_url,
        "stl_url":         stl_url,
        "glb_url":         glb_url,
        "preview_png_url": preview_url,
    }
```

Pseudocode helpers (`make_tmpdir`, `upload_public`, `render_preview_png`,
`run_legacy_recipe`) are left to your implementation — typical setups use S3
+ presigned URLs for upload and `cq-vtk` / `pyvista` for preview rendering.

---

## Staged testing (recommended)

The Lovable client deliberately drives staged tests so you can isolate
failures. Verify each stage works before moving to the next.

| Stage | Inputs | Expected |
|-------|--------|----------|
| **1. Standalone part** | `{builder, params}` only | STL/STEP of arch in empty space |
| **2. Place near vehicle** | + `params.wheel_centre = [x,y,z]` | Same arch translated |
| **3. Display alongside car STL** | + `inputs.base_mesh_url` | Worker renders preview with car visible (no boolean) |
| **4. Clearance check** | use `trimesh` server-side | Report mm of intersection |
| **5. Trim / split** | run Blender / Open3D step | Final mesh joined to body |

---

## Why this design

Mesh AI (Rodin, Meshy, Hyper3D) hallucinates surface noise, double-walls,
and holes on what should be flat panels. Free-form CAD recipe AI (the
previous v1 path) hallucinates open profiles and self-intersecting splines
that crash the kernel. Builder-based parametric CAD removes both classes of
failure: the AI is never trusted to author geometry, only to fill numerical
slots that are bounded by the schema.
