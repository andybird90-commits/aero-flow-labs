# Add an AI brain to the cloud Blender worker

You're right — `BLENDER_WORKER_URL` already points at your cloud Blender box, edge functions (`dispatch-blender-job`, `bake-bodykit-from-shell`, `geometry-job-status`, `upload-blender-output`) all talk to it, and `LOVABLE_API_KEY` is already in your secrets. Nothing about hosting needs to change. We just upgrade the worker code on that server from a "blind script" into an **observe → reason → act loop** driven by Lovable AI.

## What's broken today

`blender_jobs.py::op_bake_bodykit` does:
1. Boolean subtract donor − shell.
2. Split by loose parts.
3. Label each island with a bbox heuristic (`_classify_aero_slot`).
4. Upload, done.

If step 1 produces a yellow blob, no one notices. If step 3 over-splits, no one notices. If step 4 mislabels the splitter as a diffuser, no one notices. There's no eyes on the result.

## What we're adding

A small `ai_supervisor.py` next to `blender_jobs.py` on the cloud worker. After each meaningful step the worker:

1. **Renders 4 thumbnails** (front / side / top / iso) of the current scene at 512px using Blender's Eevee — fast, no GPU needed.
2. **Collects metrics**: triangle count, manifold check (`bmesh.ops.holes`), bbox dims, panel count.
3. **Sends thumbs + metrics + step name** to `https://ai.gateway.lovable.dev/v1/chat/completions` using `LOVABLE_API_KEY` and `google/gemini-2.5-pro` (vision).
4. **Asks for a structured decision** via tool calling: `{ verdict: "accept" | "retry" | "fail", reason: string, suggested_params?: {...} }`.
5. **Acts on the verdict** — retry the step (max 2x) with adjusted tolerance/solver, accept and continue, or write a clean failure with the AI's reasoning into `result.json`.

For the labelling step specifically, the AI gets a **per-panel render + bbox + extents** and returns a slot name from a fixed enum (`front_splitter, front_canard_l/r, side_skirt_l/r, rear_diffuser, rear_wing, hood_vent, fender_flare_l/r, ...`) plus a confidence and one-line rationale.

## Files that change

### `blender-worker/ai_supervisor.py` *(new)*
- `render_quad_views(scene, out_dir) -> list[Path]` — 4 Eevee renders, cheap.
- `collect_metrics(obj) -> dict` — tri count, manifold, bbox, watertight check.
- `ask_validator(step_name, thumbs, metrics) -> Verdict` — single Gemini call with vision.
- `ask_classifier(panel_obj, panel_thumb) -> {slot, label, confidence, reason}` — same gateway, slot enum enforced via tool schema.
- All HTTP via `requests` (already a worker dep), reads `LOVABLE_API_KEY` from env.

### `blender-worker/blender_jobs.py` *(modified)*
- Wrap `op_bake_bodykit` in an **agent loop**: boolean → validate → split → validate → per-panel classify. Up to 2 retries on the boolean step with bumped `tol_mm` / swapped solver if AI says "retry".
- Replace `_classify_aero_slot` bbox heuristic with `ai_supervisor.ask_classifier` (keep bbox as fallback only if AI call fails).
- Write AI reasoning into `result.json` so it flows back through `upload-blender-output`.

### `blender-worker/start.ps1` *(modified)*
- Add `LOVABLE_API_KEY` to the env block and `LOVABLE_FUNCTIONS_URL` (already there). One line each. Document in `docs/blender-worker.md`.
- **Action you'll take on the cloud server**: pull the new code and add `LOVABLE_API_KEY=...` to the env / systemd unit / wherever `start.ps1` equivalent runs. I'll spell out exactly which env vars in the docs.

### `supabase/functions/bake-bodykit-from-shell/index.ts` *(modified)*
- When ingesting `result.json`, pull the new `ai_label`, `ai_confidence`, `ai_reasoning`, `ai_attempts` fields and write them into `body_kit_parts` / `body_kits`.

### Database migration *(new)*
- `body_kit_parts`: add `ai_label text`, `ai_confidence numeric`, `ai_reasoning text`.
- `body_kits`: add `ai_attempts integer default 0`, `ai_notes text`.
- No backfill — only new bakes get the columns populated.

### `src/components/build-studio/BodyKitViewerDialog.tsx` *(modified)*
- Show AI confidence badge + reasoning tooltip per panel.
- Show overall `ai_notes` at the kit level if present (so you see "shell collapsed during boolean, retried with tol=8mm, accepted" rather than a silent success).

## What this fixes

- **The mislabelled splitter/diffuser** → AI sees the actual geometry, not just bbox z-position.
- **The yellow-blob bake** → validator catches it before save and either retries with different params or fails loudly with a reason.
- **"Worker is just following a script"** → it now reasons about its own output between steps.

## What's explicitly out of scope

- No code-writing agent (AI doesn't author new Blender Python on the fly — too risky to sandbox, can revisit later).
- No retraining / fine-tuning. Pure prompt + vision.
- No changes to `dispatch-blender-job`, `dispatch-geometry-job`, `geometry-job-status`, `blender-job-status`, or `upload-blender-output` — the protocol between Lovable Cloud and your worker stays identical.
- No new external services. Uses Lovable AI gateway you already have.

## Cost / latency note

Each bake currently makes 0 AI calls. After this PR: ~1 validator call after boolean + 1 after split + 1 classifier call per panel (typically 6–10). At Gemini 2.5 Pro that's ~10–20s extra wall time and ~12 vision calls. If that's too heavy I'll switch the per-panel classifier to `gemini-3-flash-preview` and keep Pro only for the validator — drops cost ~5x with minimal accuracy loss.

## Rollout

1. Land the migration + edge function changes (safe even if worker hasn't been updated — old worker just won't populate the new columns).
2. You pull the worker code on the cloud box and add `LOVABLE_API_KEY` to its env.
3. Run one bake. Inspect AI reasoning in the dialog.
4. If labels look right, delete the old bad bakes and re-bake.