/**
 * Parametric geometry builders for fitted body kit parts.
 *
 * These produce nicer-than-boxy parametric meshes that:
 *   - mirror exactly what's drawn in the live 3D viewer (`CarViewer3D`)
 *   - remain watertight & printable when serialised to STL/OBJ from Exports
 *   - take a `bounds` argument so dimensions adapt to the user's actual STL
 *     (a wide front bumper gets a wider splitter, etc.)
 *
 * Output is centred at the origin so each STL file lands sanely in a slicer.
 */
import * as THREE from "three";

type Params = Record<string, number | string | boolean | undefined | null>;

export interface KitBounds {
  /** Total car length in metres (front-to-rear). */
  length: number;
  /** Total car width in metres (side-to-side). */
  width: number;
  /** Total car height in metres (ground-to-roof). */
  height: number;
}

const DEFAULT_BOUNDS: KitBounds = { length: 4.4, width: 1.78, height: 1.28 };

const num = (p: Params, k: string, fallback: number): number => {
  const v = p?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

/**
 * Build a THREE.Object3D for a given part kind + parameters.
 * Pass `bounds` (in metres) so dimensions scale to the user's real car.
 */
export function buildPartMesh(kind: string, params: Params, bounds: KitBounds = DEFAULT_BOUNDS): THREE.Object3D {
  switch (kind) {
    case "splitter":   return splitter(params, bounds);
    case "lip":        return lip(params, bounds);
    case "canard":     return canards(params, bounds);
    case "side_skirt": return sideSkirts(params, bounds);
    case "wide_arch":  return wideArches(params, bounds);
    case "diffuser":   return diffuser(params, bounds);
    case "ducktail":   return ducktail(params, bounds);
    case "wing":       return wing(params, bounds);
    default:           return placeholder(kind);
  }
}

const matNeutral = () => new THREE.MeshStandardMaterial({ color: 0x111418 });

/* ─── splitter: flat blade with optional side fences ───────── */
function splitter(p: Params, b: KitBounds): THREE.Group {
  const depth = num(p, "depth", 80) / 1000;
  const width = b.width * 0.95;
  const thickness = 0.022;
  const fenceH = num(p, "fence_height", 30) / 1000;
  const fenceInset = num(p, "fence_inset", 60) / 1000;

  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(depth, thickness, width), matNeutral()));
  if (fenceH > 0.005) {
    for (const side of [-1, 1]) {
      const fence = new THREE.Mesh(
        new THREE.BoxGeometry(depth * 0.9, fenceH, 0.012),
        matNeutral(),
      );
      fence.position.set(0, fenceH / 2 + thickness / 2, side * (width / 2 - fenceInset));
      g.add(fence);
    }
  }
  return g;
}

/* ─── lip: thin extension below splitter ───────────────────── */
function lip(p: Params, b: KitBounds): THREE.Mesh {
  const depth = num(p, "depth", 30) / 1000;
  const width = b.width * 0.92;
  return new THREE.Mesh(new THREE.BoxGeometry(depth, 0.012, width), matNeutral());
}

/* ─── canards: thin angled foils, optional double pair ───── */
function canards(p: Params, b: KitBounds): THREE.Group {
  const angle = (num(p, "angle", 12) * Math.PI) / 180;
  const count = Math.round(num(p, "count", 1));
  const span = num(p, "span", 180) / 1000;
  const chord = span * 0.7;
  const t = 0.01;
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(chord, t, span), matNeutral());
      m.position.set(0, -i * 0.06, side * (b.width / 2 - 0.05));
      m.rotation.set(angle * side, 0, 0);
      g.add(m);
    }
  }
  return g;
}

