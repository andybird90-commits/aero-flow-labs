# APEX NEXT / Aero Design Studio — Pivot Plan

## ⚠️ Scope reality check (read first)

What you've described is a **6–12 week professional engineering project**, not a single Lovable iteration. It includes:

- A full real-time 3D configurator (TransformControls, snap zones, mirror/duplicate, panelisation UI)
- 13+ new database tables with admin/user role separation
- A Meshy admin pipeline (already partly exists for Hunyuan3D)
- A **separate backend Blender service** with 13 job types (`trim_part_to_car`, `panelise_body_skin`, `cut_window_openings`, etc.) — this is the hardest part and **does not exist yet**. You already have `blender-worker/worker.py` as a starting point but it's minimal.
- Hardpoint picking tool, shell-fit alignment with wheelbase scaling
- Body skin library + panelisation workflow
- Re-skinning the entire UI (BodyKit Studio → APEX NEXT, cyan → orange, new IA)

**If I try to do this all in one go, the result will be 90% broken stubs and you'll burn a lot of credits debugging shells of features.** Your own message says: *"Do not overbuild AI automation yet. First make the viewer, library, snap placement and saved project workflow work properly."* — I'm going to hold you to that and propose a phased build.

## What already exists we can reuse

- ✅ `CarViewer3D` — R3F viewer with OrbitControls, STL/OBJ loading, anchors
- ✅ `cars`, `car_templates`, `car_stls`, `projects`, `concepts`, `library_items`, `cad_jobs`, `geometry_jobs` tables
- ✅ Hunyuan3D meshing edge functions (`meshify-part`, `meshify-prototype`)
- ✅ Concept generation pipeline (`generate-concepts`, hotspot detection)
- ✅ `blender-worker/worker.py` skeleton + `BLENDER_WORKER_URL` secret
- ✅ Admin role system (`has_role`, `app_role` enum)
- ✅ Storage buckets (`car-stls`, `concept-renders`, `frozen-parts`, `exports`)
- ✅ Sidebar/layout primitives, dark theme infrastructure

## Recommended phased build

---

### **PHASE 1 — Rebrand + new IA shell** (this iteration)

Goal: lay down the new app identity and navigation so every subsequent phase plugs in cleanly. **No 3D logic changes yet.**

1. **Theme swap** in `src/index.css`: change `--primary` from cyan `188 95% 55%` to motorsport orange `~22 95% 55%`, update gradients, glows, scanlines. Background stays graphite/black.
2. **Rename** "BodyKit Studio" → "APEX NEXT / Aero Design Studio" in `AppSidebar.tsx`, `Topbar.tsx`, `index.html` `<title>`.
3. **New sidebar IA** in `AppSidebar.tsx` with placeholder routes:
   - Dashboard, Concept Studio, 3D Build Studio, Part Library, Body Skin Library, Car Library, Projects, Settings
   - Admin-only group: Meshy Admin, Blender Jobs
4. **Map existing pages to new routes** (no logic changes):
   - `/dashboard` → new page (recent projects/cars/parts/skins + quick action grid)
   - `/concept-studio` → reuse `Concepts.tsx`
   - `/build-studio` → new page wrapping `CarViewer3D` (read-only first pass)
   - `/part-library` → reuse `Library.tsx` filtered to parts
   - `/body-skin-library` → new page, filtered library view
   - `/car-library` → reuse `Garage.tsx` for users + `AdminCarStls.tsx` for admin
   - `/meshy-admin` → new admin-gated page (stub)
   - `/blender-jobs` → new admin-gated page (stub, lists `cad_jobs` + future `blender_jobs`)
   - `/projects` → keep as-is
   - Legacy routes (`/brief`, `/parts`, `/refine`, `/exports`, `/prototyper`, `/marketplace`, `/styles`) → keep working but **remove from sidebar**; add redirects for the most confusing ones.
5. **Dashboard page**: stat cards + quick action buttons (New Concept, New 3D Build, Generate Part with Meshy, Upload Car STL/GLB, Upload Body Skin, Open Blender Job Queue) — buttons just link to the corresponding routes.

