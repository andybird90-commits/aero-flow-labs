/**
 * Paint Finish — material/environment settings persisted on projects.paint_finish.
 *
 * Tier 2 of the "render textures on the base STL" feature: now stores a
 * separate finish for each material region of the car (body / wheel / tyre /
 * glass) so users can paint the wheels independently of the body and the
 * tyres can stay matte black while glass stays smoky and transparent.
 *
 * Tags used by the classifier (see edge fn classify-car-materials):
 *   0 = body, 1 = glass, 2 = wheel, 3 = tyre
 */
export type EnvPreset =
  | "warehouse"
  | "studio"
  | "city"
  | "sunset"
  | "dawn"
  | "night"
  | "forest"
  | "apartment"
  | "park"
  | "lobby";

export interface MaterialFinish {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoat_roughness: number;
  /** Glass-only: 0..1 opacity (1 = opaque). Ignored for non-glass. */
  opacity?: number;
}

export interface PaintFinish {
  /** Body paint */
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoat_roughness: number;
  env_intensity: number;
  env_preset: EnvPreset;
  /** Optional per-region overrides (Tier 2 multi-material). */
  wheels?: MaterialFinish;
  tyres?: MaterialFinish;
  glass?: MaterialFinish;
}

export const DEFAULT_BODY_FINISH = {
  color: "#0a1622",
  metalness: 0.85,
  roughness: 0.32,
  clearcoat: 1.0,
  clearcoat_roughness: 0.18,
};

export const DEFAULT_WHEEL_FINISH: MaterialFinish = {
  color: "#2a2e35",
  metalness: 0.92,
  roughness: 0.35,
  clearcoat: 0.6,
  clearcoat_roughness: 0.25,
};

export const DEFAULT_TYRE_FINISH: MaterialFinish = {
  color: "#0d0d0e",
  metalness: 0.0,
  roughness: 0.95,
  clearcoat: 0.0,
  clearcoat_roughness: 0.6,
};

export const DEFAULT_GLASS_FINISH: MaterialFinish = {
  color: "#0c1015",
  metalness: 0.0,
  roughness: 0.05,
  clearcoat: 1.0,
  clearcoat_roughness: 0.05,
  opacity: 0.55,
};

export const DEFAULT_PAINT_FINISH: PaintFinish = {
  ...DEFAULT_BODY_FINISH,
  env_intensity: 1.4,
  env_preset: "warehouse",
  wheels: { ...DEFAULT_WHEEL_FINISH },
  tyres: { ...DEFAULT_TYRE_FINISH },
  glass: { ...DEFAULT_GLASS_FINISH },
};

function num(v: unknown, fb: number) {
  return typeof v === "number" && isFinite(v) ? v : fb;
}
function str(v: unknown, fb: string) {
  return typeof v === "string" && v ? v : fb;
}

function parseMaterial(raw: unknown, fb: MaterialFinish): MaterialFinish {
  if (!raw || typeof raw !== "object") return { ...fb };
  const r = raw as Record<string, unknown>;
  return {
    color: str(r.color, fb.color),
    metalness: num(r.metalness, fb.metalness),
    roughness: num(r.roughness, fb.roughness),
    clearcoat: num(r.clearcoat, fb.clearcoat),
    clearcoat_roughness: num(r.clearcoat_roughness, fb.clearcoat_roughness),
    ...(fb.opacity !== undefined ? { opacity: num(r.opacity, fb.opacity) } : {}),
  };
}

