# Sculpt Studio + Part Structure Inspector

Two shipments, in order. Ship 1 is small and lights up immediately. Ship 2 is the real feature.

---

## Ship 1 — Show what's actually inside a GLB

Today every imported GLB looks the same in the Library — a thumbnail and a title. You can't tell whether it's one fused shell or a kit of separate panels. We'll inspect the file once on first preview and cache the result.

**What you'll see in the Library card:**
- A small chip: `1 mesh` / `7 meshes` / `12 meshes`
- Material count: `2 materials`
- Hover/expand to see node names (e.g. `Body`, `Splitter_L`, `Wheel_FL`)
- A tiny status: **Single shell** (sculpt-friendly) vs **Multi-part** (per-part edit / recolour-friendly)

**Where it appears:**
- `src/pages/Library.tsx` — new line under the title in `ItemCard`.
- `src/components/build-studio/PartLibraryRail.tsx` — same chip on the rail thumbnails so you can pick "the right kind of part" before placing.

**How it's computed (one-time, cached):**
- New helper `src/lib/build-studio/glb-inspect.ts` that downloads the GLB once, traverses `gltf.scene`, counts meshes, materials, triangles, and collects the first ~10 node names.
- Result written into `library_items.metadata.structure = { meshCount, materialCount, triangleCount, nodeNames[], inspectedAt }` so we never recompute. No schema migration needed — `metadata` is already `jsonb`.
- Triggered lazily: when a user opens the Library or hovers a card, if `metadata.structure` is missing we fetch + inspect + persist via `useUpdateLibraryItem`.

This alone makes the "is this kit modular or fused?" question answerable in one glance.

---

## Ship 2 — Sculpt Studio

A new mode inside Build Studio that lets you push, pull, smooth, inflate and pinch the bodywork mesh of a placed part (or the base car body), with mirror + masking, undo/redo, and a "Save as new variant" button that bakes the result into a fresh GLB in your Library.

### Entry point

In `BuildStudioViewport.tsx` next to the existing **Paint Studio** popover, add a **Sculpt** button.

- Disabled with a tooltip when no sculptable mesh is selected.
- A mesh is "sculptable" if it has ≥ 2k triangles and isn't locked. Below that we offer a one-click **Subdivide ×1** (≈ 4× tri count) before entering sculpt mode, so AI-generated low-poly bodies don't sculpt like origami.

Clicking **Sculpt** swaps the right-hand panel for a **SculptPanel** and replaces orbit-on-drag with brush-on-drag (orbit moves to right-mouse / two-finger).

### Brushes

| Brush | What it does | Math |
|---|---|---|
| Push / Pull | Offsets vertices along surface normal (toggle direction) | `v += n * strength * falloff(r)` |
| Smooth | Relaxes vertex toward average of 1-ring neighbours | `v = lerp(v, mean(neighbours), strength * falloff)` |
| Inflate | Offsets vertices along their own vertex normal | like Push but uses per-vertex normal |
| Pinch | Pulls vertices toward brush centre projected on surface | `v += (centre - v) * strength * falloff` |
| Flatten | Projects vertices onto local tangent plane at brush centre | `v -= n * dot(v - p, n) * strength` |

Falloff: smoothstep `(1 - r/R)^2`. Brush controls in the panel: **Radius**, **Strength**, **Falloff curve**, plus a live cursor disc rendered on the surface.

### Symmetry & masking

- **Mirror X** toggle (default on for body parts) — every brush action is also applied to the X-mirrored vertex set, found via the BVH.
- **Mask by tag** — reuse the existing `TAG_BODY` triangle tags from `paint-map-edit.ts` so you can lock wheels/glass while sculpting bodywork. Toggle: "Bodywork only".
- **Freeze region** — paint a temporary mask with the same brush UI (Shift-drag), invertable, clearable.

### Performance

- Build a BVH on the target geometry via `getOrBuildBVH` (`src/lib/build-studio/fit/build-base-bvh.ts`) — already in the codebase.
- Each brush stroke uses `bvh.shapecast` to walk only triangles inside a sphere of radius R; we collect the affected vertex indices into a `Set` and mutate `position.array` in place.
- After mutation: `position.needsUpdate = true`, then recompute normals only for affected triangles (not the whole mesh) using a small in-place patch.
- BVH is **rebuilt lazily** at mouse-up (not per-frame) so strokes stay 60fps even on a 100k-tri body.

### Undo / Redo

- New `SculptHistory` stack. Each entry stores a `Float32Array` snapshot of the affected vertex positions plus their indices (not the whole buffer — typically a few hundred vertices per stroke).
- Wires into the existing `useHistory` / `useHistoryShortcuts` (`src/lib/build-studio/history.ts`) so ⌘Z / Ctrl+Z works alongside the rest of the studio.

### Saving the result

A **Save** button at the top of the Sculpt panel, with three options:

1. **Overwrite this part** — replaces the selected `library_item.asset_url` with the baked GLB.
2. **Save as new variant** — creates a new `library_items` row (`kind: concept_part_mesh`) titled `<original> (sculpted)`, linked to the same `project_id`.
3. **Cancel sculpt** — discards changes.

Baking re-uses `exportSceneToGLBBlob` from `src/lib/showroom/glb-export.ts`, uploads to the existing `frozen-parts` storage bucket (already public), and writes the new `library_items` row via the existing repo hook.

### Files to add / change

- **New** `src/lib/build-studio/sculpt/brushes.ts` — pure functions per brush (push, smooth, inflate, pinch, flatten).
- **New** `src/lib/build-studio/sculpt/sculpt-engine.ts` — owns the BVH, applies a stroke, manages snapshots, exposes `applyStroke({ pos, dir, radius, brush, strength, mirror, mask })`.
- **New** `src/lib/build-studio/sculpt/subdivide.ts` — one-iteration triangle subdivision (mid-edge split) for low-poly meshes.
- **New** `src/lib/build-studio/glb-inspect.ts` — Ship 1 helper, also reused by Ship 2 to gate the Sculpt button.
- **New** `src/components/build-studio/SculptPanel.tsx` — the right-hand UI: brush picker, radius/strength sliders, mirror toggle, mask controls, save buttons.
- **New** `src/components/build-studio/SculptCursor.tsx` — the disc-on-surface brush preview.
- **Edit** `src/components/build-studio/BuildStudioViewport.tsx` — wire the Sculpt mode toggle, swap pointer handlers to brush-on-drag, render `SculptPanel` + `SculptCursor`.
- **Edit** `src/pages/Library.tsx` — render the new structure chips under each `ItemCard`.
- **Edit** `src/components/build-studio/PartLibraryRail.tsx` — same chip on rail thumbnails.

### Out of scope (for this round)

- Topology editing (extruding new geometry, cutting holes, bridging edge loops).
- Multi-resolution / dynamic topology (Blender's "dyntopo").
- Texture-painting brushes (we already have Paint Studio for material colour).
- Sculpting across multiple meshes simultaneously — strokes target the active mesh only.

---

## Order of operations

1. **Ship 1 first** (~½ day equivalent). It's independent, low-risk, makes the rest of the app smarter immediately.
2. **Ship 2** in two passes: (a) brushes + history + mirror, no save → playable prototype; (b) masking + subdivide + bake-and-save → production.

Approve and I'll start with Ship 1, then move straight into Sculpt Studio.
