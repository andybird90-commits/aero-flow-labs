# Prototyper Page Pivot — Build Plan

> **Hard rule:** Copy, mirror, isolate, snap-opposite, move, scale and rotate actions MUST NOT call any generative image model. They are handled by stored masks + deterministic 2D transforms.

---

## Phase 1 — Data model & infrastructure

### 1.1 New `frozen_parts` table (migration)
Columns:
- `id`, `user_id`, `prototype_id` (FK), `garage_car_id` (FK, nullable)
- `name` (text), `category` (text — side_scoop, splitter, canard, vent, etc.)
- `mount_zone` (text: `front_bumper | front_quarter | bonnet | door_quarter | sill | rear_quarter | rear_bumper | wing_zone`)
- `side` (text: `left | right | center`)
- `symmetry_allowed` (bool, default true)
- `silhouette_locked` (bool, default true)
- `source_image_url`, `mask_url`, `silhouette_url` (text)
- `bbox` (jsonb — `{x,y,w,h}` normalized 0–1)
- `anchor_points` (jsonb — `{top, bottom, leading_edge, trailing_edge, attach_edge}`)
- `view_angle` (text: `front | front34 | side | rear34 | rear`)
- `created_at`, `updated_at`
- RLS: owner-only CRUD

### 1.2 New storage bucket `frozen-parts` (public)
- Path: `{user_id}/{prototype_id}/{frozen_part_id}/{mask|silhouette|preview}.png`
- Owner write, public read

### 1.3 Edge function `segment-frozen-part` (NEW)
- Inputs: `source_image_url`, `click_point: {x,y}` (normalized), optional `bbox_hint`
- Calls Replicate Segment Anything (SAM)
- Returns: mask PNG (full frame), silhouette PNG (transparent cutout), bbox, suggested anchor points
- Uploads PNGs to `frozen-parts` bucket
- Does NOT write to `frozen_parts` table (Save step does that)

### 1.4 Edge function `place-frozen-part` (NEW — deterministic, NO AI)
- Inputs: `frozen_part_id`, `target_image_url`, `transform: {x, y, scale, rotation, mirror, perspective_skew?}`
- Loads frozen part's silhouette PNG
- Mirror = horizontal flip via imagescript
- Perspective skew = 4-point transform for opposite-side snapping on 3/4 views
- Composites transformed silhouette over target image
- Returns composited PNG URL
- **No call to ai.gateway.lovable.dev anywhere in this function**

### 1.5 Hide legacy prototypes
- New page query filters out rows lacking any `frozen_parts`
- Old prototypes still in DB & accessible via Library/Exports

---

## Phase 2 — New `src/pages/Prototyper.tsx` (FULL REBUILD)

### Layout (3-column shell)

**Left panel** — Garage car selector (REQUIRED), active car view picker, frozen-part library grid

**Centre canvas** — active car view, mode-aware overlays (concept render / mask preview / drag handles)

**Right panel** — mode-specific controls:

| Mode | Controls |
|---|---|
| Generate | style preset, prompt, target zone, aggression slider, generate button |
| Freeze | mask preview, brush/erase, category, mount zone, side, symmetry, lock-silhouette, save |
| Place | clone, mirror, snap-opposite, x/y/rotation/scale, lock |

### Mode switcher
Three tab buttons: **Generate · Freeze Part · Place**. Place disabled until ≥1 frozen part exists.

---

## Phase 3 — Mode wiring

- **Generate** → reuses existing `generate-concepts` (the ONLY AI call path)
- **Freeze** → click → `segment-frozen-part` → user refines → save row in `frozen_parts`
- **Place** → drag/clone/mirror → `place-frozen-part` (pixel ops only, no AI)

---

## Phase 4 — Approve & export

- "Approve Overlay" composites all placed instances into one PNG (`prototypes.fit_preview_url`) and writes a placement manifest JSON
- Manifest is the handoff artifact for the future CAD/STL stage

---

## Files

**Backend (new):**
- `supabase/migrations/<ts>_frozen_parts.sql`
- `supabase/functions/segment-frozen-part/index.ts`
- `supabase/functions/place-frozen-part/index.ts`

**Frontend (new):**
- `src/pages/Prototyper.tsx` (full rewrite)
- `src/components/prototyper/PrototyperShell.tsx`
- `src/components/prototyper/PrototyperLeftPanel.tsx`
- `src/components/prototyper/PrototyperCanvas.tsx`
- `src/components/prototyper/PrototyperRightPanel.tsx`
- `src/components/prototyper/ModeSwitcher.tsx`
- `src/components/prototyper/FrozenPartCard.tsx`
- `src/components/prototyper/MaskRefineTool.tsx`
- `src/components/prototyper/PlacementOverlay.tsx`
- `src/lib/prototyper/transforms.ts`
- `src/lib/prototyper/mount-zones.ts`

---

## Acceptance criteria

1. **Mirror** on a frozen part produces a pixel-perfect horizontal flip — verifiable by hashing the silhouette PNG.
2. **Snap Opposite** repositions to the mirrored mount zone with no shape change.
3. Grep: only Generate-mode code in the new Prototyper calls `ai.gateway.lovable.dev`.
4. `frozen_parts` rows persist all metadata.
5. Approve Overlay produces composited PNG + JSON manifest.
6. Old prototypes are not visible in the new page list but still in DB.

---

## Out of scope (explicit)

- STL / watertight meshing
- Mount tab design
- Aero/physics calc
- Marketplace export of frozen parts
- Cross-prototype frozen-part sharing
