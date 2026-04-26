## Add a "Backdrop" picker — workshop, studio, custom HDRI

### What you'll get

A new **Backdrop** dropdown in the Build Studio toolbar (sits next to Quality / Present) that swaps the entire scene environment — lighting, reflections, *and* the visible background — between several presets and custom uploads. The dark plate behind the car becomes the chosen workshop, garage, sunset, etc.

### Built-in presets (zero cost — drei ships these HDRIs)

- **Studio** (current default — clean white cyc)
- **Warehouse** — concrete + steel beams, warm tungsten — the "race shop / garage" look
- **City** — modern detailing-bay vibe with windows
- **Apartment** — soft interior, big window light
- **Sunset** — golden hour outdoor
- **Dawn** — cool morning outdoor
- **Night** — moody dark
- **Forest / Park / Lobby** — extra options already in the type

### Custom HDRI upload

- New **"Upload HDRI…"** option at the bottom of the dropdown
- Accepts `.hdr` and `.exr` (the standard 360° photographic HDRIs you'd grab from Poly Haven, HDRI-Skies, or shoot yourself)
- Stored in a new public `hdri-backdrops` storage bucket, scoped per project
- Once uploaded, appears as a thumbnailed entry at the top of the dropdown ("My Workshop", "Dealership Floor", etc.) — selectable like any preset
- Delete affordance on each custom entry

### Visibility behaviour (per your answer: visible behind the car)

- `<Environment background>` flag turned on, so the HDRI replaces the current `#08080a` plate and you actually see the workshop walls/floor around the car
- The reflective `ShowroomFloor` stays — it sits *on top* of the HDRI floor and grounds the car. For outdoor presets (sunset/dawn) we drop the reflector automatically so the car doesn't look like it's parked on a mirror in a field
- Presentation Mode picks up the chosen backdrop automatically — your hero screenshots are now "car in workshop" instead of "car in void"

### Persistence

- Selection saved to `projects.paint_finish.env_preset` (column already exists, type already supports all preset names)
- Custom HDRI URL stored in a new `projects.paint_finish.custom_hdri_url` field (additive, no migration breakage)
- Survives reload, syncs across browser tabs

### Files I'll touch

- `src/components/build-studio/BuildStudioViewport.tsx` — stop forcing `studio`, honour the chosen preset, wire `background` flag, conditionally drop reflector for outdoor scenes, load custom HDRI via `RGBELoader` when set
- `src/components/build-studio/BuildStudioToolbar.tsx` — new **Backdrop** dropdown with preset thumbnails + upload button
- `src/lib/build-studio/paint-finish.ts` — add `custom_hdri_url?: string` to `PaintFinish`
- `src/lib/repo.ts` — `useUploadHdri`, `useDeleteHdri`, `useProjectHdriList` hooks
- `src/pages/BuildStudio.tsx` — pipe backdrop state through to viewport + toolbar
- New file: `src/components/build-studio/BackdropPicker.tsx` — the dropdown UI itself (preset grid + upload zone + custom list)

### Backend

- One migration: create public `hdri-backdrops` storage bucket + RLS policies (authenticated users can read/write their own project's HDRIs, public read so the viewport can fetch the URL fast)
- No new tables — custom HDRI URL lives inside the existing `paint_finish` JSONB column

### What I won't do this pass

- **Build my own 3D workshop scene** (modelled walls/tools/lifts). HDRI gives you 95% of that look for 1% of the work; a custom modelled garage would be its own multi-day feature
- **Animated backdrops** (flickering shop lights, etc.) — premium HDRIs already bake light atmosphere in
- **Per-camera-angle backdrop** — one backdrop per project for now, not one per saved view

### After this ships

Open Build Studio, click **Backdrop → Warehouse** in the toolbar — the void disappears and your Boxster is sitting on the dark plate inside a real-looking workshop with overhead lights bouncing off the clearcoat. Switch to **Sunset** and you're outside on a cliff road. Upload a photo of *your* shop and the car renders as if it's parked there.