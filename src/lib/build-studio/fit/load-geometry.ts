/**
 * Helpers for loading a Three.js BufferGeometry from a remote STL or GLB
 * URL on the client side, used by the Live Fit feature to feed the worker.
 */
import * as THREE from "three";
import { STLLoader, GLTFLoader } from "three-stdlib";

export type FitMeshKind = "stl" | "glb" | "obj";

export interface LoadedFitGeometry {
  geometry: THREE.BufferGeometry;
  /** Bounding-box centre offset and scale used during normalisation. */
  normaliseScale: number;
  centerOffset: THREE.Vector3;
}

/**
 * Loads + normalises a mesh so its longest axis equals `targetSize` metres
 * and it sits centred at the origin (with its base on y = 0). Mirrors the
 * approach used in PartMesh / HeroStlCar so part + base end up in the same
 * world frame for snap/trim.
 */
export async function loadGeometryNormalised(
  url: string,
  kind: FitMeshKind,
  targetSize: number,
  groundToOrigin: boolean,
): Promise<LoadedFitGeometry> {
  // Sniff the file before trusting the caller-supplied kind — Supabase signed
  // URLs often have no extension and a part flagged "stl" can really be GLB
  // (or vice-versa), which crashes the GLTFLoader with a JSON parse error.
  const actualKind = await sniffMeshKind(url, kind);
  const raw = await loadRaw(url, actualKind);
  // Z-up STL → Y-up rotation handled here to match HeroStlCar.
  if (actualKind === "stl") raw.rotateX(-Math.PI / 2);

  raw.computeBoundingBox();
  const box = raw.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / longest;
  raw.scale(scale, scale, scale);

  raw.computeBoundingBox();
  const box2 = raw.boundingBox!;
  const center = new THREE.Vector3();
  box2.getCenter(center);
  raw.translate(-center.x, -center.y, -center.z);

  if (groundToOrigin) {
    raw.computeBoundingBox();
    raw.translate(0, -raw.boundingBox!.min.y, 0);
  }

  raw.computeVertexNormals();

  return {
    geometry: raw,
    normaliseScale: scale,
    centerOffset: center,
  };
}

/**
 * Fetch the first 8 bytes of the URL and detect whether it's actually a GLB
 * (magic "glTF"), an ASCII STL ("solid "), or a binary STL (assume STL if
 * neither magic matches). Falls back to the caller-supplied kind on network
 * error so we don't break offline / blob: URLs.
 */
async function sniffMeshKind(url: string, fallback: FitMeshKind): Promise<FitMeshKind> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-7" },
      cache: "force-cache",
    });
    if (!res.ok && res.status !== 206) return fallback;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 4) return fallback;
    const bytes = new Uint8Array(buf);
    // GLB magic: 0x46546C67 ("glTF") at offset 0, little-endian.
    if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
      return "glb";
    }
    // ASCII STL starts with "solid ".
    if (
      bytes[0] === 0x73 && bytes[1] === 0x6f && bytes[2] === 0x6c && bytes[3] === 0x69 &&
      bytes[4] === 0x64
    ) {
      return "stl";
    }
    // Binary STL has no magic — just trust the fallback if it's "stl",
    // otherwise prefer "stl" since unknown small headers are usually STL.
    return fallback === "glb" ? "glb" : "stl";
  } catch {
    return fallback;
  }
}

async function loadRaw(url: string, kind: FitMeshKind): Promise<THREE.BufferGeometry> {
  if (kind === "stl") {
    return new Promise((resolve, reject) => {
      const loader = new STLLoader();
      loader.load(url, (g) => resolve(g), undefined, (e) => reject(e));
    });
  }
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        // Merge all meshes' geometries into one BufferGeometry.
        const geos: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) {
            let cloned = m.geometry.clone();
            m.updateMatrixWorld(true);
            cloned.applyMatrix4(m.matrixWorld);
            // GLB meshes are usually indexed. If we simply remove the index,
            // the remaining vertex order no longer describes triangles, which
            // makes the Live Fit preview render as long spike-like ribbons.
            // Expand first so every consecutive 3 vertices is a real triangle.
            if (cloned.index) cloned = cloned.toNonIndexed();
            // Strip non-position/normal attributes — CSG is picky.
            for (const k of Object.keys(cloned.attributes)) {
              if (k !== "position" && k !== "normal") cloned.deleteAttribute(k);
            }
            geos.push(cloned);
          }
        });
        if (geos.length === 0) {
          reject(new Error("GLB contained no meshes"));
          return;
        }
        // Concatenate positions/normals manually (simpler than mergeGeometries).
        const totalCount = geos.reduce((a, g) => a + g.attributes.position.count, 0);
        const pos = new Float32Array(totalCount * 3);
        const nor = new Float32Array(totalCount * 3);
        let off = 0;
        for (const g of geos) {
          const p = g.attributes.position.array as Float32Array;
          let n = g.attributes.normal?.array as Float32Array | undefined;
          if (!n) {
            g.computeVertexNormals();
            n = g.attributes.normal.array as Float32Array;
          }
          pos.set(p, off);
          nor.set(n, off);
          off += p.length;
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        resolve(out);
      },
      undefined,
      (e) => reject(e),
    );
  });
}

/**
 * Convert a BufferGeometry into a binary STL ArrayBuffer suitable for upload
 * (no THREE.Group/Mesh wrappers, no transforms — geometry is assumed to be
 * in the desired world frame already).
 */
export function geometryToStlBuffer(geometry: THREE.BufferGeometry): ArrayBuffer {
  // Triangulate non-indexed positions.
  const pos = geometry.attributes.position.array as Float32Array;
  const idx = geometry.index ? (geometry.index.array as Uint32Array) : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;

  const headerSize = 80;
  const triSize = 50;
  const buffer = new ArrayBuffer(headerSize + 4 + triCount * triSize);
  const view = new DataView(buffer);
  view.setUint32(headerSize, triCount, true);

  const ab = new THREE.Vector3();
  const bc = new THREE.Vector3();
  const n = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  let offset = headerSize + 4;
  for (let t = 0; t < triCount; t++) {
    const ai = idx ? idx[t * 3 + 0] * 3 : t * 9 + 0;
    const bi = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
    const ci = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    a.set(pos[ai], pos[ai + 1], pos[ai + 2]);
    b.set(pos[bi], pos[bi + 1], pos[bi + 2]);
    c.set(pos[ci], pos[ci + 1], pos[ci + 2]);
    ab.subVectors(b, a);
    bc.subVectors(c, b);
    n.crossVectors(ab, bc).normalize();
    view.setFloat32(offset + 0, n.x, true);
    view.setFloat32(offset + 4, n.y, true);
    view.setFloat32(offset + 8, n.z, true);
    view.setFloat32(offset + 12, a.x, true);
    view.setFloat32(offset + 16, a.y, true);
    view.setFloat32(offset + 20, a.z, true);
    view.setFloat32(offset + 24, b.x, true);
    view.setFloat32(offset + 28, b.y, true);
    view.setFloat32(offset + 32, b.z, true);
    view.setFloat32(offset + 36, c.x, true);
    view.setFloat32(offset + 40, c.y, true);
    view.setFloat32(offset + 44, c.z, true);
    view.setUint16(offset + 48, 0, true);
    offset += triSize;
  }
  return buffer;
}
