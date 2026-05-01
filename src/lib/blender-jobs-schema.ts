/**
 * Typed parameter + input schemas for the 14 Blender ops.
 *
 * Drives the form rendered in the "New Blender job" dialog so admins don't
 * have to remember the JSON shape for each op. Keeping this declarative
 * (instead of one bespoke form per op) means new ops only need a schema entry.
 */
import type { BlenderJobType } from "./blender-jobs";

export type FieldKind = "number" | "text" | "url" | "boolean" | "select" | "multiselect";

export interface BaseField {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface NumberField extends BaseField {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface TextField extends BaseField {
  kind: "text" | "url";
  placeholder?: string;
}

export interface BooleanField extends BaseField {
  kind: "boolean";
}

export interface SelectField extends BaseField {
  kind: "select";
  options: { value: string; label: string }[];
}

export interface MultiSelectField extends BaseField {
  kind: "multiselect";
  options: { value: string; label: string }[];
}

export type Field = NumberField | TextField | BooleanField | SelectField | MultiSelectField;

export interface OpSchema {
  /** Inputs (mesh URLs, IDs) that the worker expects under `inputs` (besides `params`). */
  inputs: Field[];
  /** Parameter shape — becomes `parameters` JSON on the job row. */
  params: Field[];
}

const partUrl: TextField = {
  key: "part_url", kind: "url", label: "Part mesh URL", required: true,
  placeholder: "https://…/part.stl",
  description: "STL/GLB of the part to operate on.",
};
const carUrl: TextField = {
  key: "car_url", kind: "url", label: "Car body URL", required: true,
  placeholder: "https://…/car.stl",
  description: "STL of the donor car body for booleans / projection.",
};

export const BLENDER_OP_SCHEMA: Record<BlenderJobType, OpSchema> = {
  trim_part_to_car: {
    inputs: [partUrl, carUrl],
    params: [
      { key: "offset_mm", kind: "number", label: "Offset", unit: "mm", min: 0, max: 20, step: 0.1, description: "Outward offset from the body before booleaning." },
      { key: "smooth_iters", kind: "number", label: "Smooth iterations", min: 0, max: 10, step: 1 },
    ],
  },
  conform_edge_to_body: {
    inputs: [partUrl, carUrl],
    params: [
      { key: "search_radius_mm", kind: "number", label: "Search radius", unit: "mm", min: 1, max: 200, step: 1 },
      { key: "smoothing", kind: "number", label: "Smoothing", min: 0, max: 1, step: 0.05, description: "0 = exact projection, 1 = max blend." },
    ],
  },
  thicken_shell: {
    inputs: [partUrl],
    params: [
      { key: "thickness_mm", kind: "number", label: "Thickness", unit: "mm", min: 0.5, max: 20, step: 0.1 },
      { key: "even_offset", kind: "boolean", label: "Even offset", description: "Keep wall thickness uniform around corners." },
    ],
  },
  add_return_lip: {
    inputs: [partUrl],
    params: [
      { key: "lip_depth_mm", kind: "number", label: "Lip depth", unit: "mm", min: 1, max: 50, step: 0.5 },
      { key: "lip_angle_deg", kind: "number", label: "Lip angle", unit: "°", min: 30, max: 120, step: 1 },
    ],
  },
  add_mounting_tabs: {
    inputs: [partUrl],
    params: [
      { key: "tab_count", kind: "number", label: "Tab count", min: 2, max: 16, step: 1 },
      { key: "tab_size_mm", kind: "number", label: "Tab size", unit: "mm", min: 8, max: 60, step: 1 },
      { key: "hole_diameter_mm", kind: "number", label: "Hole Ø", unit: "mm", min: 2, max: 12, step: 0.5 },
    ],
  },
  mirror_part: {
    inputs: [partUrl],
    params: [
      {
        key: "axis", kind: "select", label: "Mirror axis",
        options: [{ value: "x", label: "X (left ↔ right)" }, { value: "y", label: "Y (front ↔ rear)" }, { value: "z", label: "Z (up ↔ down)" }],
      },
      { key: "merge_centreline", kind: "boolean", label: "Merge centreline" },
    ],
  },
  split_for_print_bed: {
    inputs: [partUrl],
    params: [
      { key: "bed_x_mm", kind: "number", label: "Bed X", unit: "mm", min: 100, max: 800, step: 1 },
      { key: "bed_y_mm", kind: "number", label: "Bed Y", unit: "mm", min: 100, max: 800, step: 1 },
      { key: "bed_z_mm", kind: "number", label: "Bed Z", unit: "mm", min: 100, max: 800, step: 1 },
      { key: "kerf_mm", kind: "number", label: "Kerf", unit: "mm", min: 0, max: 2, step: 0.1 },
    ],
  },
  repair_watertight: {
    inputs: [partUrl],
    params: [
      { key: "fill_holes", kind: "boolean", label: "Fill holes" },
      { key: "recalc_normals", kind: "boolean", label: "Recalculate normals" },
      { key: "max_hole_edges", kind: "number", label: "Max hole edges", min: 4, max: 512, step: 1 },
    ],
  },
  decimate_mesh: {
    inputs: [partUrl],
    params: [
      { key: "ratio", kind: "number", label: "Decimation ratio", min: 0.05, max: 1, step: 0.05, description: "Fraction of triangles to keep." },
      { key: "preserve_boundaries", kind: "boolean", label: "Preserve boundaries" },
    ],
  },
  cut_wheel_arches: {
    inputs: [partUrl, carUrl],
    params: [
      { key: "clearance_mm", kind: "number", label: "Tyre clearance", unit: "mm", min: 0, max: 50, step: 0.5 },
    ],
  },
  cut_window_openings: {
    inputs: [partUrl, carUrl],
    params: [
      { key: "offset_mm", kind: "number", label: "Cut offset", unit: "mm", min: 0, max: 20, step: 0.5 },
    ],
  },
  panelise_body_skin: {
    inputs: [
      { key: "body_skin_url", kind: "url", label: "Body skin URL", required: true, placeholder: "https://…/skin.stl" },
    ],
    params: [
      {
        key: "panels", kind: "multiselect", label: "Panels to extract",
        options: [
          { value: "bonnet", label: "Bonnet" },
          { value: "front_bumper", label: "Front bumper" },
          { value: "left_door", label: "Left door" },
          { value: "right_door", label: "Right door" },
          { value: "left_quarter", label: "Left quarter" },
          { value: "right_quarter", label: "Right quarter" },
          { value: "rear_bumper", label: "Rear bumper" },
          { value: "roof", label: "Roof" },
        ],
      },
    ],
  },
  export_stl: {
    inputs: [partUrl],
    params: [
      { key: "units", kind: "select", label: "Units", options: [{ value: "mm", label: "mm" }, { value: "m", label: "m" }, { value: "in", label: "in" }] },
      { key: "binary", kind: "boolean", label: "Binary STL" },
    ],
  },
  export_glb_preview: {
    inputs: [partUrl],
    params: [
      { key: "draco", kind: "boolean", label: "Draco compression" },
    ],
  },
  generate_part: {
    inputs: [],
    params: [
      { key: "part_kind", kind: "text", label: "Part kind", required: true, placeholder: "front_splitter" },
      { key: "style_prompt", kind: "text", label: "Style prompt", placeholder: "aggressive carbon splitter" },
      { key: "symmetry", kind: "select", label: "Symmetry", options: [
        { value: "none", label: "None" },
        { value: "mirror_x", label: "Mirror X" },
      ] },
    ],
  },
};

/** Coerce a form-state record into the typed JSON the worker expects. */
export function coerceValues(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (raw === undefined || raw === "") continue;
    switch (f.kind) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n)) out[f.key] = n;
        break;
      }
      case "boolean":
        out[f.key] = !!raw;
        break;
      case "multiselect":
        out[f.key] = Array.isArray(raw) ? raw : [];
        break;
      default:
        out[f.key] = String(raw);
    }
  }
  return out;
}

/** Validate required fields and return list of human-readable problems. */
export function validate(fields: Field[], values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty) problems.push(`${f.label} is required`);
  }
  return problems;
}
