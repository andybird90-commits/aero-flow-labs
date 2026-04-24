# Onshape CAD Worker — HTTP Contract

This document defines the API contract between the BodyKit Studio backend and
the external Onshape worker that builds parts parametrically (sketches,
extrudes, lofts, fillets) instead of meshing them with AI.

The worker is **not deployed by Lovable** — it lives in your geometry repo and
is hosted alongside the Blender worker (Modal / Replicate / Fly / RunPod /
self-hosted). Lovable only knows two secrets:

- `ONSHAPE_WORKER_URL` — the worker's base URL
- `ONSHAPE_WORKER_TOKEN` — bearer token used in the `Authorization` header

---

## Endpoints

### `POST /jobs`

Kick off a CAD build. Returns immediately with a task id; the caller polls
`/jobs/:task_id` for status.

**Request**
```json
{
  "part_kind": "rear_wing",
  "recipe": {
    "version": 1,
    "part": "rear_wing",
    "units": "mm",
    "features": [
      {
        "type": "sketch",
        "id": "s1",
        "plane": "XY",
        "curves": [
          { "type": "naca", "code": "6412", "chord": 200, "origin": [0, 0], "rotation_deg": -3 }
        ]
      },
      { "type": "extrude", "id": "e1", "sketch": "s1", "depth_mm": 1500, "symmetric": true },
      { "type": "shell",   "id": "sh1", "target": "e1", "thickness_mm": 2.0, "open_faces": ["+Z"] },
      { "type": "fillet",  "id": "f1", "target": "e1", "edges": "all", "radius_mm": 3 }
    ],
    "outputs": ["step", "stl", "glb"]
  },
  "inputs": {
    "base_mesh_url": "https://.../car.stl"
  }
}
```

**Response**
```json
{ "task_id": "cad-abc-123" }
```

Auth: `Authorization: Bearer <ONSHAPE_WORKER_TOKEN>` required.

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
    "step_url":        "https://.../part.step",
    "stl_url":         "https://.../part.stl",
    "glb_url":         "https://.../part.glb",
    "preview_png_url": "https://.../preview.png"
  }
}
```

**Response (failed)**
```json
{ "status": "failed", "error": "loft failed: sketches not coplanar" }
```

The worker should host its output URLs somewhere fetchable by the Lovable edge
function (signed S3 URL, public CDN, etc.). The `cad-job-status` edge function
downloads the artifacts and re-hosts them in the `geometries` Supabase storage
bucket so the client always reads from a stable Lovable URL.

---

## Recipe schema

All dimensions in **millimetres**. Vehicle-local coordinates: forward = -Z,
up = +Y, right = +X.

### Feature types

| Type | Required fields | Notes |
|------|-----------------|-------|
| `sketch` | `id`, `plane`, `curves[]` | `plane` is `"XY"`/`"YZ"`/`"XZ"` or `{origin,normal}` |
| `extrude` | `id`, `sketch`, `depth_mm` | Optional `symmetric: true` |
| `loft` | `id`, `sketches[]` | Lofts between 2+ sketches |
| `shell` | `id`, `target`, `thickness_mm` | Optional `open_faces: ["+Z"]` |
| `fillet` | `id`, `target`, `radius_mm` | `edges: "all"` or `["edge_id"]` |
| `mirror` | `id`, `target`, `plane` | Plane defaults to vehicle YZ |
| `import_mesh` | `id`, `url` | Brings the base car STL in for projection |

### Curve types (inside `sketch.curves`)

| Type | Fields |
|------|--------|
| `line` | `from[2]`, `to[2]` |
| `arc` | `center[2]`, `radius`, `start_deg`, `end_deg` |
| `spline` | `points[][2]` |
| `naca` | `code` (4-digit), `chord`, `origin[2]`, `rotation_deg` |

---

## Why this exists

Mesh AI (Rodin, Meshy, Hyper3D) hallucinates surface noise, double-walls, and
holes on what should be flat panels. CAD removes that whole class of failures
for engineered parts — wings, splitters, canards, vents — by building the
geometry from explicit features instead of inferring it from images. The Lovable
client is engine-agnostic: every part can be built with CAD, Mesh AI, or Blender;
the user picks per-part.
