/**
 * Single source of truth for whether a part kind is free-standing
 * (image-to-3D works fine) or body-conforming (must go through the external
 * Blender geometry worker, fitted against the saved base car mesh).
 *
 * Used by:
 *   - ExtractedPartPreview.tsx → branches "Make 3D model" CTA
 *   - meshify-part edge function → server-side guard (rejects body-conforming)
 *   - SendToGeometryWorker.tsx → only opened for body-conforming kinds
 */

export type PartFitClass = "free_standing" | "body_conforming";

const FREE_STANDING: ReadonlySet<string> = new Set([
  "diffuser",
  "wing",
  "rear_wing",
  "splitter",
  "splitter_section",
  "front_splitter",
  "vent",
  "vent_insert",
  "canard",
  "gurney_flap",
  "blade",
]);

const BODY_CONFORMING: ReadonlySet<string> = new Set([
  "side_scoop",
  "scoop",
  "front_arch",
  "rear_arch",
  "fender_flare",
  "arch",
  "side_skirt",
  "skirt",
  "bonnet_vent",
  "front_lip",
  "lip",
]);

/**
 * Classify a part kind. Anything not explicitly listed defaults to
 * `free_standing` so the existing pipeline keeps working — only the parts we
 * have *positively* identified as body-blended go through the worker.
 */
export function classifyPartKind(kind: string | null | undefined): PartFitClass {
  if (!kind) return "free_standing";
  const k = kind.toLowerCase().trim();
  if (BODY_CONFORMING.has(k)) return "body_conforming";
  if (FREE_STANDING.has(k)) return "free_standing";
  // Substring fallback for compound labels like "rear_wing_uprights" or
  // "left_front_arch_scoop" that the AI sometimes emits.
  for (const bc of BODY_CONFORMING) if (k.includes(bc)) return "body_conforming";
  return "free_standing";
}

export function isBodyConforming(kind: string | null | undefined): boolean {
  return classifyPartKind(kind) === "body_conforming";
}

export function isFreeStanding(kind: string | null | undefined): boolean {
  return classifyPartKind(kind) === "free_standing";
}

/** Human-readable labels for UI hints. */
export const FIT_CLASS_LABEL: Record<PartFitClass, string> = {
  free_standing: "Free-standing part",
  body_conforming: "Body-conforming part",
};

export const FIT_CLASS_DESCRIPTION: Record<PartFitClass, string> = {
  free_standing:
    "Bolt-on aero with its own clean shape (wings, diffusers, splitters, canards). CAD or mesh AI both work well.",
  body_conforming:
    "Blends into the bodywork (arches, scoops, skirts, lips). Live Fit conforms it to the car in-app — escalate to the worker only when you need a print-ready STL.",
};

/**
 * Recommended fit pipeline per class:
 *   • free_standing  → meshy / CAD recipe (existing flows)
 *   • body_conforming → live-fit (in-app snap + CSG trim), worker only when
 *                       wall thickness / manifold STL is required.
 */
export type FitPipeline = "meshy_or_cad" | "live_fit";
export const FIT_PIPELINE: Record<PartFitClass, FitPipeline> = {
  free_standing: "meshy_or_cad",
  body_conforming: "live_fit",
};

