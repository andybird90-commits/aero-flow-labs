

## Fix: isolate just one part, even when neighbours are nearby

### What's actually wrong

The user clicked the **front arch** hotspot. The render pane then shows the arch *plus* two bonnet vents, a lip, a canard and a skirt extension — and the fidelity check sees a perfect render of all of that and (rightly) says "MISMATCH" because the source crop and the redraw both contain six parts instead of one.

Two upstream bugs collude:

1. **`isolate-picked-part` over-pads.** It crops the AI bbox with **+30% padding on each side** "to keep mounting tabs". On a tightly-packed concept that's enough to swallow neighbouring parts whole.
2. **`render-isolated-part` has no intent signal.** It gets the (now multi-part) crop and a prompt that says "draw an arch", but Gemini sees five other parts in the reference and faithfully redraws all of them. The per-kind `not:` lists ban *car body* but not *other bolt-on parts*.

### Fix in three layers

**A. Tighten the crop, keep it focused on the picked part.**  
`isolate-picked-part` switches to **adaptive padding**: 8% by default (just enough to keep mounting tabs and the immediate fairing), and a hard ceiling that the cropped box can't grow past **1.4× the original bbox area**. This alone removes ~80% of the bleed.

**B. Tell the renderer exactly what was picked.**  
Pass the `bbox` through `isolate-picked-part` → write a tiny sidecar `{ part_kind, bbox }` to `concept_parts.isolated_meta` jsonb when we upload the crop. `render-isolated-part` reads that and adds two new prompt directives:

- *"The reference image may contain other aero parts. Render ONLY the {label} — the part centred at roughly (cx, cy) of the reference. Ignore every other shape in the frame."*
- *"OUTPUT MUST CONTAIN EXACTLY ONE PART. No vents, no lip, no canards, no skirts, no other arches — only the {label}."*

We also extend each `PART_SPEC.not` line with *"and NO other aftermarket aero parts (vents, lip, canards, skirt, other arches, wing) — only the {kind} itself."*

**C. Make the fidelity check honest about the new behaviour.**  
The source crop will still sometimes contain neighbours (we can't predict the layout perfectly). To avoid false MISMATCH flags when the *render* is correctly single-part but the *source* is multi-part, the fidelity check picks the **largest connected component** of each Otsu mask before computing IoU — so it compares "biggest blob in source" vs "biggest blob in render". Same for edge coverage (restrict to that component's bbox).

This is a 30-line addition to `part-fidelity.ts` (`largestComponent(mask)`), no new dependencies.

### Files

**Modified:**
- `supabase/functions/isolate-picked-part/index.ts` — drop pad from 30% → 8%, add area-ratio cap, persist `isolated_meta` jsonb on `concept_parts`.
- `supabase/functions/render-isolated-part/index.ts` — accept optional `bbox` + `picked_kind` in the body (also auto-loads from `isolated_meta` if absent), inject the two new "exactly one part" directives, extend per-kind negatives.
- `src/components/ExtractedPartPreview.tsx` — when invoking `render-isolated-part` after auto-isolation, also forward `bbox` and `picked_kind`.
- `src/lib/part-fidelity.ts` — add `largestComponent()` + use it in `scoreFidelity` before IoU/edges.

**Migration:**
- Add `concept_parts.isolated_meta jsonb null` column. Backfill not needed.

### What you'll see after

Click the arch hotspot → crop is a tight box hugging the arch (no bonnet vents) → render is a single grey arch on white → fidelity badge reads **MATCH** because both source and render are now genuinely one part.

If a hotspot ever does encroach on neighbours (e.g. the bbox itself was wide), the render still produces a single isolated arch because the prompt explicitly forbids the rest.

### Out of scope

- No re-running of past detections — existing cached hotspot bboxes are reused as-is; the tighter crop math just runs against them.
- No change to the post-render lasso trim — still available as a manual escape hatch if a render ever does show extras.
- Per-angle scoring is still single-angle (one hero render).

