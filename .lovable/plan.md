# 🏁 The "Cayman → Hypercar Ghost" Master Plan

You want the full vision: a designer points their phone at a real Cayman in a car park, and the hypercar bodyshell materialises over it at 1:1 scale. That's the **endgame**. To get there cleanly without breaking what already works, I'm proposing **5 sequenced phases**, each one shippable on its own and each one earning the right to the next.

Phases 1–4 land in this build. **Phase 5 (the AR moment)** I'll scaffold but recommend we ship as a follow-up after we shake out 1–4 in real use — AR has device/permission/calibration sharp edges that deserve their own focused round.

---

## Phase 1 — "Make It Look Like A Showroom" 🎨

The biggest perceived-quality jump for the least risk. Pure visual polish on top of the existing scene.

**New dep:** `@react-three/postprocessing@^2.16.0` (R3F v8 compatible)

**Changes:**
- **Postprocessing pipeline** in `BuildStudioViewport.tsx`:
  - **SSAO** (Screen-Space Ambient Occlusion) — adds the dark "contact crevices" between parts and body that sells the assembly as one object
  - **Bloom** (subtle, threshold ~0.95) — makes paint highlights and HDRI reflections pop
  - **SMAA** anti-aliasing — cleaner edges than MSAA at high DPI
  - **Vignette + ToneMapping** (ACESFilmic) — cinematic look matching Cyberpunk-orange brand
- **Reflective floor** via drei's `MeshReflectorMaterial` — replaces the flat ContactShadows ground with a subtly mirrored studio floor (toggleable, defaults on)
- **Accumulative shadows** via drei's `<AccumulativeShadows>` + `<RandomizedLight>` — soft progressive shadows that look raytraced (computed once, near-zero runtime cost)
- **Toolbar toggle**: "Render quality" dropdown (Draft / Studio / Cinematic) — lets users drop SSAO + Bloom on weaker laptops

**Files:**
- `src/components/build-studio/BuildStudioViewport.tsx` (extend)
- `src/components/build-studio/PostFX.tsx` (new — wraps EffectComposer)
- `src/lib/build-studio/render-quality.ts` (new — quality preset enum + persisted in localStorage)
- `src/pages/BuildStudio.tsx` (add quality dropdown to sticky toolbar)

---

## Phase 2 — "Make It Feel Like A Pro Tool" 🛠️

Interaction upgrades a real designer expects.

**Changes:**
- **PivotControls** (drei) as an *alternative* gizmo with annotated axes + plane handles. Toolbar gets a 4th transform mode: "Precision" — uses PivotControls instead of TransformControls for finer dragging with on-screen numeric readouts.
- **Selection outline** — replace the current "selected" tint with a proper edge outline pass (postprocessing's `Outline` effect, orange to match brand). Reads instantly even on dark parts.
- **Frame Selection** (`F` key, also toolbar button) — uses drei's `<Bounds>` to smoothly fly the camera to fit the selected part. With nothing selected, frames the whole car.
- **Measurement tool** — toolbar mode that lets the user click two points on any mesh and draws a line + dimension label between them (mm). Stored in component state, cleared on mode-exit. Useful for "is my splitter clearing the wheel arch?"
- **Collision warnings** — for each pair of placed parts, compute axis-aligned bounding-box intersection on each commit. Intersecting parts get an orange pulsing outline + a toast "Splitter intersects Front Bumper". Cheap (no full-mesh BVH yet — we can add `three-mesh-bvh` later if AABB is too coarse).
- **Snap-to-surface** — when dragging a part with the new "Stick to body" toggle, raycast from the part centre downward into the hero shell mesh and project it onto the surface normal. Makes splitters/skirts hug bodywork automatically.

**Files:**
- `src/components/build-studio/BuildStudioViewport.tsx`
- `src/components/build-studio/MeasurementTool.tsx` (new)
- `src/lib/build-studio/collisions.ts` (new — AABB intersection helpers)
- `src/lib/build-studio/surface-snap.ts` (new — raycast projection)
- `src/pages/BuildStudio.tsx` (toolbar additions, `F` shortcut)

---

## Phase 3 — "Show Off The Build" 🎬

Output the car in formats people actually share.

**Changes:**
- **4K Screenshot** — toolbar camera-icon dropdown gets:
  - 1080p / 4K / 8K options
  - Renders to an offscreen canvas at the chosen resolution (preserves DPR), downloads as PNG
  - Optional "Hide UI" toggle (hides snap zones + grid + gizmos in the shot)
- **Turntable Video Export** — modal: pick duration (5/10/20s), resolution, FPS. Animates camera in a circle around the car and captures frames via `MediaRecorder` API → downloads `.webm`. No server round-trip.
- **GLTF Export** — uses three's `GLTFExporter` to dump the entire scene (hero + skin + placed parts, baked transforms) as `.glb`. Lets users open in Blender, Unreal, KeyShot, etc.
- **USDZ Export** — uses three's `USDZExporter` for iOS AR Quick Look. Tap a link on iPhone Safari → see the car in your room. (Stepping stone to Phase 5.)
- **Share link** — already have project URL; add a "Copy snapshot link" button that bundles current camera position + paint + visible parts into a hash so a teammate opens to the exact same view.

**Files:**
- `src/lib/build-studio/exporters.ts` (new — screenshot, turntable, glb, usdz)
- `src/components/build-studio/ExportDialog.tsx` (new)
- `src/pages/BuildStudio.tsx` (export menu)
- Share-link state encoded in `?view=...` hash

---

## Phase 4 — "AR Quick Look" (Stepping Stone) 📱

Before the full live-camera AR, ship the easier 80% win: **on-device 3D viewing** with tap-to-place AR on iOS via the USDZ from Phase 3.

**Changes:**
- New page `/build-studio/preview/:projectId` — minimal full-screen viewer optimised for mobile (no sidebars, swipe-rotate, pinch-zoom)
- iOS detection → "View in AR" button uses `<a rel="ar" href="...usdz">` (native iOS Quick Look — no install, no permission, just works)
- Android detection → "View in AR" uses Scene Viewer intent: `intent://arvr.google.com/scene-viewer/...` with the GLB from Phase 3
- QR code on the desktop Build Studio so designers scan-to-phone
- Caches generated usdz/glb in Lovable Cloud storage per project so we don't re-export every time

**Files:**
- `src/pages/BuildStudioPreview.tsx` (new)
- `src/components/build-studio/ARLaunchButton.tsx` (new)
- `src/components/build-studio/ShareToPhoneQR.tsx` (new — uses `qrcode.react`)
- Edge function `supabase/functions/cache-ar-asset/index.ts` (new — re-exports + stores GLB/USDZ on demand)

**New deps:** `qrcode.react@^4`

---

## Phase 5 — "The Cayman Moment" 🚗👻

The real-camera, ghost-overlay, scaled-to-life AR experience. **I'm scoping this as a separate ship after Phases 1–4 settle**, because it's the riskiest part and benefits from real-device QA cycles. But here's exactly how it'll work when we build it:

**Core stack:**
- `@react-three/xr@^5` (R3F v8 compatible WebXR bindings)
- WebXR `immersive-ar` session with `hit-test` + `dom-overlay` features
- Falls back to MindAR's image-tracking on iOS Safari (which doesn't support WebXR yet) — using a printed marker placed on the bonnet for a v1, then upgrading to markerless once Apple ships WebXR (rumoured for Vision OS web)

