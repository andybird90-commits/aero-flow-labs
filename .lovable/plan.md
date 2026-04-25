# One-click auto-split for clean CAD car meshes

**Goal:** Upload a hero STL, click **Auto-split into panels**, get back ~10–14 named panels (hood, doors, bumpers, fenders, roof, mirrors, wheels), each registered as a swappable Build Studio part with auto-placed hardpoints — with **zero manual cleanup** on clean inputs.

**Honest scope:** Targets clean CAD/game-ready meshes (your stated input). Will refuse gracefully on heavily smoothed scans rather than producing garbage.

---

## 1 · Backend: shut-line splitter

**New file:** `supabase/functions/_shared/stl-split-by-creases.ts`

Pure-TS, no Blender needed. Pipeline:

1. **Weld vertices** — spatial hash at 1e-5 m tolerance so welded but coincident vertices share an index.
2. **Build edge → triangle adjacency** — `Map<edgeKey, [triA, triB]>`.
3. **Mark sharp edges** — for each shared edge, compute dihedral angle from face normals. Mark sharp if `angle > threshold` (default **45°**, tuned for game-ready CAD where shut lines are typically 60–90°).
4. **Constrained flood-fill** — BFS from each unvisited triangle, traversing only across non-sharp edges. Each fill = one raw component.
5. **Sliver merge** — components with `< 200 triangles` OR `< 0.5%` of total mesh area get merged into their largest neighboring component (across the sharp edge with the most shared length).
6. **Boundary extraction** — for each surviving component, collect the loop(s) of edges that border another component. These are the **mating surfaces**.

Returns: `{ components: Array<{ triangleIndices, vertexCount, areaM2, bbox, boundaryLoops }> }`.

## 2 · Backend: panel slot classifier

**New file:** `supabase/functions/_shared/classify-car-panels.ts`

Given the split components and the car's known forward axis (already stored in `car_stls.forward_axis`), classify each component into one of these slots by bounding-box geometry relative to the car's overall bbox:

| Slot | Heuristic |
|---|---|
| `hood` | Top surface, front 1/3 length, full width, near-flat normal-up area > 60% |
| `roof` | Top surface, middle 1/3 length, full width |
| `front_bumper` | Front 15% length, bottom-to-mid height, full width |
| `rear_bumper` | Rear 15% length, bottom-to-mid height, full width |
| `door_l` / `door_r` | Mid length, mid height, one side only (Y < 0 / Y > 0) |
| `fender_l` / `fender_r` | Front 1/3, mid height, one side, contains a wheel arch cut-out |
| `mirror_l` / `mirror_r` | Small (< 2% mesh area), high Y offset, mid height, attached to door region |
| `wheel_l_f`, `wheel_l_r`, `wheel_r_f`, `wheel_r_r` | Cylindrical (analyzed via normal distribution), at known wheel positions |
| `unknown_<n>` | Anything that fails all classifiers — kept but flagged |

Components scoring `< 0.6` confidence on their best slot get tagged `unknown_<n>` and surfaced in the UI for manual labeling (this respects your "zero clicks" rule for the success path while not silently mislabeling edge cases).

## 3 · Backend: hardpoint auto-placement

**Inside the same edge function:** for each classified panel, walk its `boundaryLoops`:

- **Centroid** of each loop = candidate hardpoint position
- **Normal** = average of triangle normals along the loop
- **Tangent** = principal axis of the loop's vertex covariance matrix

These three vectors define a snap frame. Save as rows in the existing `hardpoints` table (already used by `HardpointsAdminViewport`). Each panel gets 1–4 hardpoints depending on how many neighbors it had.

This is the high-value bit: hardpoints come from **actual mating geometry**, not from a human guessing where the bumper bolts on.

## 4 · New edge function

**New file:** `supabase/functions/auto-split-car-stl/index.ts`

```
POST /auto-split-car-stl  { car_stl_id }
```

