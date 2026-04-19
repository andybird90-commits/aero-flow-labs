/**
 * Aero package intent modes — Street / Track Day / Time Attack.
 * Drives copy, recommended component intensity and visual aggression
 * of the 3D overlays. This is design-stage guidance, not certified CFD.
 */

export type PackageMode = "street" | "track" | "time_attack";

export interface PackageModeSpec {
  id: PackageMode;
  label: string;
  short: string;
  tagline: string;
  description: string;
  /** 0..1 visual intensity — used to scale streamline density, wake size, force arrows */
  intensity: number;
  /** Acceptable drag tendency budget (0 lowest, 1 highest) */
  dragTolerance: number;
  /** Front aero aggressiveness 0..1 */
  frontAero: number;
  /** Rear aero aggressiveness 0..1 */
  rearAero: number;
  accent: string; // tailwind text color class
  ring: string;   // tailwind ring color class
}

export const PACKAGE_MODES: PackageModeSpec[] = [
  {
    id: "street",
    label: "Street Mode",
    short: "Street",
    tagline: "Subtle package · usable ride height",
    description:
      "Restrained aero. Low drag penalty, mild front load, conservative rear. Designed to look right and behave on the road.",
    intensity: 0.45,
    dragTolerance: 0.2,
    frontAero: 0.35,
    rearAero: 0.35,
    accent: "text-success",
    ring: "ring-success/30",
  },
  {
    id: "track",
    label: "Track Day Mode",
    short: "Track",
    tagline: "Balanced · moderate drag accepted",
    description:
      "Assertive front and rear aero with balance focus. Adds usable downforce for fast corners while keeping things drivable for an average lap day.",
    intensity: 0.7,
    dragTolerance: 0.55,
    frontAero: 0.7,
    rearAero: 0.7,
    accent: "text-primary",
    ring: "ring-primary/30",
  },
  {
    id: "time_attack",
    label: "Time Attack Mode",
    short: "Time Attack",
    tagline: "Aggressive · drag traded for load",
    description:
      "Big rear wing, deep splitter, working diffuser, canards, wide-stance friendly. Maximum estimated load and stability — drag is accepted as the cost of doing business.",
    intensity: 1.0,
    dragTolerance: 1.0,
    frontAero: 1.0,
    rearAero: 1.0,
    accent: "text-warning",
    ring: "ring-warning/30",
  },
];

export function getPackageMode(id: PackageMode | string | null | undefined): PackageModeSpec {
  return PACKAGE_MODES.find((m) => m.id === id) ?? PACKAGE_MODES[1];
}
