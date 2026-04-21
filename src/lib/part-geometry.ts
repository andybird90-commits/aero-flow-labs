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
 *
 * v2 (manual-trace pivot): geometry now uses curves & extrusions instead of
 * raw boxes so traced parts read as real body-kit pieces — curved horseshoe
 * over-fenders, tapered skirt blades, rounded splitter edges, fin spacing
 * that matches strake count, aerofoil-shaped wing blades.
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
    case "splitter":    return splitter(params, bounds);
    case "lip":         return lip(params, bounds);
    case "canard":      return canards(params, bounds);
    case "side_skirt":  return sideSkirts(params, bounds);
    case "wide_arch":
    case "front_arch":
    case "rear_arch":   return wideArches(params, bounds);
    case "diffuser":    return diffuser(params, bounds);
    case "ducktail":    return ducktail(params, bounds);
    case "wing":        return wing(params, bounds);
    case "bonnet_vent": return louvredVent(params, bounds);
    case "wing_vent":   return louvredVent(params, bounds);
    default:            return placeholder(kind);
  }
}

const matNeutral = () => new THREE.MeshStandardMaterial({
  color: 0x111418,
  side: THREE.DoubleSide,
  metalness: 0.2,
  roughness: 0.55,
});

/* ─── PART WALL THICKNESS ──────────────────────────────────────
 * Extracted concept parts should read as thin composite shells, not solid
 * billet blocks. We standardise on 2 mm wall thickness. */
const SHELL = 0.002;

/**
 * Helper: extrude a closed 2D Shape along Z to give it `depth` (metres).
 * Returns a centred mesh with 1 mm bevelled edges so prints look injected
 * not chiselled.
 */
function extrudeShape(shape: THREE.Shape, depth: number, bevel = 0.001): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, matNeutral());
}

/* ─── splitter: tapered blade with rounded leading edge + side fences ───── */
function splitter(p: Params, b: KitBounds): THREE.Group {
  const depth = num(p, "depth", 80) / 1000;          // forward projection
  const width = (num(p, "width_pct", 95) / 100) * b.width;
  const thickness = Math.max(SHELL, num(p, "thickness", 4) / 1000);
  const fenceH = num(p, "fence_height", 30) / 1000;
  const fenceInset = num(p, "fence_inset", 60) / 1000;
  const noseRadius = Math.min(depth * 0.35, 0.025);

  const g = new THREE.Group();

  // Tapered blade — wider at the rear (mounts to bumper), narrower at nose.
  // Top-down profile is a trapezoid with a rounded leading edge.
  const blade = new THREE.Shape();
  const halfW = width / 2;
  const halfWFront = halfW * 0.92;
  blade.moveTo(-depth / 2 + noseRadius, -halfWFront);
  blade.lineTo(depth / 2, -halfW);
  blade.lineTo(depth / 2, halfW);
  blade.lineTo(-depth / 2 + noseRadius, halfWFront);
  // Rounded nose
  blade.absarc(-depth / 2 + noseRadius, 0, noseRadius * 1.05, Math.PI / 2, -Math.PI / 2, true);
  blade.lineTo(-depth / 2 + noseRadius, -halfWFront);

  const m = extrudeShape(blade, thickness);
  m.rotation.x = -Math.PI / 2; // shape lies on the ground plane
  g.add(m);

  if (fenceH > 0.005) {
    for (const side of [-1, 1]) {
      const fenceShape = new THREE.Shape();
      // Triangular fence rising from the splitter tip backwards.
      fenceShape.moveTo(-depth / 2, 0);
      fenceShape.lineTo(depth / 2, 0);
      fenceShape.lineTo(depth / 2, fenceH);
      fenceShape.lineTo(-depth / 2 + depth * 0.15, fenceH * 0.25);
      fenceShape.lineTo(-depth / 2, 0);
      const fence = extrudeShape(fenceShape, SHELL * 1.5);
      fence.position.set(0, thickness / 2, side * (halfW - fenceInset));
      g.add(fence);
    }
  }
  return g;
}

