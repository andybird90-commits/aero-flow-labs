

## Strategic pivot: split the geometry path in two

You've validated that mounted-part picking on a render is a dead end. This plan locks that learning into the product by **removing the Prototyper workflow as the primary path**, **gating the existing image-to-3D flow to free-standing parts only**, and **adding a Blender-based external worker** for body-conforming parts (arches, scoops, skirts, side-skirts) that fits geometry against the saved base car mesh.

Three things ship:

1. Remove Prototyper from primary nav and stop investing in it
2. Gate `meshify-part` so it only runs on free-standing part kinds
3. Stand up a Blender worker with 4 jobs: `prepare_base_mesh`, `fit_part_to_zone`, `mirror_part`, `export_stl`

---

### 1. Retire the Prototyper as the main flow

- Remove the **Prototyper** sidebar entry from `src/components/AppSidebar.tsx`
- Keep `/prototyper` route alive but only reachable from `/library` for existing prototypes (no new entry point)
- Add a one-line banner on `/prototyper` explaining the workflow is paused and pointing users to Concepts → isolated parts
- No data deletion. Existing `prototypes` and `frozen_parts` rows remain queryable

### 2. Classify parts as free-standing vs body-conforming

Add a single source-of-truth classifier in `src/lib/part-classification.ts`:

```text
FREE_STANDING:    diffuser, wing, splitter_section, vent_insert, canard,
                  rear_wing, front_splitter, gurney_flap
BODY_CONFORMING:  side_scoop, front_arch, rear_arch, side_skirt,
                  bonnet_vent, fender_flare, front_lip
```

Wire this into:

- **`ExtractedPartPreview.tsx`** — when the user clicks "Make 3D model", branch:
  - free-standing → existing `meshify-part` (Rodin) flow, unchanged
  - body-conforming → show "Send to geometry worker" CTA instead, queues a `geometry_jobs` row
- **`meshify-part/index.ts`** edge function — server-side guard: reject body-conforming kinds with a 422 and a clear message, so we can't accidentally regress

### 3. External Blender worker (new)

A small Python service (run as a separate container/Modal/Replicate cog — chosen at deploy time) exposing 4 jobs. We'll integrate via a new `geometry_jobs` table + edge function dispatcher; the worker itself is **not deployed by Lovable** (it lives in your geometry repo) but we wire the contract end-to-end.

**New table `geometry_jobs`:**

| Column | Type | Notes |
|---|---|---|
| id | uuid | pk |
| user_id | uuid | RLS owner |
| concept_id | uuid | FK |
| part_kind | text | body-conforming kind |
| mount_zone | text | front_quarter, rear_quarter, sill, etc. |
| side | text | left / right / center |
| job_type | text | `prepare_base_mesh` / `fit_part_to_zone` / `mirror_part` / `export_stl` |
| status | text | queued / running / succeeded / failed |
| inputs | jsonb | { base_mesh_url, part_template_url, zone_bbox, params } |
| outputs | jsonb | { fitted_stl_url, glb_url, preview_png_url } |
| worker_task_id | text | external job id |
| error | text | nullable |
| created_at, updated_at | timestamptz | |

RLS: owner-only CRUD. Add to library trigger so successful jobs surface in `/library`.

**New edge function `dispatch-geometry-job`:**

- Accepts `{ concept_id, part_kind, mount_zone, side, job_type, inputs }`
- Validates user owns the concept and the base car mesh
- Inserts a `geometry_jobs` row (status=queued)
- POSTs to the worker URL stored in a new secret `BLENDER_WORKER_URL` with auth header `BLENDER_WORKER_TOKEN`
- Returns the `geometry_jobs.id` so the client can poll

**New edge function `geometry-job-status`:**

- Polls the worker for a given `worker_task_id`
- On success: downloads the artifacts, re-hosts in `geometries` bucket, updates `geometry_jobs.outputs`, sets status to `succeeded`
- On failure: writes `error`, sets status to `failed`

**Worker contract (documented in `docs/blender-worker.md`):**

```text
POST /jobs
  body: { job_type, inputs: { base_mesh_url, part_template_url?, zone, params } }
  returns: { task_id }

GET  /jobs/:task_id
  returns: { status, progress, outputs?: { fitted_stl_url, ... }, error? }
```

For each `job_type`:

- **prepare_base_mesh** — load car STL, decimate to 100k tris, weld, orient, output canonical OBJ
- **fit_part_to_zone** — load base mesh + part template, crop to zone bbox, project rear face to body surface, offset 2mm, trim overlaps, optionally thicken to wall thickness, save fitted STL
- **mirror_part** — mirror across vehicle Y axis with optional perspective correction, weld seam
- **export_stl** — final clean STL + slicer-ready GLB preview

### 4. UI: "Send to geometry worker" surface

- New dialog component `src/components/SendToGeometryWorker.tsx` opened from `ExtractedPartPreview` for body-conforming kinds
- Form fields: mount zone (dropdown from `mount-zones.ts`), side (left/right/center), wall thickness (mm), offset (mm)
- Calls `dispatch-geometry-job` then polls `geometry-job-status` every 4s
- On success: shows fitted STL in the existing 3D viewer + "Mirror" and "Download STL" buttons that fire follow-up jobs

### 5. Library + Marketplace integration

- Add `geometry_part_mesh` to `LibraryItemKind` so fitted parts appear alongside concept parts and aero kits
- Trigger `sync_geometry_job_library_items` mirrors successful `geometry_jobs` into `library_items` so they're sellable

---

## Technical details

**New files**
- `src/lib/part-classification.ts` — kind → `free_standing | body_conforming`
- `src/components/SendToGeometryWorker.tsx` — dispatch UI
- `src/lib/geometry-jobs.ts` — react-query hooks for `geometry_jobs`
- `supabase/functions/dispatch-geometry-job/index.ts`
- `supabase/functions/geometry-job-status/index.ts`
- `supabase/migrations/<ts>_geometry_jobs.sql`
- `docs/blender-worker.md` — worker HTTP contract spec

**Edited files**
- `src/components/AppSidebar.tsx` — drop Prototyper entry
- `src/pages/Prototyper.tsx` — paused banner, deprioritise
- `src/components/ExtractedPartPreview.tsx` — branch on classification
- `supabase/functions/meshify-part/index.ts` — server-side reject body-conforming kinds
- `src/lib/repo.ts` — add `geometry_part_mesh` to `LibraryItemKind`

**Secrets needed** (asked at implementation time)
- `BLENDER_WORKER_URL` — your hosted worker base URL
- `BLENDER_WORKER_TOKEN` — bearer token

**Out of scope** (per your bottom line)
- Building the Blender worker code itself — that lives outside Lovable
- Deleting old `prototypes` / `frozen_parts` data
- Replacing the Concepts page or isolated-part renders (those work)

**Acceptance criteria**
1. Prototyper not in sidebar; old prototypes still openable from Library
2. `meshify-part` returns 422 for body-conforming kinds
3. New "Send to geometry worker" CTA appears on body-conforming hotspots in Concepts
4. `geometry_jobs` row + worker POST happens on dispatch
5. Successful worker output appears in `/library` as `geometry_part_mesh`

