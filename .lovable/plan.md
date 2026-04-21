

## New flow: export the whole carbon kit as a single mesh

Instead of trying to split the bumper, splitter, arches, diffuser, wing etc. into separate parts (which is where the app keeps mis-identifying things like "this is part of an arch"), we treat the entire carbon-only render set as **one combined kit** and produce **one combined STL/GLB**. The user splits it apart in Fusion / Blender / similar afterwards.

This is much more honest: the AI never has to *understand* what an arch is — it only has to mesh the silhouette it can already see in the carbon-only renders.

## What changes

### 1. New action on the concept card

When the user clicks **Carbon only** and the carbon renders are ready, we expose a new primary CTA on each card:

```
[ Mesh full carbon kit → ]
```

This replaces the per-part "Pick parts" route as the recommended path for getting a printable file. Per-part picking stays available as a secondary tool for users who really want one piece, but it stops being the headline action.

### 2. New edge function: `meshify-carbon-kit`

A thin variant of the existing `meshify-part` flow, but:

- **Input**: all available carbon-only renders for that concept (front 3/4, side, rear 3/4, rear) — multi-view, in canonical order.
- **Prompt**: tuned for a *combined* aftermarket kit, not a single part.
- **Pixel sizing preserved** (see section 3).
- **Output**: single GLB stored in `concept-renders` bucket, plus a derived STL.
- Persists to a new column on `concepts`: `carbon_kit_glb_url`, `carbon_kit_stl_url`, `carbon_kit_status`, `carbon_kit_error`.

Rodin Gen-2 (Ultra) on Replicate already accepts multi-view input via the `images` param — same model we use for `meshify-part`, just fed the 4 carbon renders together so it reconstructs them as one coherent kit instead of 4 separate parts.

### 3. Maintain pixel sizing as much as possible

Three things together let us preserve scale across the four views:

1. **Use the same camera framing for every carbon render**. The carbon-only isolation already keeps each part at the *exact same pixel position* as in the source render (the existing prompt enforces this). We extend that contract: each carbon render is canvas-padded to the **same square size** (e.g. 1024 × 1024) before being sent to Rodin. No per-image cropping. This keeps the inter-view scale ratio truthful.
2. **Embed a known scale anchor**. Before meshing, we composite a **1 m horizontal scale bar** into a corner of one of the carbon views (off the part silhouette, on the grey backdrop). Rodin will replicate scale from the multi-view geometry; the bar gives us a post-mesh ruler. After meshing we read the bar back from the source view, compute its mesh-space length, and rescale the GLB so 1 unit = 1 m. The result: the exported STL opens in Fusion at the correct real-world dimensions instead of being arbitrary "Rodin units".
3. **Reuse the car bbox if we have a hero STL**. When the project's car has a repaired hero STL (we already track `car_stls.bbox_min_mm` / `bbox_max_mm`), we use the stock car's known length as a second cross-check and snap the kit's scale to it. If no hero STL exists, the scale-bar method is the fallback.

### 4. Schema additions

New columns on `concepts`:

- `carbon_kit_status` text default `'idle'` (idle / queued / generating / ready / failed)
- `carbon_kit_error` text
- `carbon_kit_task_id` text (Rodin prediction id, for polling)
- `carbon_kit_glb_url` text
- `carbon_kit_stl_url` text
- `carbon_kit_scale_m` numeric (the recovered metres-per-unit factor, for transparency)

No table-creation, no RLS changes — `concepts` already has user-scoped RLS.

### 5. UI surface

On the concept card, when `carbonMode` is on:

- New button: **Mesh full kit** (or "Re-mesh" if `carbon_kit_status === 'ready'`).
- Inline progress: "Reconstructing combined kit… ~60s".
- When ready: two download buttons — **Download GLB** and **Download STL** — labelled with "Open in Fusion / Blender to split into parts".
- Small caption: *"This is the entire carbon kit as one mesh. Use your CAD tool to split it into individual parts."*

Per-tile **Pick parts** stays, demoted to a secondary action.

### 6. Library + Marketplace

When the kit is ready, we also auto-publish it as a `library_items` row with `kind = 'carbon_kit_mesh'` so it shows up in the user's Library and is available for marketplace listing — same pattern the existing `aero_kit_mesh` triggers use.

## Files touched

- `supabase/functions/meshify-carbon-kit/index.ts` — new function
- `supabase/functions/_shared/scale-anchor.ts` — small helper to composite + read the scale bar (server-side, uses image bytes)
- `supabase/functions/isolate-carbon-bodywork/index.ts` — pad outputs to a fixed square canvas so all four views share the same pixel scale
- `supabase/migrations/*.sql` — new `carbon_kit_*` columns on `concepts`; extend `sync_concept_library_items()` trigger to also publish the kit GLB
- `src/lib/repo.ts` — `useMeshifyCarbonKit`, `useCarbonKitStatus` hooks
- `src/pages/Concepts.tsx` — new CTA + progress + download buttons inside the carbon mode panel
- `src/integrations/supabase/types.ts` — regenerated for the new columns

## What this fixes

- The "what is an arch" failure mode disappears — we never ask the AI to label parts.
- One mesh per concept = one Fusion import, much faster iteration.
- Pixel sizing is locked across views (uniform canvas + scale anchor + optional hero-STL snap), so the kit imports at correct dimensions.
- Per-part picking is preserved for power users but is no longer the default.