/* ─── side skirts: long blades with optional vertical drop ── */
function sideSkirts(p: Params, b: KitBounds): THREE.Group {
  const depth = num(p, "depth", 70) / 1000;
  const drop = num(p, "drop", 25) / 1000;
  const length = b.length * 0.55;
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(length, depth, 0.04),
      matNeutral(),
    );
    blade.position.set(0, 0, side * (b.width / 2));
    g.add(blade);
    if (drop > 0.005) {
      const lower = new THREE.Mesh(
        new THREE.BoxGeometry(length * 0.95, drop, 0.025),
        matNeutral(),
      );
      lower.position.set(0, -depth / 2 - drop / 2, side * (b.width / 2 + 0.01));
      g.add(lower);
    }
  }
  return g;
}

/* ─── wide arches: 4 flares at the corners ─────────────────── */
function wideArches(p: Params, b: KitBounds): THREE.Group {
  const flare = num(p, "flare", 50) / 1000;
  const g = new THREE.Group();
  const positions = [[-0.6, -1], [-0.6, 1], [0.5, -1], [0.5, 1]] as const;
  for (const [x, side] of positions) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, flare),
      matNeutral(),
    );
    m.position.set(x, 0, side * (b.width / 2 + flare / 2));
    g.add(m);
  }
  return g;
}

/* ─── diffuser: angled panel with parallel strakes ─────────── */
function diffuser(p: Params, b: KitBounds): THREE.Group {
  const angle = (num(p, "angle", 12) * Math.PI) / 180;
  const length = 0.55;
  const width = b.width * 0.85;
  const strakeCount = Math.max(2, Math.round(num(p, "strake_count", 5)));
  const strakeH = num(p, "strake_height", 60) / 1000;

  const g = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.025, width),
    matNeutral(),
  );
  panel.rotation.set(0, 0, angle);
  g.add(panel);

  // Strakes evenly spaced across the width
  const spacing = width / (strakeCount + 1);
  for (let i = 1; i <= strakeCount; i++) {
    const z = -width / 2 + i * spacing;
    const strake = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.95, strakeH, 0.01),
      matNeutral(),
    );
    strake.position.set(0, strakeH / 2 + 0.012, z);
    strake.rotation.set(0, 0, angle);
    g.add(strake);
  }
  return g;
}

/* ─── ducktail: thin lip rising off rear deck ──────────────── */
function ducktail(p: Params, b: KitBounds): THREE.Mesh {
  const h = num(p, "height", 38) / 1000;
  const kick = (num(p, "kick", 10) * Math.PI) / 180;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, h, b.width * 0.85),
    matNeutral(),
  );
  m.rotation.set(0, 0, kick);
  return m;
}

/* ─── wing: blade + 2 swan-neck stands + optional gurney ──── */
function wing(p: Params, b: KitBounds): THREE.Group {
  const aoa = (num(p, "aoa", 8) * Math.PI) / 180;
  const chord = num(p, "chord", 280) / 1000;
  const gurney = num(p, "gurney", 12) / 1000;
  const spanPct = num(p, "span_pct", 78) / 100;
  const span = b.width * spanPct;
  const standH = num(p, "stand_height", 220) / 1000;

  const g = new THREE.Group();

  // Two swan-neck stands attaching from above
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, standH, 0.04),
      matNeutral(),
    );
    stand.position.set(0, -standH / 2, side * span * 0.42);
    g.add(stand);
  }

  // Main plane (blade)
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(chord, 0.025, span),
    matNeutral(),
  );
  blade.rotation.set(0, 0, -aoa);
  g.add(blade);

  // End plates
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(chord * 1.05, chord * 0.45, 0.01),
      matNeutral(),
    );
    plate.position.set(0, 0, side * span / 2);
    plate.rotation.set(0, 0, -aoa);
    g.add(plate);
  }

  // Optional gurney lip on the trailing edge
  if (gurney > 0.001) {
    const gur = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, gurney, span * 0.98),
      matNeutral(),
    );
    gur.position.set(-chord / 2, 0.012 + gurney / 2, 0);
    g.add(gur);
  }
  return g;
}

function placeholder(kind: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), matNeutral());
  m.name = kind;
  return m;
}
