
## Stabilize Prototyper by splitting it into clear modes

The current flow asks one image-edit model to do too many things at once: understand the uploaded part, decide where it belongs, redraw it, and blend it onto the car. That is why even clean photos can come back as a generic approximation.

### What to build

#### 1. Replace the single ambiguous workflow with 3 explicit modes
Add a mode selector in the prototype dialog and workspace:

1. **Exact replica from photos**
   - For users who already have a real part and want it copied as faithfully as possible.
   - Requires uploaded photos.
   - Prioritises shape match over creativity.

2. **Design from description**
   - For users who want the AI to invent the part.
   - No photos required.
   - Uses title + notes + garage car context.

3. **Inspired by photos**
   - Uses uploaded photos as inspiration, not as ground truth.
   - Good for “make me something like this, but cleaner / more aggressive”.

This removes the current confusion where “replicate exactly” and “AI generation” are mixed together.

#### 2. Make the “exact replica” path multi-step instead of one-shot
For **Exact replica from photos**, change the render pipeline to:

```text
Uploaded part photos
   -> isolate the part from background / surrounding car
   -> create a clean standalone reference render
   -> generate on-car preview using that isolated part as the source of truth
   -> generate clay hero + clay back views for meshing
```

This gives the model a much cleaner target and stops it trying to infer the part from a busy photo.

#### 3. Add a placement control so the model stops guessing
Add a simple placement selector in the UI:

- Front bumper
- Bonnet / hood
- Side intake / side skirt area
- Rear bumper / diffuser area
- Bootlid / rear wing area
- Other

Optional follow-up: let the user click a rough zone on the garage image later, but the first step is a placement dropdown. This will dramatically improve on-car results because the model currently has to guess where the part belongs.

#### 4. Use Lovable AI image models for the image workflow
Move the prototype image generation away from the current OpenAI-only helper and onto Lovable AI image models, using:

- fast default: `google/gemini-3.1-flash-image-preview`
- higher-fidelity retry/fallback: `google/gemini-3-pro-image-preview`

These models are already used elsewhere in the project and fit the current image-editing pattern better.

#### 5. Add a visible “reference processing” stage in the UI
Show the user what the system extracted before the final render:

- Source photos
- Isolated part reference
- On-car preview
- Clay views

If the isolated reference is wrong, the user immediately knows the issue happened upstream instead of wasting time re-rendering blindly.

#### 6. Tighten the meaning of each button
Update the workspace actions:

- **Render exact fit** for exact-photo mode
- **Generate concept preview** for description mode
- **Re-fit on car** only re-runs the on-car composite
- **Make 3D model** still depends on approved clay renders

This makes the output intent obvious.

### Recommended implementation order

1. Add workflow mode + placement selector to the prototype data and UI.
2. Add isolated-part preprocessing for photo-based prototypes.
3. Switch prototype image generation helper to Lovable AI image models.
4. Update `render-prototype-views` to branch by mode.
5. Update `render-prototype-on-car` to use isolated refs + placement hints.
6. Update workspace UI to show the extra “isolated reference” stage and clearer actions.

### User-facing behaviour after the change

#### Exact replica from photos
- User uploads clean photos.
- User chooses where the part belongs.
- App first isolates the part.
- App shows the isolated part.
- App then fits that exact part onto the selected garage car.
- Clay views are generated from the isolated part, not guessed from the full car photo.

#### Design from description
- User types the part idea.
- App designs it from scratch and fits it to the car.
- No expectation of photo matching.

#### Inspired by photos
- User uploads photos.
- App uses them as style/shape inspiration, not strict ground truth.

### Technical details

- Add new prototype fields for:
  - `generation_mode` (`exact_photo`, `text_design`, `inspired_photo`)
  - `placement_hint`
  - optional `isolated_ref_urls`
  - optional `reference_status` / `reference_error`
- Update `render-prototype-views` so the job becomes:
  - preprocess references if photo-based
  - on-car render with placement hint
  - clay hero
  - clay back
- Update `render-prototype-on-car` so it prefers isolated part refs over raw uploaded photos.
- Replace or extend `_shared/openai-image.ts` with a provider-agnostic helper for Lovable AI image models.
- Keep background execution + polling pattern already added for long renders.

### Files touched

- `src/pages/Prototyper.tsx`
- `src/lib/repo.ts`
- `supabase/functions/render-prototype-views/index.ts`
- `supabase/functions/render-prototype-on-car/index.ts`
- `supabase/functions/_shared/openai-image.ts` or a new shared image helper
- `supabase/migrations/*` for new prototype columns

### Best option to implement first

Start with this combination:

1. **Mode selector**
2. **Placement selector**
3. **Photo isolation stage**
4. **Lovable AI image models for exact-photo mode**

That is the highest-impact fix for “I gave it clean images and it still doesn’t copy them”.