Flow:
1. Load `repaired_stl_path` (auto-split requires the repair pass to have run — enforced in UI).
2. Fetch STL bytes from `car-stls` bucket.
3. Run `stl-split-by-creases` → raw components.
4. Run `classify-car-panels` → labeled panels.
5. Compute auto-hardpoints per panel.
6. Write each panel as a separate STL into `car-stls/<car_stl_id>/panels/<slot>.stl`.
7. Insert rows into a new `car_panels` table (see below) and matching `hardpoints` rows.
8. Return summary: `{ totalPanels, namedPanels, unknownPanels, splitConfidence }`.

Runs synchronously — typical clean CAD STL (~500k tris) processes in 8–15s server-side, well within edge timeout.

## 5 · Database migration

**New table `car_panels`:**

```
id, car_stl_id (fk), slot (text), confidence (real),
stl_path (text), triangle_count (int), area_m2 (real),
bbox jsonb, created_at
```

RLS: only admins can write; authenticated can read panels for any car_stl they have access to (i.e., same as `car_stls`).

Existing `hardpoints` table gets a new optional FK `car_panel_id`. When present, the hardpoint represents an auto-derived mating surface; when null, it's a hand-placed one from `HardpointsAdmin`.

## 6 · UI: Admin (`AdminCarStls.tsx`)

After the **Run repair** button, add a third action per row:

- **`✂️ Auto-split panels`** — disabled until repaired & manifold. Shows a confirmation dialog with the dihedral threshold slider (default 45°, advanced users only) and a "this will replace existing panels" warning if `car_panels` rows already exist for this car.
- After running, the row expands inline to show a **preview panel list** with each detected slot, triangle count, confidence chip (green / yellow / red), and a "View" button that opens a 3D viewer with each panel colored differently.
- For any `unknown_<n>` panels, a dropdown lets the admin pick the correct slot label without re-running the split. This is the only "click" required, and only on imperfect inputs.

## 7 · UI: Build Studio integration

- `PartLibraryRail` gets a new **"Body panels"** section, populated from `car_panels` rows for the currently active hero car.
- Selecting a panel in the rail **toggles its visibility** on the base car (the existing single-mesh base car is still rendered, but with the toggled panel's triangles masked out via vertex group).
- Replacement parts can now snap to the hardpoints derived from that panel's boundary loops — no more guessing where the bumper attaches.

## 8 · Honest fallback for the 15%

If the splitter returns `< 4` components for the entire car, that's a strong signal the input doesn't have detectable shut lines (heavily smoothed scan, single watertight blob). Edge function returns `{ ok: false, reason: 'no_shut_lines_detected', componentsFound: N }` and the UI shows:

> "This mesh doesn't have detectable panel seams. The car will still work as a non-splittable base. To enable panel-level swaps, re-export from CAD with separate panel objects, or use a higher-quality source mesh."

No silent corruption, no fake panels.

---

## Files touched

**New:**
- `supabase/functions/_shared/stl-split-by-creases.ts`
- `supabase/functions/_shared/classify-car-panels.ts`
- `supabase/functions/auto-split-car-stl/index.ts`
- `src/lib/build-studio/car-panels.ts` (client repo helpers + React Query hooks)
- `src/components/admin/CarPanelsPreview.tsx` (3D coloured-by-component viewer)
- DB migration: `car_panels` table + `hardpoints.car_panel_id` column

**Modified:**
- `src/pages/AdminCarStls.tsx` — Auto-split button + inline preview
- `src/components/build-studio/PartLibraryRail.tsx` — Body panels section
- `src/components/build-studio/BuildStudioViewport.tsx` — panel-masked base car render
- `src/lib/build-studio/hardpoints.ts` — read auto-derived hardpoints

---

## What I'm explicitly NOT doing in v1

- No paint/brush manual splitter (you said zero clicks — adding it would imply auto isn't trusted)
- No symmetry detection to guarantee `door_l` and `door_r` are mirror-perfect (they will be 99% of the time on clean CAD; if not, it's a signal the car itself isn't symmetric)
- No segmentation of underbody/interior (out of scope for aero-kit work)

If after testing on real STLs the unknown-rate is too high, the realistic next step is **option B: a 5-second manual touch-up brush**, not "make the auto-detector smarter" — at some point the input quality is the bottleneck, not the algorithm.