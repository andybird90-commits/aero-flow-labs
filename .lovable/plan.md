## Multi-engine "Build" pipeline

Stop using part classification as a hard gate. Instead, every picked part shows three engine choices and the user picks. Classification becomes a *recommendation* badge, not a fork.

```text
Pick a part →  ┌─ Build with CAD       (Onshape — parametric, clean B-rep)
               ├─ Generate 3D mesh     (Rodin — image-to-3D, fast, lumpy)
               └─ Fit to body          (Blender — surface-conform to car STL)
```

All three are available for every part kind. The UI suggests the best one, but never blocks the others.

---

### 1. Replace the binary CTA with an engine picker

In `ExtractedPartPreview.tsx`, after the user approves the AI render of an isolated part, replace the single "Make 3D model" button with a small chooser:

- **Build with CAD** (recommended for: wings, splitters, diffusers, canards, vents)
- **Generate mesh** (recommended for: organic / one-off shapes; warning shown for body-conforming kinds about lumpy results)
- **Fit to body** (recommended for: arches, scoops, skirts, lips; greyed out if no base car STL is saved)

The "recommended" pill is driven by the existing `classifyPartKind` — but no engine is disabled based on it. Each engine button shows: ETA estimate, output formats (STEP / GLB / STL), and a one-line "what this is good at" hint.

### 2. Drop the server-side classification gate

`supabase/functions/meshify-part/index.ts` currently 422s on body-conforming kinds. Remove that guard so Rodin meshing works for any part the user explicitly chose. Keep the existing single-shell prompt fix.

`src/lib/part-classification.ts` keeps its classify functions but their role is purely advisory (drives the "recommended" badge). Rename `FIT_CLASS_DESCRIPTION` copy so it no longer says "image-to-3D fails" — instead it says "Best fitted via Blender, but you can still try mesh AI or CAD."

### 3. Add the CAD engine (Onshape)

New table `cad_jobs` and two edge functions, mirroring the existing `geometry_jobs` worker contract so the UX is symmetric:

- **`cad_jobs`** — id, user_id, concept_id, project_id, part_kind, status, recipe (jsonb), inputs, outputs (step/stl/glb/preview), worker_task_id, error
- **`generate-cad-recipe`** — Gemini-2.5-pro emits a strict JSON feature recipe (sketches, extrudes, lofts, fillets) for the chosen part. For body-conforming kinds the recipe references the saved car STL as a mesh import.
- **`dispatch-cad-job`** — validates the recipe, inserts a `cad_jobs` row, POSTs to the external Onshape worker, returns the job id.
- **`cad-job-status`** — polls the worker, re-hosts artifacts in `geometries` bucket, marks succeeded/failed.
- DB trigger `sync_cad_job_library_items` mirrors successful jobs into `library_items` as `cad_part_mesh`.

New UI component `SendToCadWorker.tsx` (modelled on `SendToGeometryWorker.tsx`) with form fields per part type (chord, span, NACA profile, flare, etc.) and a status panel that polls and shows STEP / STL / GLB download buttons.

Worker contract is documented in a new `docs/onshape-worker.md`. The worker itself is hosted outside Lovable.

### 4. Keep Rodin and Blender unchanged

- **Rodin path** stays the existing `meshify-part` flow. Now reachable for every part.
- **Blender path** stays the existing `SendToGeometryWorker` + `dispatch-geometry-job` flow. Now reachable for every part (not just body-conforming).
- After any engine succeeds, surface a "Refine in Blender" follow-up that takes the produced mesh and chains a `fit_part_to_zone` job — so users can CAD a wing then Blender-fit the mounting tabs to the body, or Rodin a scoop then Blender-conform the back face.

### 5. Library + history

Library gets two new kinds: `cad_part_mesh` and (already exists) `geometry_part_mesh`. Each library card shows which engine produced it (CAD / Mesh AI / Blender) and a "Send to <other engine>" action so users can pivot without re-picking the part.

---

## Technical details

**New files**
- `supabase/migrations/<ts>_cad_jobs.sql` — table, RLS, library trigger
- `supabase/functions/generate-cad-recipe/index.ts`
- `supabase/functions/dispatch-cad-job/index.ts`
- `supabase/functions/cad-job-status/index.ts`
- `src/lib/cad-jobs.ts` — react-query hooks (mirrors `geometry-jobs.ts`)
- `src/lib/cad-recipe.ts` — recipe TypeScript types + zod schema
- `src/components/SendToCadWorker.tsx` — dispatch + polling UI
- `src/components/EngineChooser.tsx` — three-button picker with recommended badge
- `docs/onshape-worker.md` — HTTP contract

**Edited files**
- `src/components/ExtractedPartPreview.tsx` — replace single CTA with `EngineChooser`; wire all three dispatch dialogs; remove `bodyConforming` branching gate
- `src/lib/part-classification.ts` — soften copy so it's advisory only
- `supabase/functions/meshify-part/index.ts` — remove the 422 guard for body-conforming kinds (keep single-shell prompt)
- `src/components/SendToGeometryWorker.tsx` — accept *any* `partKind`, no kind-based gating
- `src/lib/repo.ts` — add `cad_part_mesh` to `LibraryItemKind`
- `src/pages/Library.tsx` — show engine badge + "Send to other engine" action

**Secrets needed at implementation time**
- `ONSHAPE_WORKER_URL` — base URL of your Onshape worker
- `ONSHAPE_WORKER_TOKEN` — bearer token
- (`BLENDER_WORKER_URL` / `BLENDER_WORKER_TOKEN` already configured)

**Out of scope**
- Building the Onshape worker code (lives in your geometry repo)
- Removing Rodin or Meshy (kept as the "fast & lumpy" option on purpose)
- Auto-routing — every dispatch is an explicit user choice

**Acceptance**
1. Every picked part shows three engine buttons; "recommended" is a badge, not a constraint
2. `meshify-part` accepts any kind (no 422)
3. Choosing "Build with CAD" dispatches a `cad_jobs` row and polls status; success surfaces STEP/STL/GLB downloads
4. Library shows engine provenance and lets you re-dispatch to a different engine
5. After CAD or Rodin success, a "Refine in Blender" CTA chains a fit job
