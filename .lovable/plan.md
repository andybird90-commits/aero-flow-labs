

## Real-STL displacement pipeline (aero kit from ground-truth body)

You have real STLs for a handful of hero cars and they're "messy but full". Best move: **start from your real STL and push its surface outward where the concept image shows aero.** No alignment problem (the STL is already the truth), no manifold roulette between two AI meshes, and the kit's mating face is panel-accurate by construction.

### How it works

```text
Hero car STL (ground truth) ──► repair/normalise ──► oriented base mesh
                                                            │
Approved concept (4 angles) ──► silhouette + depth maps ────┤
                                                            ▼
                                               Surface displacement
                                          (push base outward where the
                                           concept silhouette extends
                                           beyond the stock body)
                                                            │
                                                            ▼
                                            displaced.stl (full aero car)
                                                            │
                              boolean: displaced − base_dilated(2mm)
                                                            ▼
                                             aero_kit.stl (printable shell)
                                                            │
                                                            ▼
                                       split into connected components
                                       → splitter / wing / arches / etc.
```

The displacement step replaces "two independent AI meshes" (the hard problem) with "one known mesh nudged outward" (a tractable problem).

### What gets built

**1. Hero-car STL library**
- New `car_stls` table linking `car_template_id` → STL in a new private `car-stls` bucket, with metadata (orientation axis, wheelbase reference points, "manifold-clean" flag).
- A small admin page (`/settings/car-stls`, gated by `admin` role you already have) to upload an STL per template, set its forward axis, and run a one-click repair pass.
- Repair pass = edge function `repair-car-stl`: vertex weld, hole-fill, normal-orient, optional decimation to ~200k tris. Saves a `repaired_stl_path` next to the original so the source stays untouched.

**2. New edge function: `displace-stl-to-concept`**
- Input: `concept_id` (we already know the project → car_template → STL).
- Loads repaired hero STL.
- Renders the STL from the same 4 camera angles your concept renders use (front, rear, side, rear-3/4) at known intrinsics → produces stock silhouettes/depth.
- Computes per-view "aero delta" = where the concept silhouette extends beyond the stock silhouette (splitter lip, wing, flares, ducktail kick, skirt drop).
- Back-projects each delta into 3D and applies it as a **bounded outward displacement** on the base STL's vertices (capped at e.g. 120 mm so glitches can't blow up the mesh).
- Outputs `displaced.stl`.

**3. New edge function: `subtract-aero-kit`**
- Input: `concept_id`. Loads `displaced.stl` and the repaired base STL.
- Runs `displaced − dilate(base, 2mm)` via **manifold-3d** (WASM) — works reliably here because both meshes share topology lineage; no ICP gymnastics.
- Removes fragments < 50 cm³, welds, smooths (existing Laplacian pass).
- Splits remaining geometry into connected components and classifies each by bounding-box position (front/rear/side/roof/under) into your existing part kinds (`splitter`, `diffuser`, `side_skirt`, `wide_arch`, `wing`, `ducktail`, `bonnet_vent`).
- Saves combined `aero_kit.stl` plus per-part STLs as `concept_parts` rows tagged `source: 'boolean'`.

**4. UI changes**
- **Concepts page**: approval action becomes "Approve → Build kit from real STL" when the project's car has a `car_stls` entry. Shows a 3-step progress strip: `Displace`, `Subtract`, `Split`. Falls back to the existing per-part extraction flow when no hero STL exists for that car.
- **Library page**: new "Aero kit (boolean)" section showing the combined kit and each split component, with a per-part "source" badge (`Boolean` / `Extracted` / `Parametric`).
- **Parts page**: keeps the parametric kit. Adds a `Source: parametric / boolean` toggle so you can flip between the dial-tweakable parametric version and the AI-extracted real-shape one.
- **Exports**: gains "Full aero kit (single STL)" alongside per-part files.

**5. Schema additions** (one migration)
- New table `car_stls` (`id`, `car_template_id`, `user_id`, `stl_path`, `repaired_stl_path`, `forward_axis`, `manifold_clean bool`, timestamps).
- New private bucket `car-stls` with admin-write / authenticated-read RLS.
- `concepts.aero_kit_url text`, `concepts.aero_kit_status text`, `concepts.aero_kit_error text`.
- `concept_parts.source text default 'extracted'` (`parametric` | `extracted` | `boolean`).

### Trade-offs to know

- **Repair quality matters more than anything else.** Your STLs are "messy but full" — the repair pass needs to actually produce a manifold or the boolean step throws. Built-in fallback: if repair can't reach manifold, we mark the STL `manifold_clean: false` and the boolean flow refuses to run for that car (the per-part extraction flow still works, so users aren't blocked).
- **Camera registration.** The displacement step assumes the concept renders are taken with predictable cameras — they are today (your 4-angle generator uses fixed framings), so this is fine, but any change to that framing breaks displacement until re-tuned.
- **Resolution.** Per-vertex displacement is only as fine as the base STL's tessellation around aero hotspots. We pre-subdivide front bumper / rear bumper / arches / underfloor regions to ~5 mm spacing before displacing so wings and lips have surface to push out.
- **Pose drift between concept and STL.** Concept renderer uses the same orientation conventions as the STL (forward = -Z). We expose `forward_axis` on `car_stls` so cars exported from different DCC tools can be corrected without re-uploading.

### Rollout order

1. `car_stls` table + bucket + admin upload page + `repair-car-stl` edge function. (Foundation — get one hero car cleanly imported end-to-end.)
2. Render-from-STL helper (re-uses your existing 3D renderer headlessly) so you can see the stock silhouette next to the concept silhouette as a sanity check before any displacement runs.
3. `displace-stl-to-concept` + viewer for the displaced mesh on the Library page.
4. `subtract-aero-kit` + connected-component split + per-part classification.
5. Concepts/Parts/Library/Exports UI wiring + `source` toggle.

### What this does not change

- Per-part extraction (`extract-part-from-concept`) and the parametric kit both stay. The boolean flow is purely additive — it lights up when the project's car has a hero STL, and you can ignore it otherwise.
- Meshy/Rodin choice for per-part extraction is a separate decision; this plan doesn't depend on it.

