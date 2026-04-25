
# Admin Paint Map Editor

Move material classification from "auto-guess on first user load" to an explicit admin curation step. Once an admin has finished a car, every end-user opens it with perfect black tyres, painted rims, and untouched glass — zero work on their side.

## How it will work for you (admin)

1. Go to **Settings → Hero-car STL library** (the page you already have).
2. Each car row gets a new **"Edit paint map"** button + a status badge: *No map · Auto · Curated*.
3. Clicking it opens a full-screen 3D editor: the car in the middle, a tools rail on the left, a legend/save bar on the right.
4. The car is shown with **debug colours** so you can see what's tagged what:
   - Body = grey
   - Glass = cyan
   - Wheel = blue
   - Tyre = orange
5. Use the tools to fix anything wrong, then **Save**. The map is stored as `method = 'manual'` and end-users get it instantly.

## Tools in the editor

| Tool | What it does | How you use it |
|------|--------------|----------------|
| **Wheel circle** | Tags a wheel + tyre in one go | Click the wheel hub, drag outward. Inner ring = wheel, outer ring = tyre. Repeat for each of the 4 wheels. |
| **Glass lasso** | Tags a window | Click around the window outline; double-click to close. Reuses the lasso engine from `PartLasso.tsx`. |
| **Magic wand** | Flood-fills connected triangles with similar normals (stops at sharp edges — perfect for a single body panel or a whole windscreen) | Pick a tag (body/glass/wheel/tyre), click a triangle. |
| **Brush** | Paint individual triangles | Pick a tag + radius, drag over the surface. |
| **Reset to auto** | Re-runs the geometric classifier from scratch | One button, with confirm. |

All tools project the user's 2D screen-space input (circle, lasso polygon, click) onto the 3D mesh by raycasting and centroid-in-polygon tests, only affecting camera-facing triangles so you don't accidentally paint the far side.

## End-user experience after curation

- Build Studio loads the car → fetches the curated map → renders body / wheels / tyres / glass with separate materials immediately.
- The Paint popover stays as it is (Body / Wheels / Tyres / Glass tabs) but the user **never sees a "classifying…" spinner** and **never sees mis-tagged regions**.
- For cars an admin hasn't curated yet, the existing auto-classifier still runs as a fallback (so nothing breaks).

## Save behaviour (your answer to the open question)

You said **(b)**: Save and stay so I can keep refining, with a separate Done button to leave. ✅
- **Save** → writes the current map to the DB and shows a tiny "Saved · 3:42 pm" toast, editor stays open.
- **Done** → goes back to the admin list. If there are unsaved edits, prompts to save first.

## Files to create / change

**New**
- `src/pages/AdminCarPaintMap.tsx` — the editor page (route: `/settings/car-stls/:carStlId/paint-map`)
- `src/components/admin/PaintMapEditor.tsx` — viewport + tools rail + save bar
- `src/components/admin/PaintMapTools/WheelCircleTool.tsx` — circle drag → radial tag
- `src/components/admin/PaintMapTools/GlassLassoTool.tsx` — polygon → screen-space tag
- `src/components/admin/PaintMapTools/MagicWandTool.tsx` — flood-fill by normal angle
- `src/components/admin/PaintMapTools/BrushTool.tsx` — radius-based painting
- `src/lib/build-studio/paint-map-edit.ts` — pure functions: raycast, centroid-in-polygon, flood-fill, undo/redo stack, base64 encode/decode
- `supabase/functions/save-car-material-map/index.ts` — admin-only edge function that upserts the manual map (validates JWT + `has_role(uid, 'admin')`)

**Modified**
- `src/pages/AdminCarStls.tsx` — add status badge + "Edit paint map" link per row
- `src/lib/build-studio/use-car-material-map.ts` — prefer `method = 'manual'`, never auto-replace it; only auto-classify when no map exists at all
- `src/App.tsx` — register the new admin route
- `src/components/build-studio/PaintStudioPopover.tsx` — small "Curated by admin" / "Auto-tagged" indicator (no functional change)

**Database (no schema change needed)** — the existing `car_material_maps` table already has a `method` text column. We'll just write `'manual'` to it. The unique key is already `car_stl_id`, so save = upsert.

## Tech notes (for transparency)

- **Undo/redo** lives in memory (a stack of `Uint8Array` snapshots, capped at 30 to bound memory).
- **Performance:** the debug colour overlay uses three.js geometry groups + an array of 4 simple `MeshBasicMaterial`s — same trick the live viewport already uses, so it scales to 500k-tri meshes at 60 fps.
- **Camera-facing filter:** every paint operation only affects triangles whose normal·view-direction < 0, so you can't paint the back of the car by accident.
- **Symmetry helper (stretch):** a "mirror across X" toggle so painting the front-left wheel also paints the front-right. Cheap to add and saves you half the clicks. I'll include it.

## Out of scope for this round

- AI-assisted tagging (Tier 2 image segmentation). The manual editor is fast enough and gives 100 % accuracy; we can add AI as a "pre-fill" button later if you want.
- Per-user paint maps. Maps stay one-per-car-STL, shared across all users.

## Approval

If this plan looks right, approve it and I'll implement it end-to-end. After that, your workflow is: upload a car STL → click "Edit paint map" → spend 1–2 minutes per car → end-users get a polished experience forever.
