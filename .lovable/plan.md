
## What's actually true today (good news)

You **are already drawing on the real bodywork.** I traced it end-to-end:

- `HeroStlCar` loads your project's hero STL, scales it to wheelbase, and mounts it inside `sceneRootRef`.
- `SurfaceStrokeRecorder` raycasts pointer events against `sceneRootRef.current`, so every Surface stroke lands on actual triangles of the Boxster body.
- `SurfaceStrokesRenderer` builds a `TubeGeometry` along those world-space hit points and renders it with `polygonOffset` so it sits *on* the panel without z-fighting.

So functionally we're already there. What's missing is the **render quality**. In the mockup, the car is a glossy painted body in a dark studio with HDRI reflections, a polished reflective floor, soft shadows, bloom on the highlights, and crucially **no visible grid, no toolbars overlaying the car, no orange wireframe overlay**. Today our viewport defaults show:

- A flat-ish STL, often unpainted (no `materialTags` yet) so it falls back to the body material only — looks single-tone.
- The orange grid is on by default and competes visually with the car.
- The quality preset works, but **"Studio" is the default and that's fine** — the issue is what surrounds the car, not the postprocessing pipeline.
- No "Presentation Mode" — you can't get a clean hero shot without manually toggling grid + closing rails.

## What I'll change

### 1. Make the default render look premium out of the box (`BuildStudioViewport.tsx`)

- **Switch the default `Environment` preset** from whatever the paint finish defaults to into `"studio"` for unpainted cars, so the body picks up real HDRI reflections immediately. Today an unpainted STL on a non-reflective preset reads as flat plastic.
- **Bump the body material's default look** when no `paintFinish` has been chosen yet: pearl-white with `clearcoat: 1.0`, `clearcoatRoughness: 0.05`, `metalness: 0.4`, `roughness: 0.35`, `envMapIntensity: 1.4`. This is what makes the mockup "pop" — it's not postprocessing, it's a clearcoat paint shader on a good HDRI.
- **Tune the rim light** (the orange `directionalLight` at `[-6, 4, -3]`) down from `0.45` to `0.25` and shift it cooler — right now it tints the whole back of the car orange.
- **Add a soft fill light** from camera direction at `0.3` intensity so the front never goes muddy.

### 2. Hide the grid by default + clean background

- Default `showGrid` to **off** in `BuildStudio.tsx` page state. Users who want it can toggle it on from the toolbar — but the first impression should be car-on-floor, not car-on-blueprint.
- Keep the `<color attach="background" args={["#0a0a0c"]} />` as is — it matches the mockup's near-black studio.

### 3. New "Presentation Mode" toggle (the big one)

Add a single button to `BuildStudioToolbar` (icon: `Maximize2` or `Eye`) that, when active:

- Hides the toolbar (auto-fades), the status bar, both rails, and the gizmo viewcube.
- Forces `quality = "cinematic"` and `showGrid = false`.
- Forces `Environment` to `"studio"`, lifts `accumulativeShadows`, bumps `Bloom` intensity slightly.
- Exits on `Esc` or by clicking a small floating "Exit Presentation" pill in the top-right.

This is the screenshot mode. One click → mockup-quality hero render, your annotations still drawn on the panels.

### 4. Make the annotation strokes look like the mockup

The mockup's strokes are **slightly glowing white/cyan ribbons**, not flat tubes. Tiny tweaks to `SurfaceStrokesRenderer` in `SurfaceStrokes.tsx`:

- Switch from `meshBasicMaterial` to `meshStandardMaterial` with `emissive: stroke.color`, `emissiveIntensity: 1.6`, `metalness: 0`, `roughness: 0.4`. Bloom (already in the pipeline at Studio quality) will then bleed the edges into a soft halo.
- Default annotation color in the store: change from `#fb923c` (orange) to `#e2e8f0` (off-white) so first-time strokes match the mockup. The color picker still works.
- Slightly thicker default width (4 → 5 px) so they read at a glance.

### 5. Floor

Already wired via `ShowroomFloor` — `Studio` and `Cinematic` presets enable the reflector. Just confirm the default project quality is `"studio"`. No code change needed beyond default verification.

### 6. Defer optional polish (NOT in this pass — call out for next)

- **Per-panel material classification** for unpainted cars (so the windows are glass, the wheels are metal, etc., even before someone opens Paint Studio). This requires running the existing `classify-car-materials` edge function on import. Worth a separate pass.
- **Screen-space-reflections (SSR)** post-pass — heavier, only worth it on Cinematic. Skip for now; the reflective floor + HDRI does 90% of the work.

## Files I'll touch

- `src/components/build-studio/BuildStudioViewport.tsx` — lighting tweaks, default env, presentation-mode props.
- `src/components/build-studio/annotate/SurfaceStrokes.tsx` — emissive tube material, default color/width.
- `src/lib/build-studio/annotate/store.ts` — default color `#e2e8f0`, default width `5`.
- `src/lib/build-studio/paint-finish.ts` — bump `DEFAULT_PAINT_FINISH` clearcoat / envMapIntensity.
- `src/pages/BuildStudio.tsx` — `showGrid` defaults to `false`, add `presentationMode` state, wire toolbar button.
- `src/components/build-studio/BuildStudioToolbar.tsx` — add Presentation Mode button + Esc handler.
- `src/components/build-studio/BuildStudioStatusBar.tsx` — hide when presentation active (driven by parent prop).

## What you'll see after

- Open Build Studio on the Boxster: glossy clearcoated car under HDRI reflections on a polished dark floor, no grid, no orange tint. Toolbar + rails still there for editing.
- Hit the new **Presentation** button (top-right of toolbar): UI fades, cinematic post kicks in, you're left with the car and your strokes — the screenshot you sent.
- Surface strokes glow softly (bloom) instead of looking like matte plastic noodles.

No backend, no migrations, no breaking changes — purely visual + a new toggle.
