/**
 * Mount-zone catalog for the Prototyper. Each zone defines:
 *  - id used in DB
 *  - human label
 *  - default normalized centre per camera angle (used to seed Place mode)
 *  - opposite_zone for snap-opposite (e.g. front_quarter ↔ front_quarter on the
 *    other side; sill ↔ sill, etc.) — symmetric zones return the same id, the
 *    side flag is what flips.
 */

export type MountZone =
  | "front_bumper"
  | "front_quarter"
  | "bonnet"
  | "door_quarter"
  | "sill"
  | "rear_quarter"
  | "rear_bumper"
  | "wing_zone";

export type PartSide = "left" | "right" | "center";

export type ViewAngle =
  | "front"
  | "front34"
  | "side"
  | "rear34"
  | "rear";

export const MOUNT_ZONES: { id: MountZone; label: string }[] = [
  { id: "front_bumper",  label: "Front bumper" },
  { id: "front_quarter", label: "Front quarter" },
  { id: "bonnet",        label: "Bonnet" },
  { id: "door_quarter",  label: "Door / front quarter" },
  { id: "sill",          label: "Sill / side skirt" },
  { id: "rear_quarter",  label: "Rear quarter" },
  { id: "rear_bumper",   label: "Rear bumper" },
  { id: "wing_zone",     label: "Wing / tail zone" },
];

export const PART_CATEGORIES = [
  "side_scoop",
  "splitter",
  "canard",
  "vent",
  "diffuser",
  "wing",
  "skirt",
  "bonnet_vent",
  "blade",
  "other",
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const VIEW_ANGLES: { id: ViewAngle; label: string }[] = [
  { id: "front",   label: "Front" },
  { id: "front34", label: "Front 3/4" },
  { id: "side",    label: "Side" },
  { id: "rear34",  label: "Rear 3/4" },
  { id: "rear",    label: "Rear" },
];

/**
 * Default normalized centre for a (zone, side) on a given view. Used to
 * pre-position a freshly placed part instance.
 */
export function defaultCentre(
  zone: MountZone,
  side: PartSide,
  view: ViewAngle,
): { x: number; y: number } {
  // Rough but sane defaults for the most common zones / angles.
  // x: 0 = left edge, 1 = right edge, y: 0 = top.
  const sideX = side === "left" ? 0.28 : side === "right" ? 0.72 : 0.5;
  const map: Record<MountZone, { x: number; y: number }> = {
    front_bumper:  { x: 0.5,   y: 0.78 },
    front_quarter: { x: sideX, y: 0.62 },
    bonnet:        { x: 0.5,   y: 0.45 },
    door_quarter:  { x: sideX, y: 0.55 },
    sill:          { x: sideX, y: 0.78 },
    rear_quarter:  { x: sideX, y: 0.6 },
    rear_bumper:   { x: 0.5,   y: 0.78 },
    wing_zone:     { x: 0.5,   y: 0.32 },
  };
  const base = map[zone];
  // For symmetric front/rear bumper on side views shift along x
  if (view === "side" && (zone === "front_bumper" || zone === "rear_bumper")) {
    return { x: zone === "front_bumper" ? 0.18 : 0.82, y: base.y };
  }
  return base;
}

export function flipSide(side: PartSide): PartSide {
  if (side === "left") return "right";
  if (side === "right") return "left";
  return "center";
}
