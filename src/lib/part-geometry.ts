/**
 * Standalone parametric geometry builders for fitted body kit parts.
 * Used by the Exports page to serialize each part to STL/OBJ.
 *
 * Geometry is intentionally simple (boxes, planes, prisms) — it mirrors the
 * placeholders shown in the 3D viewer so what the user sees is what gets
 * exported. Future revisions can swap individual builders for higher-fidelity
 * parametric meshes without changing the call site.
 *
 * All output is centred at the origin so each STL/OBJ file lands in a sane
 * place when imported into a slicer or CAM tool.
 */
import * as THREE from "three";

type Params = Record<string, number | string | boolean | undefined | null>;

const num = (p: Params, k: string, fallback: number): number => {
  const v = p?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

/**
 * Build a THREE.Object3D for a given part kind + parameters.
 * Caller is responsible for adding it to a scene before exporting.
 */
export function buildPartMesh(kind: string, params: Params): THREE.Object3D {
  switch (kind) {
    case "splitter":   return splitter(params);
    case "lip":        return lip(params);
    case "canard":     return canards(params);
    case "side_skirt": return sideSkirts(params);
    case "wide_arch":  return wideArches(params);
    case "diffuser":   return diffuser(params);
    case "ducktail":   return ducktail(params);
    case "wing":       return wing(params);
    default:           return placeholder(kind);
  }
}

/* ─── individual parts ─────────────────────────────────── */

function splitter(p: Params): THREE.Mesh {
  const depth = num(p, "depth", 80) / 1000;     // m
  const width = num(p, "width", 1700) / 1000;
  const thickness = 0.025;
  return slab(depth, thickness, width);
}

function lip(p: Params): THREE.Mesh {
  const depth = num(p, "depth", 30) / 1000;
  const width = num(p, "width", 1700) / 1000 * 0.92;
  return slab(depth, 0.012, width);
}

function canards(p: Params): THREE.Group {
  const angle = (num(p, "angle", 12) * Math.PI) / 180;
  const len = 0.18;
  const w = 0.16;
  const t = 0.012;
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(len, t, w),
      new THREE.MeshStandardMaterial(),
    );
    m.position.set(0, 0, side * 0.45);
    m.rotation.set(angle * side, 0, 0);
    g.add(m);
  }
  return g;
}

function sideSkirts(p: Params): THREE.Group {
  const depth = num(p, "depth", 70) / 1000;
  const length = num(p, "length", 2400) / 1000 * 0.55;
  const width = num(p, "width", 1700) / 1000;
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(length, depth, 0.04),
      new THREE.MeshStandardMaterial(),
    );
    m.position.set(0, 0, side * (width / 2));
    g.add(m);
  }
  return g;
}

function wideArches(p: Params): THREE.Group {
  const flare = num(p, "flare", 50) / 1000;
  const width = num(p, "width", 1700) / 1000;
  const g = new THREE.Group();
  const positions = [
    [-0.6, -1], [-0.6, 1], [0.5, -1], [0.5, 1],
  ] as const;
  for (const [x, side] of positions) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, flare),
      new THREE.MeshStandardMaterial(),
    );
    m.position.set(x, 0, side * (width / 2 + flare / 2));
    g.add(m);
  }
  return g;
}

function diffuser(p: Params): THREE.Mesh {
  const angle = (num(p, "angle", 10) * Math.PI) / 180;
  const length = 0.55;
  const width = num(p, "width", 1700) / 1000 * 0.85;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.04, width),
    new THREE.MeshStandardMaterial(),
  );
  m.rotation.set(0, 0, angle);
  return m;
}

function ducktail(p: Params): THREE.Mesh {
  const h = num(p, "height", 38) / 1000;
  const width = num(p, "width", 1700) / 1000 * 0.9;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, h, width),
    new THREE.MeshStandardMaterial(),
  );
  m.rotation.set(0, 0, 0.25);
  return m;
}

function wing(p: Params): THREE.Group {
  const aoa = (num(p, "aoa", 8) * Math.PI) / 180;
  const chord = num(p, "chord", 280) / 1000;
  const gurney = num(p, "gurney", 12) / 1000;
  const width = num(p, "width", 1700) / 1000 * 0.78;
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.22, 0.04),
      new THREE.MeshStandardMaterial(),
    );
    stand.position.set(0, -0.1, side * (width * 0.41));
    g.add(stand);
  }
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(chord, 0.025, width),
    new THREE.MeshStandardMaterial(),
  );
  blade.rotation.set(0, 0, -aoa);
  g.add(blade);
  if (gurney > 0) {
    const gur = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, gurney, width),
      new THREE.MeshStandardMaterial(),
    );
    gur.position.set(-chord / 2, 0.012 + gurney / 2, 0);
    g.add(gur);
  }
  return g;
}

function placeholder(kind: string): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.05, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  m.name = kind;
  return m;
}

function slab(x: number, y: number, z: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(x, y, z),
    new THREE.MeshStandardMaterial(),
  );
}