/* ─── lip: thin extension below splitter ───────────────────── */
function lip(p: Params, b: KitBounds): THREE.Mesh {
  const depth = num(p, "depth", 30) / 1000;
  const width = (num(p, "width_pct", 92) / 100) * b.width;
  const shape = new THREE.Shape();
  shape.moveTo(-depth / 2, -width / 2);
  shape.lineTo(depth / 2, -width / 2 * 0.98);
  shape.lineTo(depth / 2, width / 2 * 0.98);
  shape.lineTo(-depth / 2, width / 2);
  shape.lineTo(-depth / 2, -width / 2);
  const m = extrudeShape(shape, SHELL * 1.5);
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ─── canards: thin angled foils, optional double pair ───── */
function canards(p: Params, b: KitBounds): THREE.Group {
  const angle = (num(p, "angle", 12) * Math.PI) / 180;
  const count = Math.round(num(p, "count", 1));
  const span = num(p, "span", 180) / 1000;
  const chord = span * 0.7;

  // Tapered delta-shape canard
  const shape = new THREE.Shape();
  shape.moveTo(-chord / 2, -span / 2);
  shape.lineTo(chord / 2, -span / 2 * 0.55);
  shape.lineTo(chord / 2, span / 2 * 0.55);
  shape.lineTo(-chord / 2, span / 2);
  shape.lineTo(-chord / 2, -span / 2);

  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const m = extrudeShape(shape, 0.004);
      m.rotation.set(angle * side, 0, 0);
      m.position.set(0, -i * 0.06, side * (b.width / 2 - 0.05));
      g.add(m);
    }
  }
  return g;
}

/* ─── side skirts: tapered blade with optional vertical drop ──
 * `depth` = vertical face height; `length` = how far it stretches along door
 * sill. Cross-section is a thin shell — these are bolt-on covers, not slabs. */
function sideSkirts(p: Params, b: KitBounds): THREE.Group {
  const depth = num(p, "depth", 70) / 1000;
  const drop = num(p, "drop", 25) / 1000;
  const length = (num(p, "length_pct", 55) / 100) * b.length;
  const taper = num(p, "taper", 0.7); // 0..1, how much the ends pinch in

  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    // Side profile (X = along car, Y = vertical) — a soft arc that pinches
    // at the front and rear edges.
    const blade = new THREE.Shape();
    const halfL = length / 2;
    const endY = -depth * (1 - taper * 0.4);
    blade.moveTo(-halfL, 0);
    blade.bezierCurveTo(-halfL * 0.7, 0, -halfL * 0.7, endY, -halfL, endY);
    blade.lineTo(-halfL, endY);
    blade.bezierCurveTo(-halfL, -depth, halfL, -depth, halfL, endY);
    blade.bezierCurveTo(halfL * 0.7, endY, halfL * 0.7, 0, halfL, 0);
    blade.lineTo(-halfL, 0);

    const m = extrudeShape(blade, SHELL * 1.5);
    m.position.set(0, 0, side * (b.width / 2));
    g.add(m);

    if (drop > 0.005) {
      const lowerShape = new THREE.Shape();
      const halfLD = length * 0.95 / 2;
      lowerShape.moveTo(-halfLD, 0);
      lowerShape.lineTo(halfLD, 0);
      lowerShape.lineTo(halfLD * 0.95, -drop);
      lowerShape.lineTo(-halfLD * 0.95, -drop);
      lowerShape.lineTo(-halfLD, 0);
      const lower = extrudeShape(lowerShape, SHELL * 1.5);
      lower.position.set(0, -depth, side * (b.width / 2 + 0.005));
      g.add(lower);
    }
  }
  return g;
}

/* ─── wide arches: curved horseshoe over-fender shells ─────────
 * Each flare is a half-ring extruded outward — read as proper over-fenders
 * rather than the previous flat plates. */
function wideArches(p: Params, b: KitBounds): THREE.Group {
  const flare = num(p, "flare", 50) / 1000;
  // arch radius / vertical height tuned to typical car proportions.
  const archR = num(p, "arch_radius", 360) / 1000;
  const archThickness = num(p, "arch_thickness", 80) / 1000; // top-to-bottom flange depth
  const lipDepth = SHELL * 2;

  // Build one over-fender as a flat horseshoe ring shape, then bend it
  // outward by extruding along Z (the side direction).
  const arc = new THREE.Shape();
  // Outer arc
  arc.absarc(0, 0, archR, Math.PI, 0, false);
  arc.lineTo(archR, -lipDepth);
  // Inner arc (slightly smaller — gives the arch its width)
  arc.absarc(0, -lipDepth, archR - archThickness, 0, Math.PI, true);
  arc.lineTo(-archR, 0);

  const g = new THREE.Group();
  // 4 corners — front L/R, rear L/R. Position offsets in metres along X.
  const positions: Array<[number, 1 | -1]> = [
    [-b.length * 0.32, -1],
    [-b.length * 0.32,  1],
    [ b.length * 0.28, -1],
    [ b.length * 0.28,  1],
  ];
  for (const [x, side] of positions) {
    const m = extrudeShape(arc, flare);
    // The shape lives in the XY plane; rotate so the arch sweeps over the
    // wheel (X = along car, Y = vertical, depth = outward).
    m.rotation.set(0, side * Math.PI / 2, 0);
    m.position.set(x, 0, side * (b.width / 2 + flare / 2));
    g.add(m);
  }
  return g;
}

