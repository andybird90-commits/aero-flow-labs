# Fix stuck bodykit bake by moving it to Blender

## Diagnosis (confirmed from logs)

- `body_kits` row `472b54fe…` is stuck in status `baking` since 21:43.
- `bake-bodykit-from-shell` edge function logs show **`ERROR CPU Time exceeded`** ~4 seconds after invocation.
- The current implementation tries to do CSG-style subtraction + crease splitting + welding **inside the Lovable Cloud edge runtime**, which has a hard ~5s CPU-time cap. `EdgeRuntime.waitUntil()` does *not* extend that cap — it only extends the response window.
- Result: every non-trivial shell mesh fails. The pipeline is fundamentally in the wrong place.

## Why fix this with Blender (not by tuning the edge function)

Blender already runs as `apex-blender-worker` on the Hetzner box at `https://blender.apexnext.co.uk`. It:
- has minutes of CPU, not seconds;
- does proper boolean CSG (donor-subtract) instead of our vertex-distance heuristic, which gives clean panel edges;
- can do mesh-island separation + bbox-based slot classification natively;
- already has the upload-back path wired (`upload-blender-output` edge function).

The cost is one new Blender op + a refactor of the bake function into a dispatcher.

## Changes

### 1. New Blender op: `bake_bodykit`
File: `blender-worker/worker.py` (add a new operation alongside the existing fit/repair/decimate ops).

Inputs:
- `donor_stl_url` — signed URL to donor car STL
- `shell_stl_url` — signed URL to body skin STL
- `baked_transform` — `{position, rotation, scale}` snapshot
- `tolerance_mm` — default 4
- `min_panel_tris` — default 80

Pipeline inside Blender:
1. Import donor + shell STLs.
2. Apply baked transform to shell (convert m→mm for translation, XYZ Euler for rotation).
3. Boolean DIFFERENCE: `shell - donor` (with a small inflation on donor to absorb tolerance_mm).
4. Separate by loose parts.
5. For each island: compute bbox, centroid, area, dominant normal.
6. Classify slot from bbox position vs. donor bbox (front/rear by X, side_skirt by |Y|, rear_wing by Z high + rear, splitter by Z low + front, etc.) — same rules currently in `classify-car-panels.ts`, ported to Python.
7. Export combined STL + one STL per island.
8. POST each STL back via `upload-blender-output` and return:
   ```json
   { "combined_url": "...", "panels": [{slot, label, confidence, url, triangle_count, bbox, centroid}] }
   ```

### 2. Rewrite `supabase/functions/bake-bodykit-from-shell/index.ts` as a dispatcher
- Keep the same request signature (`{ body_kit_id }`).
- Load kit + skin + donor rows (cheap DB work, well under CPU budget).
- Sign donor + shell STLs.
- POST to `${BLENDER_WORKER_URL}/bake_bodykit` with the payload above + bearer `BLENDER_WORKER_TOKEN`.
- Use `EdgeRuntime.waitUntil()` only for the *fetch + DB writes*, not for any mesh math.
- On worker response: download each panel's signed URL, upload to `body-skins/bodykits/<kit_id>/...`, insert `body_kit_parts` rows, flip status `ready`.
- On any failure (worker timeout, classification empty, etc.): flip to `failed` with the error message.

### 3. Status transitions
Stay aligned with existing UI labels in `body-kits.ts`:
`queued → baking → splitting → ready` (we drop the `subtracting` intermediate since Blender does it in one shot).

### 4. Recover the currently-stuck row
The existing `472b54fe…` row will be left in `baking` forever. After deploying:
- Add a one-shot SQL migration that flips any `body_kits` row stuck in `baking`/`subtracting`/`splitting` for >10 minutes to `failed` with error "Stale bake — please retry".
- Then the UI's existing delete button + "Bake bodykit" can be retried by the user.

### 5. Worker side: confirm `BLENDER_WORKER_URL` is reachable from edge
Already verified earlier today: `https://blender.apexnext.co.uk/health` returns `{ok:true, blender_exists:true}`. No infra work needed.

## Out of scope (explicitly)

- We're **not** changing the bake UI, the `body_kits` schema, or the `body_kit_parts` schema.
- We're **not** porting all 14 ops from the schema file — only `bake_bodykit` for now. The other ops can move to Blender opportunistically as users hit similar limits.
- The browser-side viewer code that reads `body_kit_parts` rows is unchanged.

## Risk / rollback

- If the Blender worker is down, bakes will fail fast with a clear error (instead of hanging) — strictly better than today.
- Old behaviour is fully replaced; there is no fallback path. If we need to revert, restore `bake-bodykit-from-shell/index.ts` from git.

## Acceptance test

1. On `/build-studio` with the `986 Hypercar` project, click "Bake bodykit from current shell".
2. Status chip transitions `queued → baking → splitting → ready` within ~30–60s.
3. `body_kit_parts` rows appear with sensible slot labels (`front_splitter`, `side_skirt`, etc.).
4. Each panel STL downloads from the `body-skins` bucket and renders in the viewer.
