# Claude → Blender parts generator (admin batch → curated library → Live Fit)

A new generation pipeline that uses Claude Opus as an *actor* (not just a validator) inside the existing Blender worker, driving a strict allowlist of bpy operators to build aero parts. Generated parts land in a new admin-curated catalog table, surface in the existing Build Studio `PartLibraryRail`, and reuse Live Fit / snap-to-surface to conform onto any donor car.

No on-demand user generation in v1. Admin-only batch jobs.

## Architecture

```text
Admin Batch Page                    Blender Worker (existing)              Build Studio
─────────────────                   ──────────────────────────             ─────────────
[part_kind, count,  ───dispatch──►  blender_jobs.py                        PartLibraryRail
 style prompts]      blender-job    └─ op_generate_part (NEW)              └─ pulls from
                                       └─ ai_actor.py loop (NEW)              generated_parts
                                          ├─ Claude Opus tool-use              where approved=true
                                          ├─ allowlisted bpy ops               
                                          ├─ supervisor render+verdict      User picks → drag in
                                          └─ export GLB + thumb             → Live Fit (existing)
                                                                            → snap-to-surface
                                    ▼
                                    upload-blender-output
                                    └─ inserts row into generated_parts
                                                                            
                                    ┌────────────────────────────┐
                                    │  /admin/generated-parts    │ ◄── you approve / reject
                                    │  approve | reject | retry  │     before users see them
                                    └────────────────────────────┘
```

## Scope

### Phase 1 — Actor loop in the Blender worker
- New `blender-worker/ai_actor.py`: Claude tool-use loop that proposes the next bpy op, the worker executes it under a strict allowlist, supervisor renders quad views, Claude sees result + decides next step, loop until "done" or step cap.
- Operator allowlist (~15 ops): `primitive_cube/cylinder/uv_sphere_add`, `extrude_region`, `bevel`, `subdivide`, `loop_cut`, `mirror_modifier`, `solidify_modifier`, `subsurf_modifier`, `boolean_union/difference`, `transform.translate/rotate/resize`, `select_by_index`, `mesh.smooth_shade`, `mesh.delete`. No raw Python eval.
- Hard caps: max 40 steps, max 50k tris, bbox sanity (must lie within target envelope), 5-min wall-clock timeout.
- Existing `ai_supervisor.py` becomes the final gatekeeper after the actor declares "done" — verdict accept/retry/fail.

### Phase 2 — New job type + dispatch
- `blender_jobs.py`: register new handler `generate_part`. Inputs: `part_kind`, `style_prompt`, `target_envelope_mm` (bbox the part should fit inside), `symmetry` (none/x), `seed`.
- Reuses existing dispatch (`dispatch-blender-job`) and result upload (`upload-blender-output`) — no new worker plumbing.
- `upload-blender-output` extended to recognize `generate_part` jobs and INSERT into `generated_parts` (status='pending_review').

### Phase 3 — Catalog table + admin UI
- New table `generated_parts`: `id, part_kind, style_tag, prompt, glb_url, thumbnail_url, bbox_mm, tri_count, blender_job_id, status (pending_review|approved|rejected|retry), notes, created_by, created_at`.
- RLS: only admins can SELECT non-approved rows; all authenticated users can SELECT `status='approved'`. Insert via service role only (worker upload).
- New page `/admin/generated-parts`:
  - "New batch" form: pick part_kind, count (1–10), style prompts (one per line), target envelope. Kicks off N parallel `generate_part` jobs.
  - Grid of pending parts: GLB preview (reuse `PartMeshViewer`), Approve / Reject / Regenerate buttons.

### Phase 4 — Surface in Build Studio
- `PartLibraryRail` already loads parts; add a new tab/section "Generated" that pulls `generated_parts WHERE status='approved'`, grouped by `part_kind`.
- User drags a part into the viewport → existing flow runs: snap-to-surface → Live Fit → trim-to-body. **Zero new fitting code** — Live Fit already handles non-manifold GLBs after the recent fix.
- Add `generated_part_mesh` to `library_items` via a sync trigger (mirror existing `sync_concept_part_library_items` pattern) so it shows up in the global library too.