**The flow:**
1. Designer opens `/build-studio/ar/:projectId` on an Android phone (Chrome supports WebXR AR today)
2. "Start AR" button requests camera + motion permission
3. Phone screen shows live camera feed
4. User taps the bonnet of the Cayman → hit-test plants a 1:1-scale anchor
5. The hypercar bodyshell GLB renders ghosted (40% opacity, orange edge outline) over the real car
6. Drag/pinch to nudge alignment; "Lock" button freezes the overlay
7. Walk around — the shell stays glued to world space via WebXR's persistent anchors
8. "Capture" button grabs a still or 5-second clip with the live ghost overlay → downloadable composite
9. iOS path (until WebXR): print-and-stick a small QR/marker on the windscreen, MindAR tracks it, less robust but works today

**Calibration helpers:**
- Scale slider (0.95×–1.05×) for fine adjustment per-vehicle (every Cayman 718 vs 981 vs 987 has slightly different proportions)
- Three known reference points the user can tap on their car (front badge, door mirror base, rear badge) — we solve a Procrustes alignment to lock the shell to those anchors
- "Save calibration" — per-donor-car alignment offsets stored in DB so they don't have to re-align next session

**Files (when we build it):**
- `src/pages/BuildStudioAR.tsx` (new, mobile-only route)
- `src/components/build-studio/ar/ARSession.tsx`
- `src/components/build-studio/ar/HitTestReticle.tsx`
- `src/components/build-studio/ar/GhostShell.tsx`
- `src/components/build-studio/ar/CalibrationGuide.tsx`
- `src/lib/build-studio/ar/procrustes.ts` (3-point alignment math)
- DB migration: `ar_calibrations` table (project_id, donor_car_template_id, position/rotation/scale offsets, anchor points)

**Why I want to ship this as Phase 5 separately:** WebXR support is uneven (great on Android Chrome, nonexistent on iOS Safari today). If I bundle it into this round, it'll dominate the testing time and delay the 80% wins in 1–4 that work everywhere. Better to land 1–4 solidly, then dedicate a focused round to nailing AR on real hardware.

---

## Suggested Build Order

```
Round 1 (this approval):  Phase 1 — Visual quality leap
Round 2:                  Phase 2 — Pro interactions
Round 3:                  Phase 3 — Export & share
Round 4:                  Phase 4 — Mobile preview + AR Quick Look
Round 5 (separate):       Phase 5 — Live-camera ghost overlay
```

Each round is ~1 conversation, leaves the app working, and the value compounds. Approve this and I'll start with Phase 1 immediately.

If you want me to **collapse Phases 1–3 into a single big round** (faster but more changes to QA at once), say the word and I'll do that instead.