**Deliverable:** the app *looks* like APEX NEXT, sidebar matches your spec, every nav item lands somewhere meaningful (even if some are stubs). Existing functionality continues to work behind the scenes.

---

### **PHASE 2 — DB schema for new entities** (next iteration)

New tables (additive — does not break existing):

- `body_skins` — skin_id, donor_car_target, file_url_glb/stl, source_images, generation_prompt, fit_status enum, etc.
- `snap_zones` — car_id, zone_type, position (vec3), rotation (quat), scale, normal, mirror_zone, notes
- `car_hardpoints` — car_id, point_type (front_wheel_centre, rear_wheel_centre, sill_line, windscreen_base, roof_peak…), position
- `placed_parts` — project_id, part_id (→ library_items), transform (pos/rot/scale), snap_zone_id, mirrored
- `shell_alignments` — project_id, body_skin_id, transform, scale_to_wheelbase, locked_hardpoints
- `blender_jobs` — already partly covered by `cad_jobs`; extend or new table with operation_type enum (13 types), parameters_json, output urls
- `meshy_generations` — already partly covered; add `target_library` (part vs body_skin) + prompt history

RLS: users own their projects/placed_parts/alignments; admin-only writes for `snap_zones`, `car_hardpoints`, `body_skins` library entries.

---

### **PHASE 3 — 3D Build Studio core** (next iteration)

- Three-column layout: left part library, center R3F viewport, right properties, bottom placed-parts strip
- Camera presets (front/rear/L/R/top/3-4) + view cube + grid toggle + lighting controls
- `TransformControls` from drei for selected part: translate/rotate/scale
- Add part from library → placed at origin → user moves it
- Save/load `placed_parts` JSON
- **No snap zones yet, no Blender, no shell fit** — just a working "drag parts onto a car" scene

---

### **PHASE 4 — Snap zones + admin hardpoint picker**

- Admin page where they click on the 3D car to place hardpoints/snap zones, saved to DB
- User side: when adding a part, show snap zone gizmos; "auto-align to zone" + "mirror to opposite side"

---

### **PHASE 5 — Body Skin Library + Shell Fit Mode**

- Upload/list body skins
- Shell Fit Mode in Build Studio: load skin over car, align via hardpoints, scale to wheelbase, save alignment

---

### **PHASE 6 — Meshy Admin (proper)**

- Promote existing `meshify-part` / `meshify-prototype` flows into a dedicated admin UI with prompt templates (40mm arch, splitter, NACA, etc.) + body-skin generation mode + prompt history

---

### **PHASE 7 — Blender backend** (the big one)

This is **mostly external work** on `blender-worker/worker.py`. The frontend side is "submit job → poll → show output". The 13 operations (`trim_part_to_car`, `panelise_body_skin`, `cut_window_openings`, `add_return_lip`, etc.) each need bespoke Blender Python — that's days of work per operation, done outside Lovable on your worker box.

In Lovable for this phase: Blender Job Queue UI, parameter forms per op type, dispatch edge function, status polling, output preview/download.

---

## What I'd do **right now** (Phase 1 only)

If you approve, I will in the next message:

1. Update `src/index.css` palette to orange-on-graphite
2. Rebrand sidebar header + topbar to "APEX NEXT"
3. Restructure `AppSidebar.tsx` with the 10-item nav (admin-gated where required)
4. Create stub pages: `Dashboard.tsx`, `BuildStudio.tsx` (wrapping existing `CarViewer3D`), `MeshyAdmin.tsx`, `BlenderJobs.tsx`, `BodySkinLibrary.tsx`
5. Wire routes in `App.tsx`, keep legacy routes alive but hidden
6. Update `index.html` title + meta

I will **not** in this iteration: change any DB schema, touch the 3D viewer internals, modify edge functions, or build snap zones / shell fit / Blender pipeline.

## Confirm before I proceed

Please confirm:
- ✅ Proceed with **Phase 1 only** (rebrand + new IA shell, ~1 iteration)?
- Or — would you prefer to tackle a different phase first (e.g. jump straight to Phase 3 Build Studio core)?
- Are the legacy pages (Brief, Refine, Marketplace, Prototyper, Exports) safe to **remove from sidebar** but keep reachable by URL? Or should some stay visible?
