

## Auto-isolate the picked part before the AI redraws it

### The problem

When the user picks "rear arch" from a hotspot on a kitted concept, the source image still contains *both* arches, the splitter, the skirts, and reflections. Gemini and Meshy then get confused about which silhouette to draw/mesh — sometimes returning a different part entirely, or merging two arches into one ambiguous blob.

### The fix

Insert an **automatic isolation step** between "user clicks hotspot" and the existing render pipeline. The user never has to lasso anything for the common case — but the existing manual lasso stays available as a fallback.

### What the user sees

1. User clicks a hotspot (e.g. "Rear arch").
2. Modal opens immediately on a new **"Isolating part…"** view (~5–10s) showing a clay-style placeholder while a small preview of the cleaned crop fades in.
3. The "On car" pane shows the **isolated crop** (just the arch, on a soft grey backdrop) instead of the original busy concept image.
4. Flow continues exactly as today: AI render → review → 3D mesh, but now every downstream model only ever sees the one part.
5. If isolation fails or the user thinks the crop is wrong, a **"Re-trim manually"** button drops them into the existing lasso pretrim UI.

### Technical changes

**New edge function** — `supabase/functions/isolate-picked-part/index.ts`
- Input: `{ concept_id, part_kind, source_image_url, bbox: {x,y,w,h} }` (bbox is the normalised hotspot already produced by `detect-concept-hotspots`).
- Auth: validate JWT + concept ownership (same pattern as `isolate-carbon-bodywork`).
- Calls `google/gemini-3.1-flash-image-preview` (Nano Banana 2 — fast, image-edit capable) with:
  - The original concept image as input.
  - Prompt: *"Keep ONLY the {part_label} located in the highlighted region (roughly {bbox.x*100}% from the left, {bbox.y*100}% from the top, {bbox.w*100}% wide, {bbox.h*100}% tall). Erase EVERYTHING else — the rest of the car, other carbon parts, wheels, ground, background — replacing them with a clean medium-grey studio backdrop. Preserve the exact silhouette, proportions, mounting tabs, vents and surface curvature of the kept part. Output a single product-style render."*
- Uploads the result to `concept-renders` bucket at `{user_id}/{concept_id}/picked/{part_kind}-{timestamp}.png`.
- Caches the URL on `concept_parts.isolated_source_url` (new nullable text column) so re-opening the same part is instant.
- Returns `{ isolated_url }`.

**DB migration** — add `isolated_source_url text` to `concept_parts`.

**`PartHotspotOverlay.tsx`** — when the user clicks a box (or confirms a refined crop), pass the box's `{x,y,w,h}` along with the existing props to `ExtractedPartPreview` via a new optional `bbox` prop.

**`ExtractedPartPreview.tsx`**
- New initial stage: `"isolating"` (replaces the current default of either `pretrim` or `rendering` when `sourceImageUrl + bbox` are both supplied).
- On mount, if `bbox` is provided:
  1. Check `concept_parts.isolated_source_url` for a cached crop → use it.
  2. Otherwise call `isolate-picked-part` → on success, store URL → advance to `rendering`, passing the isolated URL to `runRender(..., true, isolatedUrl)`.
  3. On failure, fall back to the existing `pretrim` stage with a toast: *"Auto-isolate failed — please outline the part manually."*
- The "On car" pane in the 3-pane comparison now shows the isolated crop (with a small "ISOLATED" tag) instead of the raw concept render.
- Keep a small **"Re-isolate / Manual trim"** button in the review footer so the user can override.

**`render-isolated-part`** — no changes needed. It already accepts `source_image_url` as the sole reference when supplied.

**`meshify-part`** — no changes needed. It already accepts whatever images the client passes (it'll receive the cleaner AI-redrawn images from `render-isolated-part`).

### Out of scope

- Not adding isolation to the `Concepts` page top-level toggle (that's the existing "Carbon only" feature).
- Not changing the hotspot detection model or the manual lasso UI.
- No batch pre-warming — isolation runs lazily on first pick of each part.

### Why this should work

- The bbox gives Gemini a strong **spatial prior** — far more reliable than asking it to identify the part by name alone in a busy carbon kit shot.
- Downstream `render-isolated-part` already supports a single override reference image, so the existing prompt that forbids drawing surrounding bodywork now has a much cleaner input to work from.
- Caching against `concept_parts` means the cost is paid once per (concept, part).

