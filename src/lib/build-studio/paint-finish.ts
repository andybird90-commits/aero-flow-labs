/**
 * Paint Finish — material/environment settings persisted on projects.paint_finish.
 *
 * Tier 1+2 of the "render textures on the base STL" feature: lets users dial
 * in the paint colour, metalness, roughness, clearcoat and HDRI environment
 * preset of the donor car so it looks far more realistic in the Build Studio
 * viewport. The chosen finish survives reloads because it lives on the project.
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

export interface PaintFinish {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoat_roughness: number;
  env_intensity: number;
  env_preset: EnvPreset;
}

export const DEFAULT_PAINT_FINISH: PaintFinish = {
  color: "#0a1622",
  metalness: 0.85,
  roughness: 0.32,
  clearcoat: 1.0,
  clearcoat_roughness: 0.18,
  env_intensity: 1.4,
  env_preset: "warehouse",
};

/** Tolerant parser — accepts partial / unknown JSON from the DB column. */
export function parsePaintFinish(raw: unknown): PaintFinish {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PAINT_FINISH };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fb: number) =>
    typeof v === "number" && isFinite(v) ? v : fb;
  const str = (v: unknown, fb: string) => (typeof v === "string" && v ? v : fb);
  return {
    color: str(r.color, DEFAULT_PAINT_FINISH.color),
    metalness: num(r.metalness, DEFAULT_PAINT_FINISH.metalness),
    roughness: num(r.roughness, DEFAULT_PAINT_FINISH.roughness),
    clearcoat: num(r.clearcoat, DEFAULT_PAINT_FINISH.clearcoat),
    clearcoat_roughness: num(r.clearcoat_roughness, DEFAULT_PAINT_FINISH.clearcoat_roughness),
    env_intensity: num(r.env_intensity, DEFAULT_PAINT_FINISH.env_intensity),
    env_preset: str(r.env_preset, DEFAULT_PAINT_FINISH.env_preset) as EnvPreset,
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