/** Tolerant parser — accepts partial / unknown JSON from the DB column. */
export function parsePaintFinish(raw: unknown): PaintFinish {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PAINT_FINISH };
  const r = raw as Record<string, unknown>;
  return {
    color: str(r.color, DEFAULT_PAINT_FINISH.color),
    metalness: num(r.metalness, DEFAULT_PAINT_FINISH.metalness),
    roughness: num(r.roughness, DEFAULT_PAINT_FINISH.roughness),
    clearcoat: num(r.clearcoat, DEFAULT_PAINT_FINISH.clearcoat),
    clearcoat_roughness: num(r.clearcoat_roughness, DEFAULT_PAINT_FINISH.clearcoat_roughness),
    env_intensity: num(r.env_intensity, DEFAULT_PAINT_FINISH.env_intensity),
    env_preset: str(r.env_preset, DEFAULT_PAINT_FINISH.env_preset) as EnvPreset,
    wheels: parseMaterial(r.wheels, DEFAULT_WHEEL_FINISH),
    tyres: parseMaterial(r.tyres, DEFAULT_TYRE_FINISH),
    glass: parseMaterial(r.glass, DEFAULT_GLASS_FINISH),
  };
}

export const PAINT_PRESETS: Array<{ name: string; finish: Partial<PaintFinish> }> = [
  { name: "Midnight Metallic", finish: { color: "#0a1622", metalness: 0.85, roughness: 0.32, clearcoat: 1, clearcoat_roughness: 0.18 } },
  { name: "Liquid Silver",    finish: { color: "#c9ccd1", metalness: 1.0, roughness: 0.18, clearcoat: 1, clearcoat_roughness: 0.1 } },
  { name: "Carbon Matte",     finish: { color: "#1a1a1c", metalness: 0.4, roughness: 0.85, clearcoat: 0.1, clearcoat_roughness: 0.6 } },
  { name: "Lava Red",         finish: { color: "#a4151c", metalness: 0.7, roughness: 0.28, clearcoat: 1, clearcoat_roughness: 0.12 } },
  { name: "Apex Orange",      finish: { color: "#fb923c", metalness: 0.6, roughness: 0.35, clearcoat: 0.9, clearcoat_roughness: 0.18 } },
  { name: "Pearl White",      finish: { color: "#f1ece1", metalness: 0.3, roughness: 0.22, clearcoat: 1, clearcoat_roughness: 0.08 } },
  { name: "British Racing",   finish: { color: "#0e3a25", metalness: 0.65, roughness: 0.3,  clearcoat: 1, clearcoat_roughness: 0.15 } },
  { name: "Bare Aluminium",   finish: { color: "#9aa0a6", metalness: 1.0,  roughness: 0.45, clearcoat: 0,   clearcoat_roughness: 0.5 } },
];

export const WHEEL_PRESETS: Array<{ name: string; finish: MaterialFinish }> = [
  { name: "Gunmetal", finish: { color: "#2a2e35", metalness: 0.92, roughness: 0.35, clearcoat: 0.6, clearcoat_roughness: 0.25 } },
  { name: "Polished", finish: { color: "#c9ccd1", metalness: 1.0, roughness: 0.12, clearcoat: 1, clearcoat_roughness: 0.05 } },
  { name: "Satin Black", finish: { color: "#161617", metalness: 0.7, roughness: 0.55, clearcoat: 0.2, clearcoat_roughness: 0.4 } },
  { name: "Bronze", finish: { color: "#7a5230", metalness: 0.9, roughness: 0.3, clearcoat: 0.5, clearcoat_roughness: 0.2 } },
  { name: "Gold", finish: { color: "#b88836", metalness: 1.0, roughness: 0.2, clearcoat: 0.8, clearcoat_roughness: 0.1 } },
];

export const ENV_PRESET_OPTIONS: Array<{ value: EnvPreset; label: string }> = [
  { value: "warehouse", label: "Warehouse" },
  { value: "studio", label: "Studio" },
  { value: "city", label: "City" },
  { value: "sunset", label: "Sunset" },
  { value: "dawn", label: "Dawn" },
  { value: "night", label: "Night" },
  { value: "forest", label: "Forest" },
  { value: "apartment", label: "Apartment" },
  { value: "park", label: "Park" },
  { value: "lobby", label: "Lobby" },
];

/** Get body finish slice for convenience. */
export function getBodyMaterial(finish: PaintFinish): MaterialFinish {
  return {
    color: finish.color,
    metalness: finish.metalness,
    roughness: finish.roughness,
    clearcoat: finish.clearcoat,
    clearcoat_roughness: finish.clearcoat_roughness,
  };
}
