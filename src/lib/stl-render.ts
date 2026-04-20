/**
 * Off-screen STL renderer — produces silhouette previews from the same 4
 * camera angles the concept generator uses (front_three_quarter, side,
 * rear_three_quarter, rear).
 *
 * Why this exists:
 *   The boolean aero-kit pipeline displaces the hero STL where the concept
 *   silhouette extends past the stock silhouette. To reason about that, we
 *   need a "stock silhouette" image rendered with the *same* virtual camera
 *   as the concept. This module gives the UI a way to show those
 *   stock-vs-concept pairs side-by-side as a sanity check before any
 *   displacement runs.
 *
 * Output is a small canvas image (matte body on white background) — good
 * enough for visual diff, and cheap enough to compute on the client.
 *
 * Usage:
 *   const dataUrls = await renderStlAngles(stlUrl, { forwardAxis: "-z" });
 *   // dataUrls = { front_three_quarter, side, rear_three_quarter, rear }
 */
import * as THREE from "three";
import { STLLoader, OBJLoader } from "three-stdlib";

export type AngleKey =
  | "front_three_quarter"
  | "side"
  | "rear_three_quarter"
  | "rear";

export type ForwardAxis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface RenderOptions {
  /** Which axis the model's nose points down. Default "-z" (concept renderer's convention). */
  forwardAxis?: ForwardAxis;
  /** Pixel size of each rendered image (square). */
  size?: number;
  /** Render as filled body silhouette (true) or shaded (false). */
  silhouette?: boolean;
}

const DEFAULTS: Required<RenderOptions> = {
  forwardAxis: "-z",
  size: 384,
  silhouette: false,
};

/**
 * Camera placements expressed in the *normalised* model frame where:
 *   +X = right, +Y = up, -Z = forward (matches three.js / glTF / our concept renderer).
 *
 * Distance is a multiplier of the longest bounding-box dimension. Y offset is
 * a multiplier of the model height — small lift so we look slightly down.
 */
const ANGLES: Record<AngleKey, { dir: [number, number, number]; distMul: number; yOffset: number }> = {
  // Three-quarter front: stand off the front-left at car height, look at body centre.
  front_three_quarter: { dir: [-0.85, 0.25, -1.0], distMul: 1.6, yOffset: 0.45 },
  // Pure side (camera on the right side, looking left).
  side: { dir: [0, 0.05, -1.6], distMul: 1.55, yOffset: 0.4 },
  // Three-quarter rear from the opposite side.
  rear_three_quarter: { dir: [0.85, 0.25, 1.0], distMul: 1.6, yOffset: 0.45 },
  // Direct rear: behind the car, level.
  rear: { dir: [0, 0.1, 1.6], distMul: 1.5, yOffset: 0.4 },
};

/** Cache of decoded geometries so re-rendering different angles is fast. */
const geomCache = new Map<string, THREE.BufferGeometry>();

async function loadGeometry(url: string): Promise<THREE.BufferGeometry> {
  const cached = geomCache.get(url);
  if (cached) return cached;

  // Detect OBJ vs STL from the URL path (signed URLs keep the extension before "?token=").
  const pathPart = url.split("?")[0].toLowerCase();
  const isObj = pathPart.endsWith(".obj");

  let geo: THREE.BufferGeometry;
  if (isObj) {
    const loader = new OBJLoader();
    const group = await new Promise<THREE.Group>((resolve, reject) => {
      loader.load(url, (g) => resolve(g), undefined, (e) => reject(e));
    });
    // Merge every mesh's geometry into one BufferGeometry.
    const geos: THREE.BufferGeometry[] = [];
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const g = (obj as THREE.Mesh).geometry as THREE.BufferGeometry;
        // Bake the mesh's local transform into the geometry before merging.
        const cloned = g.clone();
        cloned.applyMatrix4((obj as THREE.Mesh).matrixWorld);
        // Drop attributes other than position so the merge is uniform.
        const stripped = new THREE.BufferGeometry();
        stripped.setAttribute("position", cloned.getAttribute("position"));
        if (cloned.getIndex()) stripped.setIndex(cloned.getIndex());
        geos.push(stripped.toNonIndexed());
      }
    });
    if (geos.length === 0) throw new Error("OBJ contained no meshes.");
    // Concatenate position arrays manually (simpler than BufferGeometryUtils import).
    const total = geos.reduce((n, g) => n + (g.getAttribute("position").array as Float32Array).length, 0);
    const positions = new Float32Array(total);
    let offset = 0;
    for (const g of geos) {
      const arr = g.getAttribute("position").array as Float32Array;
      positions.set(arr, offset);
      offset += arr.length;
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  } else {
    const loader = new STLLoader();
    geo = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
      loader.load(url, (g) => resolve(g), undefined, (e) => reject(e));
    });
  }

  geo.computeVertexNormals();
  geomCache.set(url, geo);
  return geo;
}