/* ─── diffuser: angled undertray with parallel strakes ─────────
 * Real diffusers are angled panels with vertical fins. Strake spacing now
 * follows the actual count instead of the old fake 5-fence pattern. */
function diffuser(p: Params, b: KitBounds): THREE.Group {
  const angle = (num(p, "angle", 12) * Math.PI) / 180;
  const length = num(p, "length", 550) / 1000;
  const width = (num(p, "width_pct", 85) / 100) * b.width;
  const strakeCount = Math.max(2, Math.round(num(p, "strake_count", 5)));
  const strakeH = num(p, "strake_height", 60) / 1000;

  const g = new THREE.Group();

  // Undertray panel — slightly trapezoidal so the rear edge is wider.
  const panelShape = new THREE.Shape();
  panelShape.moveTo(-length / 2, -width / 2 * 0.92);
  panelShape.lineTo(length / 2, -width / 2);
  panelShape.lineTo(length / 2, width / 2);
  panelShape.lineTo(-length / 2, width / 2 * 0.92);
  panelShape.lineTo(-length / 2, -width / 2 * 0.92);
  const panel = extrudeShape(panelShape, SHELL * 2);
  panel.rotation.x = -Math.PI / 2;
  panel.rotation.z = angle;
  g.add(panel);

  // Strakes — tapered triangle profile, evenly spaced.
  const strakeShape = new THREE.Shape();
  strakeShape.moveTo(-length / 2, 0);
  strakeShape.lineTo(length / 2, 0);
  strakeShape.lineTo(length / 2, strakeH);
  strakeShape.lineTo(-length / 2 + length * 0.15, strakeH * 0.4);
  strakeShape.lineTo(-length / 2, 0);

  const spacing = width / (strakeCount + 1);
  for (let i = 1; i <= strakeCount; i++) {
    const z = -width / 2 + i * spacing;
    const strake = extrudeShape(strakeShape, 0.005);
    strake.position.set(0, SHELL, z);
    strake.rotation.z = angle;
    g.add(strake);
  }
  return g;
}

/* ─── ducktail: thin lip rising off rear deck with curve ─── */
function ducktail(p: Params, _b: KitBounds): THREE.Mesh {
  const h = num(p, "height", 38) / 1000;
  const kick = (num(p, "kick", 10) * Math.PI) / 180;
  const width = num(p, "width", 1100) / 1000;
  const chord = num(p, "chord", 220) / 1000;

  // Side profile — a soft uplift curve rather than a flat blade.
  const shape = new THREE.Shape();
  shape.moveTo(-chord / 2, 0);
  shape.bezierCurveTo(-chord / 4, h * 0.2, chord / 4, h * 0.7, chord / 2, h);
  shape.lineTo(chord / 2, h - 0.003);
  shape.bezierCurveTo(chord / 4, h * 0.7 - 0.003, -chord / 4, h * 0.2 - 0.003, -chord / 2, -0.003);
  shape.lineTo(-chord / 2, 0);

  const m = extrudeShape(shape, width);
  m.rotation.y = Math.PI / 2;
  m.rotation.z = kick;
  return m;
}

/* ─── wing: aerofoil blade + 2 swan-neck stands + optional gurney ──
 * Blade cross-section is now a real aerofoil (NACA-ish curve) instead of a
 * flat box. Stands sweep up to the wing from the deck. */
