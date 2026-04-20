

## Make the workflow runnable: displacement + boolean + trigger UI

Goal: turn the existing pieces into a one-click flow. After approving a concept, click **Build aero kit from real STL** and get a downloadable kit on the Library page.

### What gets built

**1. Edge function: `displace-stl-to-concept`**
- Input: `concept_id`. Resolves project → car_template → repaired hero STL.
- Loads stock STL, subdivides front-bumper / rear-bumper / arches / underfloor zones to ~5 mm spacing so wings and lips have surface to push into.
- Headlessly renders the STL silhouette from the same 4 fixed cameras the concept generator uses (reuses `src/lib/stl-render.ts` logic, ported to Deno + a server-side rasteriser).
- Computes per-view "aero delta" mask = pixels where the concept silhouette extends past the stock silhouette.
- Back-projects each delta into 3D and applies a bounded outward displacement (cap 120 mm) to base vertices whose camera-space projection falls inside the delta mask.
- Writes `displaced.stl` to the `car-stls` bucket under `displaced/{concept_id}.stl`.
- Updates `concepts.aero_kit_status = 'displaced'`.

**2. Edge function: `subtract-aero-kit`**
- Input: `concept_id`. Loads `displaced.stl` + repaired stock STL.
- Uses **manifold-3d** (WASM) to compute `displaced − dilate(stock, 2 mm)`.
- Cleans: drops fragments < 50 cm³, welds, runs existing Laplacian smoother.
- Splits result into connected components.
- Classifies each by bbox position (front-low → splitter, rear-high → wing, rear-low → diffuser, side-low → side_skirt, over wheel → wide_arch, mid-rear → ducktail).
- Uploads combined `aero_kit.stl` and per-part STLs.
- Inserts a `concept_parts` row per component with `source: 'boolean'` and the classified `kind`.
- Sets `concepts.aero_kit_url` + `aero_kit_status = 'ready'`. On any failure, writes `aero_kit_status = 'failed'` + `aero_kit_error`.

**3. Orchestrator edge function: `build-aero-kit`**
- Single entry point the UI calls. Runs `displace-stl-to-concept` → `subtract-aero-kit` sequentially, updating `aero_kit_status` after each step (`displacing` → `subtracting` → `splitting` → `ready`).
- Refuses to run if the hero STL is missing or `manifold_clean = false`, returning a clear reason.

**4. UI: trigger on the Concepts page**
- For each concept card, when the project's car has a `manifold_clean` hero STL:
  - Show a new **Build aero kit from real STL** button next to the existing **Approve** action.
  - Clicking it calls `build-aero-kit` and shows a 3-step progress strip: `Displace · Subtract · Split` with the current step highlighted (driven by polling `aero_kit_status`).
  - On `ready`, show **View kit in Library** linking to `/library?project=...`.
  - On `failed`, show the error and a **Retry** button.
- When no hero STL exists, the button is replaced with a tooltip: "Upload a hero STL for this car (admin) to enable boolean kit generation."

**5. UI: Library page additions**
- New **Aero kit (boolean)** section above the existing parts grid, visible only when `concepts.aero_kit_url` is set.
- Shows the combined kit in a `PartMeshViewer` plus each split component as its own card with a `Boolean` source badge (orange) alongside existing `Extracted` (blue) and `Parametric` (green) badges.
- Per-component download + delete; combined-kit download.

**6. UI: source badges + filter**
- Add a small `Source: All / Parametric / Extracted / Boolean` filter chip row at the top of the Library parts grid.
- Existing parts get badges based on their `source` column (already in schema).

### Files touched

```text
supabase/functions/
  displace-stl-to-concept/index.ts      (new)
  subtract-aero-kit/index.ts            (new)
  build-aero-kit/index.ts               (new orchestrator)
  _shared/stl-render-server.ts          (new — Deno-side silhouette rasteriser)
  _shared/stl-subdivide.ts              (new — zone-targeted subdivision)
  _shared/stl-classify.ts               (new — bbox-zone → part kind)

src/lib/repo.ts                         (+ useBuildAeroKit, useAeroKitStatus poll)
src/pages/Concepts.tsx                  (+ build-kit button, progress strip)
src/pages/Library.tsx                   (+ aero-kit section, source filter)
src/components/AeroKitProgress.tsx      (new — 3-step strip)
src/components/SourceBadge.tsx          (new)
```

No schema changes — `aero_kit_status / url / error` and `concept_parts.source` already exist.

### Trade-offs

- **manifold-3d in Deno**: runs as WASM in edge functions, ~3 MB cold-start cost. Acceptable for a click-triggered flow, not for per-keystroke UX. The orchestrator will be 5–30 s end-to-end depending on STL size.
- **Server-side silhouette render**: needs a software rasteriser (no WebGL in Deno). We'll project triangles and rasterise depth on a 1024×1024 buffer per camera — pure TS, ~1 s per view, no native deps.
- **Repair fallback**: if a stock STL fails to reach manifold, the build button stays disabled rather than running and crashing inside manifold-3d. Per-part extraction (existing flow) remains the fallback path.

### How you'll use it after this lands

1. (Already done) Upload + repair hero STL on `/settings/car-stls`.
2. Generate concepts on `/concepts`, approve the one you like.
3. Click **Build aero kit from real STL** on that concept card.
4. Watch the 3-step strip; on `ready`, click through to **Library** to download `aero_kit.stl` or any individual split part.

