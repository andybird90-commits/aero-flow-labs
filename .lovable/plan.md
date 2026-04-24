## What’s actually wrong
The app is only showing `IndexError: list index out of range` because the backend status function simply relays the external CAD worker’s raw error string. In the latest stored job, the recipe does contain body-producing features, so this is no longer the earlier “no extrude at all” case.

The more likely failure is: the worker never successfully creates a solid body from the sketch/extrude chain, so its final `list(bodies.values())[-1]` lookup crashes. The current validator catches some bad recipes (`origin`, negative extrudes, bad planes), but it still allows recipes that are syntactically valid JSON yet unsafe for the worker to build, especially for arch/fender-style parts.

Do I know what the issue is?
Yes: the current system is validating too little and reporting too little. Invalid-or-unbuildable recipes are still reaching the CAD worker, and the status UI can only display the worker’s vague crash string.

## Plan
1. Tighten CAD recipe validation in `supabase/functions/generate-cad-recipe/index.ts`
   - Add stricter checks for sketch safety before returning a recipe.
   - Reject recipes that look open, ambiguous, multi-island, or unsafe for the reference worker.
   - Block `import_mesh` unless a real `base_mesh_url` was provided.
   - Add stronger per-part constraints for arch/fender/body-panel parts so the AI prefers a simple closed profile + one extrude + optional fillet, instead of complex mixed spline/arc/cut recipes.

2. Add deterministic fallbacks for troublesome part kinds
   - For `wide_arch`, `front arch`, `fender_panel`, and similar body-panel parts, generate a conservative fallback recipe template when the AI output fails validation.
   - This keeps the worker on simple shapes it can actually build instead of retrying risky freeform geometry.

3. Improve backend error reporting in the CAD flow
   - Update `dispatch-cad-job` and/or `cad-job-status` so failed jobs persist more context, such as validation summary and a compact recipe snapshot.
   - When the worker returns a generic failure, attach a friendlier app-side message like “The CAD worker could not build a solid from this sketch profile.”

4. Improve the modal UI in `src/components/SendToCadWorker.tsx`
   - Show richer failure details instead of only the raw worker string.
   - If recipe validation fails, show the exact blocked rule(s) in the dialog.
   - Keep the “Inspect recipe JSON” area available after failure so the user can see what was attempted.

5. Verify the flow end-to-end
   - Test `generate-cad-recipe`, `dispatch-cad-job`, and `cad-job-status` with the failing arch/fender cases.
   - Confirm the result is either:
     - a simpler recipe that builds successfully, or
     - a specific validation error before the job is sent.

## Technical details
Files to update:
- `supabase/functions/generate-cad-recipe/index.ts`
- `supabase/functions/dispatch-cad-job/index.ts`
- `supabase/functions/cad-job-status/index.ts`
- `src/components/SendToCadWorker.tsx`
- optionally `src/lib/cad-jobs.ts` for improved error handling

Likely validation additions:
- require supported named planes only
- require positive extrude/shell values
- reject unsupported placement keys
- reject sketches that are likely open or malformed
- reject body-panel recipes with overly complex feature chains
- require final exportable body target

Expected outcome:
- no more silent “still just says this” failures
- fewer bad recipes reaching the worker
- much clearer messages when a CAD build is blocked or fails
- better success rate for front arch / fender style parts