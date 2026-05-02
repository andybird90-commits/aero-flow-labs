## Problem

Cut edges along the autofit boundary look fringed/jagged (visible in image-349). This is the classic CSG "sliver triangle" artifact: where the part skin runs nearly parallel/coplanar to the car body, the boolean intersection generates many tiny near-degenerate triangles along the seam. The current cleanup only weld-merges and drops disconnected splinters — slivers attached to the main mesh stay.

## Fix

Add a **post-CSG sliver cleanup pass** in `clientCsgRefit` (in `src/lib/build-studio/autofit.ts`) before the final `mergeVertices`/normal step.

### Steps

1. **Tighter weld first.** Replace the `mergeVertices(cleanedGeom, 1e-4)` weld with a scale-aware tolerance — currently 0.1mm, which is too small for slivers ~1–3mm wide that are typical in CSG output on a 4m-long car. Compute weld epsilon from the result bbox diagonal (e.g. `diag * 1e-4`, clamped between 5e-4 and 2e-3). This collapses tiny sliver edges into single vertices and removes the fringe directly.

2. **Drop degenerate triangles.** After welding, walk the index buffer and remove any triangle whose:
   - two indices are equal (collapsed by weld), OR
   - area is below `epsilon^2 * 0.5` (computed via cross product of edge vectors).
   Rebuild a new index buffer from the survivors.

3. **Smooth boundary normals.** After welding + degenerate removal, call `computeVertexNormals()` (already done). The shared vertices along the cut now have averaged normals across both faces, which removes the visual "shredded" look at the rim.

4. **Optional: tiny edge collapse pass.** For any remaining edge shorter than `epsilon` that connects two boundary (non-manifold) vertices, collapse it to its midpoint. Keep this minimal — only one pass — to avoid eroding genuine detail.

### Code shape

New helper in `autofit.ts`:

```text
cleanSlivers(geom, epsilon):
  welded = mergeVertices(geom, epsilon)
  filter index triangles:
    skip if a==b || b==c || c==a
    skip if triangleArea(a,b,c) < epsilon*epsilon*0.5
  rebuild geometry with filtered index
  computeVertexNormals()
  return
```

Call site in `clientCsgRefit`:

```text
const cleanedGeom = keepLargestComponents(rawResultGeom)
const diag = bboxDiagonal(cleanedGeom)
const eps = clamp(diag * 1e-4, 5e-4, 2e-3)  // ~0.5mm–2mm on a car-scale mesh
const resultGeom = cleanSlivers(cleanedGeom, eps)
```

### Files

- `src/lib/build-studio/autofit.ts` — add `cleanSlivers` helper, replace the current weld+normals block in `clientCsgRefit` with the sliver-aware version. Log sliver/degenerate counts so we can tune epsilon if the user reports issues.

### Why not push epsilon higher

Going above ~2mm starts welding actual geometric features (panel gaps, vent louvres) on a typical car. The clamp keeps the cleanup limited to true CSG noise.

### Expected result

The fringe along the side-skirt cut in image-349 disappears; the trim line becomes a clean continuous edge. Main shape unchanged.