/**
 * Build the rotation that takes the user's stated forward axis into the
 * canonical "−Z forward, +Y up" frame.
 *
 * We only need a small set of axis rotations (90° / 180° around principal
 * axes) — close enough for sane STL exports. Custom orientations are exposed
 * via the admin page's `forward_axis` setting.
 */
function rotationForAxis(axis: ForwardAxis): THREE.Euler {
  switch (axis) {
    case "-z": return new THREE.Euler(0, 0, 0);
    case "+z": return new THREE.Euler(0, Math.PI, 0);
    case "+x": return new THREE.Euler(0, -Math.PI / 2, 0);
    case "-x": return new THREE.Euler(0, Math.PI / 2, 0);
    // Z-up exporters: rotate so model Z (up) becomes scene Y (up), then point nose.
    case "-y": return new THREE.Euler(-Math.PI / 2, 0, 0);
    case "+y": return new THREE.Euler(Math.PI / 2, 0, 0);
  }
}

/**
 * Render the given STL URL from all 4 angles. Returns a map of dataURLs.
 *
 * Errors propagate so the caller can show a placeholder + retry.
 */
export async function renderStlAngles(
  url: string,
  options: RenderOptions = {},
): Promise<Record<AngleKey, string>> {
  const opts = { ...DEFAULTS, ...options };
  const geo = await loadGeometry(url);

  // Build a fresh scene per call (renderer is reused below). Mesh material is
  // simple: matte body on neutral background, slight rim light. We're not
  // trying to look pretty — we want clear silhouette outlines.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(opts.size, opts.size, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xf5f5f7, 1); // off-white so dark body silhouette pops

  const scene = new THREE.Scene();

  const material = opts.silhouette
    ? new THREE.MeshBasicMaterial({ color: 0x111418 })
    : new THREE.MeshStandardMaterial({
        color: 0x232830,
        roughness: 0.55,
        metalness: 0.25,
      });

  // Wrap in a group so we can rotate the model into the canonical frame
  // without mutating the cached geometry.
  const mesh = new THREE.Mesh(geo, material);
  const wrapper = new THREE.Group();
  wrapper.rotation.copy(rotationForAxis(opts.forwardAxis));
  wrapper.add(mesh);
  scene.add(wrapper);

  // Lighting (only matters when silhouette === false).
  if (!opts.silhouette) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
  }

  // Compute bbox in *world* space (after the orientation rotation), then
  // centre the model and derive a "longest edge" we use to scale camera distance.
  const box = new THREE.Box3().setFromObject(wrapper);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  wrapper.position.sub(centre); // centre at origin

  const longest = Math.max(size.x, size.y, size.z) || 1;
  const height = size.y || 1;

  const camera = new THREE.PerspectiveCamera(28, 1, longest * 0.05, longest * 20);

  const out: Partial<Record<AngleKey, string>> = {};
  for (const key of Object.keys(ANGLES) as AngleKey[]) {
    const cfg = ANGLES[key];
    const dir = new THREE.Vector3(...cfg.dir).normalize();
    const dist = longest * cfg.distMul;
    camera.position.copy(dir.multiplyScalar(dist));
    camera.position.y = height * cfg.yOffset;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    out[key] = renderer.domElement.toDataURL("image/png");
  }

  // Cleanup — don't leak GL contexts across many calls.
  renderer.dispose();
  if (material) material.dispose();

  return out as Record<AngleKey, string>;
}

/** Clear the geometry cache (e.g. after a re-repair updates the file). */
export function clearStlRenderCache(url?: string) {
  if (url) geomCache.delete(url);
  else geomCache.clear();
}
