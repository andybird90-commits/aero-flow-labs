

## Auto-fidelity check on extracted parts

### What you'll see

After Gemini draws the standalone clay render, the modal pauses for ~1s while we pixel-compare it against the cropped source. You get a **fidelity score (0–100)** and one of three badges in the review pane:

- **Match (≥75)** — green chip, flow continues normally
- **Drift (50–74)** — amber chip with a "Re-draw" button. Tooltip explains *why* it drifted (e.g. "outline 38% smaller", "missing rear segment").
- **Mismatch (<50)** — red chip blocking "Make 3D model" until the user re-draws or accepts the override.

A new **"Compare"** toggle in the review header overlays the source crop's silhouette on top of the render at 50% opacity, in red, so you can visually see what's missing (e.g. the dropped rear arch fairing in your screenshot).

### How the score works

We compute three sub-scores client-side (no edge function needed for the check itself — it's pure canvas math):

1. **Silhouette IoU (50% weight)** — Otsu-threshold both images to a binary part/background mask, normalise to the same bounding box and aspect, then compute intersection-over-union of the silhouettes. This catches "wrong shape entirely" cases.
2. **Outline coverage (30% weight)** — Sobel edge map of the source vs render. Measures what % of source edges have a render edge within 3px. Catches "dropped the rear segment" cases like your screenshot.
3. **Aspect & extent (20% weight)** — Compares bounding-box width/height ratio and pixel area. Catches "made it more symmetric" / "shrunk it" cases.

Final score = weighted sum. Thresholds (75 / 50) are tuned conservatively — better to flag a borderline render than miss a bad one.

### Where it plugs in

```text
isolating → rendering → [NEW: scoring ~1s] → review (with badge)
                                              └→ user clicks Re-draw → rendering again
```

The score is computed once when `setImages(renders)` fires in `runRender`. Result stored in component state, persisted to `concept_parts.fidelity_score` so re-opening the modal shows the same badge without recomputing.

### Files

**New:**
- `src/lib/part-fidelity.ts` — pure functions: `otsuMask`, `sobelEdges`, `silhouetteIoU`, `edgeCoverage`, `scoreFidelity`. Operates on `ImageData` from offscreen canvas. ~250 LOC, no deps beyond browser canvas.

**Modified:**
- `src/components/ExtractedPartPreview.tsx` — after `setImages`, kick off `scoreFidelity(isolatedUrl, renders[0].url)` in a worker-friendly async block; add `FidelityBadge` + Compare overlay toggle to the review section; gate the "Make 3D model" button on score ≥ 50 (or user-confirmed override).
- `supabase/migrations/<new>` — add `fidelity_score smallint` and `fidelity_breakdown jsonb` columns to `concept_parts`. Persist after computation via a tiny update.

**No edge function changes** — the check runs entirely in the browser. Source crop is already public (`isolated_source_url`), render is public, both fetch into canvas, score in <1s on a typical laptop.

### Why this should work for your screenshot

On the arch you uploaded, the render dropped the rear fairing and made the skirt extension narrower. That'd produce:
- Silhouette IoU ≈ 0.55 (rear segment missing from render mask)
- Edge coverage ≈ 0.48 (rear fairing edges absent)
- Aspect ≈ 0.85 (render is shorter L→R than source)
- **Score ≈ 56 → amber Drift badge** with "outline 25% narrower; rear segment missing" — exactly the issue you spotted by eye.

### Out of scope

- No automatic re-render loop — we surface the problem and let the user decide. Auto-retry would burn credits without solving the underlying prompt brittleness.
- No per-angle scoring (we only render one hero angle today).
- No mesh-stage scoring — that's a separate problem (Meshy quality), worth a follow-up if this proves useful.

