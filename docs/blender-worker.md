# Blender Geometry Worker — HTTP Contract

This document defines the API contract between the BodyKit Studio backend and
the external Blender worker that fits body-conforming parts (arches, scoops,
skirts, lips) against a saved base car mesh.

The worker is **not deployed by Lovable** — it lives in your geometry repo and
is hosted on Modal / Replicate / Fly / RunPod / etc. Lovable only knows two
secrets:

- `BLENDER_WORKER_URL` — the worker's base URL
- `BLENDER_WORKER_TOKEN` — bearer token used in the `Authorization` header

---

## Endpoints

### `POST /jobs`

Kick off a job. Returns immediately with a task id; the caller polls
`/jobs/:task_id` for status.

**Request**
```json
{
  "job_type": "fit_part_to_zone",
  "inputs": {
    "base_mesh_url": "https://.../car.stl",
    "part_template_url": "https://.../scoop_template.stl",
    "zone": "front_quarter",
    "side": "left",
    "params": {
      "wall_thickness_mm": 2.0,
      "offset_mm": 1.5
    }
  }
}
```

**Response**
```json
{ "task_id": "abc-123" }
```

Auth: `Authorization: Bearer <BLENDER_WORKER_TOKEN>` required.

### `GET /jobs/:task_id`

Poll for status.

**Response (in-progress)**
```json
{ "status": "running", "progress": 0.42 }
```

**Response (succeeded)**
```json
{
  "status": "succeeded",
  "progress": 1,
  "outputs": {
    "fitted_stl_url":  "https://.../fitted.stl",
    "glb_url":         "https://.../fitted.glb",
    "preview_png_url": "https://.../preview.png"
  }
}
```

**Response (failed)**
```json
{ "status": "failed", "error": "no overlap with body surface" }
```

The worker should host its output URLs somewhere fetchable by the Lovable edge
function (signed S3 URL, public CDN, etc.). The edge function downloads the
artifacts and re-hosts them in the `geometries` Supabase storage bucket so the
client always reads from a stable Lovable URL.

---

## Job types

### `prepare_base_mesh`
Inputs: `{ base_mesh_url }`
Steps:
1. Load car STL
2. Decimate to ~100k tris
3. Weld duplicate verts
4. Orient to canonical axes (forward = -Z, up = +Y)
5. Export OBJ
Outputs: `{ fitted_stl_url, glb_url }` (re-uses the same fields for the prepped base)

### `fit_part_to_zone`
Inputs: `{ base_mesh_url, part_template_url, zone, side, params }`
Steps:
1. Load base + part template
2. Crop part to zone bbox
3. Project rear / contact face onto the body surface
4. Offset by `offset_mm` (default 2mm)
5. Trim overlaps with the body
6. Optionally thicken to `wall_thickness_mm`
7. Save fitted STL + GLB + flat PNG preview
Outputs: `{ fitted_stl_url, glb_url, preview_png_url }`

### `mirror_part`
Inputs: `{ part_url, base_mesh_url, side }`
Steps:
1. Mirror across the vehicle Y axis
2. Optional perspective correction
3. Weld seam with the original
Outputs: `{ fitted_stl_url, glb_url, preview_png_url }`

### `export_stl`
Inputs: `{ part_url }`
Steps:
1. Final cleanup pass (manifold, decimate light)
2. Output slicer-ready STL + GLB preview
Outputs: `{ fitted_stl_url, glb_url, preview_png_url }`

---

## Conventions

- All meshes in millimetres.
- All coordinates in vehicle-local space (forward = -Z, up = +Y, driver-side = +X
  right-hand-drive context — adjust to your geometry).
- Errors should be human-readable strings, < 500 chars.
- Worker is idempotent on a `task_id` — duplicate POSTs with the same payload
  may return the existing task.
