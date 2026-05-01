# Mesh Worker — HTTP Contract

> **Architecture note (2026-05):** This worker used to be a headless Blender
> server, which proved unreliable (Blender is a GUI app, not a server).
> It is now a **FastAPI + trimesh + Open3D** service. The HTTP contract below
> is unchanged so the Lovable edge functions (`dispatch-blender-job`,
> `dispatch-geometry-job`, `blender-job-status`, `geometry-job-status`)
> continue to work without modification.
>
> - **FastAPI** — REST API surface
> - **trimesh** — GLB / STL read & write, boolean trimming
> - **Open3D** — ICP alignment of parts onto the car body
>
> The worker is hosted separately (Modal / Fly / RunPod / your own box).
> Lovable only knows two secrets:
>
> - `BLENDER_WORKER_URL` — base URL of the FastAPI server (e.g. `http://178.105.44.191:8000` during dev)
> - `BLENDER_WORKER_TOKEN` — bearer token used in the `Authorization` header
>
> The secret names are kept as `BLENDER_*` for backwards compatibility — they
> point at the new FastAPI server, not Blender.

This document defines the API contract between the BodyKit Studio backend and
the external mesh worker that fits body-conforming parts (arches, scoops,
skirts, lips, wings, bumpers, spoilers) against a saved base car mesh.

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
    "base_mesh_url": "https://.../car.glb",
    "part_template_url": "https://.../scoop_template.glb",
    "zone": "front_quarter",
    "side": "left",
    "params": {
      "wall_thickness_mm": 2.0,
      "offset_mm": 1.5,
      "icp_max_iter": 50,
      "icp_threshold_mm": 5.0
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
{ "status": "failed", "error": "ICP did not converge — part too far from body" }
```

The worker hosts its output URLs somewhere fetchable by the Lovable edge
function (signed S3 URL, public CDN, Supabase Storage, etc.). The edge
function downloads the artifacts and re-hosts them in the `geometries`
Supabase storage bucket so the client always reads from a stable Lovable URL.

> ⚠️ The edge runtime cannot reach `localhost` / `127.0.0.1` — the worker must
> upload outputs to a publicly fetchable host (Supabase Storage, S3,
> Cloudflare tunnel, deployed worker). Local-only URLs are rejected by
> `geometry-job-status` with a clear error.

---

## Job types

All job types run inside FastAPI handlers that use `trimesh` for I/O and
boolean ops, and `open3d` for ICP alignment.

### `prepare_base_mesh`
Inputs: `{ base_mesh_url }`
Steps:
1. Load car GLB/STL via `trimesh.load`
2. Decimate to ~100k tris (`trimesh.Trimesh.simplify_quadric_decimation`)
3. Weld duplicate verts (`mesh.merge_vertices`)
4. Orient to canonical axes (forward = -Z, up = +Y)
5. Export GLB
Outputs: `{ fitted_stl_url, glb_url }` (re-uses the same fields for the prepped base)

### `fit_part_to_zone`
Inputs: `{ base_mesh_url, part_template_url, zone, side, params }`
Steps:
1. Load base + part template with trimesh
2. Crop part to zone bbox
3. Run **Open3D ICP** (`open3d.pipelines.registration.registration_icp`)
   against the body surface to align the part's contact face
4. Offset by `offset_mm` (default 2 mm)
5. Trim overlaps with the body using `trimesh.boolean.difference`
6. Optionally thicken to `wall_thickness_mm`
7. Save fitted STL + GLB + flat PNG preview
Outputs: `{ fitted_stl_url, glb_url, preview_png_url }`

### `mirror_part`
Inputs: `{ part_url, base_mesh_url, side }`
Steps:
1. Mirror across the vehicle Y axis (negate X, flip face winding)
2. Re-run ICP to snap the mirrored copy onto its target side
3. Weld seam with the original
Outputs: `{ fitted_stl_url, glb_url, preview_png_url }`

### `export_stl`
Inputs: `{ part_url }`
Steps:
1. Final cleanup pass (`mesh.fix_normals`, light decimation)
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
- The legacy `blender-worker/` folder in this repo is **deprecated** and kept
  only for reference. New work happens in the separate FastAPI repo.
