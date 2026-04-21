

## Carbon-only view toggle

Add a per-concept toggle that strips the base car and shows just the carbon bodywork (splitter, skirts, arches, diffuser, wing) floating on a clean studio background. Useful for product photography of the kit alone and as a sanity-check on what's actually being added.

### How it will work for the user

- On every concept card and in the zoom dialog, a small **"Carbon only"** toggle (next to the angle pills) swaps every visible angle from the full car render to the carbon-only render.
- First time the toggle is flipped on a concept, it kicks off generation in the background (~20s for 4 angles in parallel). A subtle loading state shows on the affected images. Subsequent toggles are instant — results are cached.
- The carbon-only renders are saved alongside the originals, so they appear in the user's Library and can be made public/sold on the Marketplace just like the full-car concepts.

### Technical changes

**Database migration** — add 4 nullable columns to `public.concepts`:
- `render_front_carbon_url`, `render_side_carbon_url`, `render_rear34_carbon_url`, `render_rear_carbon_url`
- `carbon_status` enum-ish text: `idle | generating | ready | failed`
- `carbon_error text`
- Extend the existing library auto-index trigger (`20260420215723_…sql`) to also insert these as `concept_render_carbon` library items when populated.

**New edge function** — `supabase/functions/isolate-carbon-bodywork/index.ts`:
- Input: `{ concept_id: string }`
- Auth: validate JWT, confirm concept ownership.
- For each of the 4 angle URLs that exist on the concept, send the existing render to the Lovable AI image model (`google/gemini-3.1-flash-image-preview`) with an isolation prompt:
  > "Keep ONLY the aftermarket carbon-fibre bodywork (front splitter, canards, side skirts, flared arches, rear diffuser, rear wing, hood vents). Remove the base car body, wheels, glass, lights, ground and background entirely. Place the isolated carbon parts on a clean medium-grey studio backdrop with soft lighting and a subtle ground shadow. Preserve the exact shape, proportion, weave direction and reflections of each carbon part. Output a single clean studio product render."
- Run the 4 angles in parallel via `Promise.all` (same pattern that fixed `WORKER_RESOURCE_LIMIT` in `generate-concepts`).
- Upload each result to the existing `concept-renders` bucket under `{user_id}/{concept_id}/carbon_{angle}.png`.
- Update the concept row with the 4 URLs + `carbon_status: ready`. On any failure, set `failed` + `carbon_error`.

**Repo hook** — `src/lib/repo.ts`:
- `useIsolateCarbon(conceptId)` mutation that invokes the function and invalidates the concept query.
- Type extension on `Concept` for the new columns.

**ConceptCard UI** — `src/pages/Concepts.tsx`:
- Local state `carbonMode: boolean` per card (defaults off).
- Build a parallel `carbonAngles` array mirroring `angles` but reading `render_*_carbon_url`.
- When `carbonMode` is on, render from `carbonAngles` instead of `angles`. Same swipe / arrows / zoom behaviour.
- Toggle button (small pill, `Layers` icon, label "Carbon only") next to the existing angle pills:
  - If `carbon_status === 'idle'` and no carbon URLs exist → first click triggers `useIsolateCarbon` and flips mode on optimistically.
  - If `generating` → toggle shows spinner, disabled.
  - If `ready` → instant toggle.
  - If `failed` → toggle shows a small "Retry" affordance with the error in a tooltip.
- In zoom dialog, the toggle is also visible in the top bar so it works on both card and zoom.

**Library / Marketplace** — no UI work needed. Because the migration extends the existing trigger, isolated-carbon renders auto-appear in the user's Library tagged as `concept_render_carbon` and can be flipped public/priced through the existing flow.

### Out of scope

- No re-prompting, no edits to the OEM concept image — this is purely a derivative isolation pass.
- Not adding a "carbon only" option to the aero-kit STL builder; this is image-only.
- Not changing default privacy or pricing logic.