function wing(p: Params, b: KitBounds): THREE.Group {
  const aoa = (num(p, "aoa", 8) * Math.PI) / 180;
  const chord = num(p, "chord", 280) / 1000;
  const gurney = num(p, "gurney", 12) / 1000;
  const spanPct = num(p, "span_pct", 78) / 100;
  const span = b.width * spanPct;
  const standH = num(p, "stand_height", 220) / 1000;
  const thickness = chord * 0.08; // ~8% thickness ratio

  const g = new THREE.Group();

  // Aerofoil cross-section — flat-bottom curved-top approximation.
  const af = new THREE.Shape();
  const c = chord;
  const t = thickness;
  af.moveTo(-c / 2, 0);
  // Top surface (suction): smooth bezier from leading edge up & back down.
  af.bezierCurveTo(-c / 2 + c * 0.1, t, -c / 2 + c * 0.5, t * 0.95, c / 2, t * 0.05);
  // Trailing edge to bottom (small thickness)
  af.lineTo(c / 2, -t * 0.02);
  // Bottom surface (pressure): mostly flat with slight curve.
  af.bezierCurveTo(c / 4, -t * 0.05, -c / 4, -t * 0.05, -c / 2, 0);

  const blade = extrudeShape(af, span);
  blade.rotation.y = Math.PI / 2;
  blade.rotation.z = -aoa;
  g.add(blade);

  // Two swan-neck stands attaching from above — curved bezier strut.
  const standShape = new THREE.Shape();
  const sH = standH;
  const sW = 0.014;
  standShape.moveTo(-sW / 2, -sH);
  standShape.bezierCurveTo(-sW / 2 + 0.04, -sH * 0.6, -sW / 2 - 0.02, -sH * 0.2, -sW / 2, 0);
  standShape.lineTo(sW / 2, 0);
  standShape.bezierCurveTo(sW / 2 - 0.02, -sH * 0.2, sW / 2 + 0.04, -sH * 0.6, sW / 2, -sH);
  standShape.lineTo(-sW / 2, -sH);

  for (const side of [-1, 1]) {
    const stand = extrudeShape(standShape, 0.012);
    stand.position.set(0, 0, side * span * 0.42);
    g.add(stand);
  }

  // End plates — keep flat & thin
  const epShape = new THREE.Shape();
  epShape.moveTo(-c * 0.55, -c * 0.18);
  epShape.lineTo(c * 0.55, -c * 0.15);
  epShape.lineTo(c * 0.5, c * 0.25);
  epShape.lineTo(-c * 0.45, c * 0.22);
  epShape.lineTo(-c * 0.55, -c * 0.18);
  for (const side of [-1, 1]) {
    const plate = extrudeShape(epShape, SHELL * 1.5);
    plate.position.set(0, 0, side * span / 2);
    plate.rotation.z = -aoa;
    g.add(plate);
  }

  // Optional gurney lip on the trailing edge
  if (gurney > 0.001) {
    const gShape = new THREE.Shape();
    gShape.moveTo(0, 0);
    gShape.lineTo(SHELL * 1.5, 0);
    gShape.lineTo(SHELL * 1.5, gurney);
    gShape.lineTo(0, gurney);
    gShape.lineTo(0, 0);
    const gur = extrudeShape(gShape, span * 0.98);
    gur.rotation.y = Math.PI / 2;
    gur.position.set(-c / 2, t * 0.02 + gurney / 2, 0);
    gur.rotation.z = -aoa;
    g.add(gur);
  }
  return g;
}

/* ─── louvred vent: shared builder for bonnet & wing vents ──
 *   - recessed tray (length × width × depth)
 *   - N parallel angled louvre slats spanning the opening */
function louvredVent(p: Params, _b: KitBounds): THREE.Group {
  const length = num(p, "length", 240) / 1000;
  const width  = num(p, "width", 120) / 1000;
  const depth  = num(p, "depth", 18) / 1000;
  const louvres = Math.max(2, Math.round(num(p, "louvre_count", 5)));

  const g = new THREE.Group();

  // Surround frame — open rectangle (4 thin rails) so it reads as a vent
  // bezel, not a closed lid.
  const wall = 0.006;
  const frame = new THREE.Shape();
  const hl = length / 2, hw = width / 2;
  frame.moveTo(-hl, -hw);
  frame.lineTo(hl, -hw);
  frame.lineTo(hl, hw);
  frame.lineTo(-hl, hw);
  frame.lineTo(-hl, -hw);
  const hole = new THREE.Path();
  hole.moveTo(-hl + wall, -hw + wall);
  hole.lineTo(hl - wall, -hw + wall);
  hole.lineTo(hl - wall, hw - wall);
  hole.lineTo(-hl + wall, hw - wall);
  hole.lineTo(-hl + wall, -hw + wall);
  frame.holes.push(hole);

  const surround = extrudeShape(frame, SHELL * 2);
  surround.rotation.x = -Math.PI / 2;
  g.add(surround);

  // Louvre slats — angled ~25°, evenly spaced across the length.
  const slatThick = 0.004;
  const slatAngle = (25 * Math.PI) / 180;
  const usable = length - wall * 2;
  const spacing = usable / louvres;
  for (let i = 0; i < louvres; i++) {
    const x = -usable / 2 + spacing * (i + 0.5);
    const slatShape = new THREE.Shape();
    const sl = spacing * 0.85, sw = (width - wall * 2);
    slatShape.moveTo(-sl / 2, -sw / 2);
    slatShape.lineTo(sl / 2, -sw / 2);
    slatShape.lineTo(sl / 2, sw / 2);
    slatShape.lineTo(-sl / 2, sw / 2);
    slatShape.lineTo(-sl / 2, -sw / 2);
    const slat = extrudeShape(slatShape, slatThick);
    slat.rotation.x = -Math.PI / 2 + slatAngle;
    slat.position.set(x, -depth * 0.4, 0);
    g.add(slat);
  }
  return g;
}

function placeholder(kind: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), matNeutral());
  m.name = kind;
  return m;
}
