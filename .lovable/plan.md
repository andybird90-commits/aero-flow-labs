

## Reframe Prototyper around "on-car first"

Currently the workflow leads with two isolated clay renders (hero + back), then makes the on-car carbon composite a secondary "fit check". This plan inverts that so the on-car shot becomes the **primary** render whenever a garage car is linked, because that's the view that actually answers "does this part make sense on my car?".

### New flow

```text
Upload photos + (optional) pick garage car + describe the part
       │
       ▼
PRIMARY render  ──►  Part shown ON the car, in carbon fibre
                     (if no car linked → falls back to clay hero)
       │
       ▼
SECONDARY clay views (hero + back)   ◄── generated automatically right after,
                                          needed for meshing + back-of-part check
       │
       ▼
3D mesh / STL
```

### What changes

**1. Edge function: `render-prototype-views`**
- When a `garage_car_id` is present, generate the on-car carbon composite *first* using the source photos + car reference photo directly (skip needing a pre-existing clay hero as input).
- Then generate the clay hero + clay back views as before — these are still required as input to the mesher and to inspect the hollow back.
- Write all three results to the prototype row in one pass: `fit_preview_url` + `render_urls[hero, back]`.
- When no car is linked, behaviour is unchanged (clay hero + back only).

**2. Edge function: `render-prototype-on-car`**
- Keep it, but it's no longer the only path to the on-car shot. It stays as the dedicated "Re-fit on car" re-roll button so users can iterate the composite without re-rendering the clay views.
- Update its input handling so it can work from the source photos directly if no clay hero exists yet (defensive — covers older prototypes).

**3. UI: `Prototyper.tsx` workspace dialog**
- Reorder panels so the **on-car carbon view is the hero panel at the top** (large), with the clay hero/back views shown smaller underneath as "reference views", followed by the 3D mesh panel.
- When no garage car is linked, the on-car panel shows a soft prompt: "Link a garage car to see this part fitted in carbon" with a button that opens the car picker — clay views remain primary in that case.
- Rename the primary action button from "Render views" to **"Render preview"** (it now produces the on-car shot + clay views together).
- Keep "Re-fit on car" as a secondary action for re-rolling just the composite.
- The revision-note textarea applies to whichever render the user triggers next (re-render preview *or* re-fit on car).

**4. New prototype dialog**
- No structural change, but make the garage car picker more prominent (move it directly under the title, before the photo uploads) and add a one-line hint: "Pick a car to see the part fitted on it as the main preview."

### Layout sketch

```text
┌─────────────────────────────────────────────────────────────┐
│  ON CAR (carbon)                          [hero panel]      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            big composite render of car                │  │
│  └───────────────────────────────────────────────────────┘  │
├──────────────────┬──────────────────┬───────────────────────┤
│ SOURCE PHOTOS    │ CLAY VIEWS       │ 3D MESH               │
│ (small grid)     │ hero │ back      │ viewer / "Make 3D"    │
└──────────────────┴──────────────────┴───────────────────────┘
│ REVISION NOTE FOR NEXT RENDER  [textarea]                   │
│ [Close] [Re-render preview] [Re-fit on car] [Make 3D model] │
└─────────────────────────────────────────────────────────────┘
```

### Technical details

- `render-prototype-views` will branch on `garage_car_id`: if set, fetch the car ref image, build a 3-step prompt sequence (on-car carbon → clay hero → clay back) and update DB columns `fit_preview_url`, `fit_preview_status`, `render_urls`, `render_status` together. Status writes happen progressively so the UI can show "Rendering on-car…", "Rendering clay views…".
- The on-car prompt re-uses the existing carbon-fibre prompt already in `render-prototype-on-car`, but takes source photos as the part reference instead of the clay hero (the clay hero is a redrawn approximation; using the originals gives the model truer geometry to work from).
- Clay hero/back generation is unchanged — still needed as the input to `meshify-prototype`.
- No schema changes required (`fit_preview_url/status/error` columns already exist).
- Card thumbnails in the prototype list will prefer `fit_preview_url` when present, so the grid shows the on-car carbon shot rather than the floating clay part.

### Files touched

- `supabase/functions/render-prototype-views/index.ts` — branch on garage car, produce on-car shot first
- `supabase/functions/render-prototype-on-car/index.ts` — accept source photos as fallback input
- `src/pages/Prototyper.tsx` — reorder workspace panels, rename buttons, prefer fit preview as card thumb, reorder new-prototype dialog fields