### Phase 5 — Initial seed batch (after you approve UI)
Generate a starter catalog covering the kinds you picked:
- Arches: 6 styles (subtle / moderate / wide / box / smooth / vented)
- Wings & ducktails: 8 (low ducktail, tall ducktail, single-plane GT, dual-plane GT, swan-neck, gurney-flap, integrated lip, drift-style)
- Skirts & diffusers: 6 (flat skirt, winged skirt, splitter-extended, F1-style diffuser 3-channel, 5-channel, integrated bumper diffuser)
- Vents/scoops/canards: 8 (NACA hood, raised hood scoop, roof scoop, single canard, dual canard, fender vent louvered, fender vent slotted, side intake)
- Bumpers & lips: 6 (front lip subtle, splitter aggressive, full front bumper GT, rear bumper add-on, integrated rear, bash bar)

Total ~34 parts. Will require manual approval pass — expect 50–70% first-attempt yield, regenerate the rest.

## Technical details

**Why allowlist not freeform Python:** prevents infinite loops, scene corruption, security risk, and gives the actor a tractable action space (Claude is much better at tool-use with constrained schemas than at writing correct bpy from scratch).

**Why Claude Opus over Gemini for the actor:** you already have it wired up in `ai_supervisor.py` with vision tool-use. Opus is materially better at multi-step iterative refinement with visual feedback than Gemini Flash/Pro for this kind of task. Falls back to Sonnet then Haiku via existing `ANTHROPIC_FALLBACK_MODELS`.

**Cost envelope:** ~15–25 Claude calls per part × ~5k input tokens × 34 parts ≈ a few dollars per full batch run. Bounded because admin-triggered, not per-user.

**Parts are body-agnostic:** the actor generates parts in a canonical local frame (origin at mount point, +Y forward, +Z up) sized for a "reference" car envelope (~4.5m length). Live Fit handles per-car conforming at placement time — same code path that already works for hand-crafted parts.

**Reusing existing infrastructure:**
- `dispatch-blender-job` edge function — no changes
- `upload-blender-output` edge function — small extension to insert into `generated_parts`
- `blender-worker` HTTP server (`worker.py`) — no changes, just ships the new `ai_actor.py` module
- Build Studio Live Fit, snap-to-surface, trim-to-body — no changes
- `PartLibraryRail`, `PartMeshViewer` — minor additions to load/display the new tab

**What's explicitly NOT in this plan (deferrable):**
- Per-user "Generate custom part" button (Option A from earlier discussion)
- Material/UV assignment (parts come out as raw geometry; existing paint system handles look)
- Hardpoint auto-detection on generated parts (admin sets manually for now via a follow-up tool)

## Files to add
- `blender-worker/ai_actor.py`
- `supabase/migrations/<ts>_generated_parts.sql`
- `src/pages/AdminGeneratedParts.tsx`
- `src/lib/admin/generated-parts.ts`

## Files to modify
- `blender-worker/blender_jobs.py` — register `generate_part` handler
- `supabase/functions/dispatch-blender-job/index.ts` — accept new job_type
- `supabase/functions/upload-blender-output/index.ts` — insert generated_parts row
- `src/components/build-studio/PartLibraryRail.tsx` — add Generated tab
- `src/App.tsx` + sidebar — admin route

## Acceptance
1. From `/admin/generated-parts`, kick off a 4-part batch of "ducktail" with different prompts → 4 jobs run → 4 GLBs appear in pending grid within ~5 min.
2. Approve 2, reject 2 → approved ones appear in Build Studio's Generated tab.
3. Drag an approved ducktail onto the GT3 R → Live Fit conforms it onto the rear deck → no yellow blob, no errors.
