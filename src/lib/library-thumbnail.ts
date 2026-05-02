/**
 * Render a thumbnail PNG for an uploaded mesh File (STL/OBJ/GLB/GLTF) using
 * three.js off-screen, so the library can show a real preview instead of a
 * blank tile. Returns a Blob ready to upload.
 */
import * as THREE from "three";
import { STLLoader, OBJLoader, GLTFLoader } from "three-stdlib";

async function loadGeometryFromUrl(url: string, ext: string): Promise<THREE.Object3D> {
  if (ext === "stl") {
    const loader = new STLLoader();
    const geo = await new Promise<THREE.BufferGeometry>((res, rej) =>
      loader.load(url, res, undefined, rej),
    );
    geo.computeVertexNormals();
    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.55, metalness: 0.25 }),
    );
  }
  if (ext === "obj") {
    const loader = new OBJLoader();
    const group = await new Promise<THREE.Group>((res, rej) =>
      loader.load(url, res, undefined, rej),
    );
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: 0x232830,
          roughness: 0.55,
          metalness: 0.25,
        });
      }
    });
    return group;
  }
  if (ext === "glb" || ext === "gltf") {
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((res, rej) =>
      loader.load(url, res, undefined, rej),
    );
    return gltf.scene as THREE.Object3D;
  }
  throw new Error(`Unsupported extension: ${ext}`);
}

async function loadGeometryFromFile(file: File): Promise<THREE.Object3D> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const url = URL.createObjectURL(file);
  try {
    return await loadGeometryFromUrl(url, ext);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderObjectToBlob(obj: THREE.Object3D, size: number): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x0b0d12, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const wrapper = new THREE.Group();
    wrapper.add(obj);
    scene.add(wrapper);

    const box = new THREE.Box3().setFromObject(wrapper);
    if (box.isEmpty()) return null;
    const sz = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(sz);
    box.getCenter(c);
    wrapper.position.sub(c);

    const longest = Math.max(sz.x, sz.y, sz.z) || 1;
    const camera = new THREE.PerspectiveCamera(28, 1, longest * 0.05, longest * 20);
    const dir = new THREE.Vector3(-0.85, 0.35, -1.0).normalize();
    camera.position.copy(dir.multiplyScalar(longest * 1.7));
    camera.position.y = (sz.y || 1) * 0.45;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    return await new Promise((res) =>
      renderer!.domElement.toBlob((b) => res(b), "image/png", 0.92),
    );
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
    }
  }
}

export async function renderMeshThumbnailFromUrl(
  url: string,
  size = 512,
): Promise<Blob | null> {
  try {
    const pathPart = url.split("?")[0].toLowerCase();
    const ext = (pathPart.split(".").pop() ?? "").toLowerCase();
    const obj = await loadGeometryFromUrl(url, ext);
    return await renderObjectToBlob(obj, size);
  } catch (e) {
    console.warn("[thumbnail-from-url] failed", e);
    return null;
  }
}

export async function renderMeshThumbnail(
  file: File,
  size = 512,
): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const obj = await loadGeometryFromFile(file);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x0b0d12, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const wrapper = new THREE.Group();
    wrapper.add(obj);
    scene.add(wrapper);

    const box = new THREE.Box3().setFromObject(wrapper);
    if (box.isEmpty()) return null;
    const sz = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(sz);
    box.getCenter(c);
    wrapper.position.sub(c);

    const longest = Math.max(sz.x, sz.y, sz.z) || 1;
    const camera = new THREE.PerspectiveCamera(28, 1, longest * 0.05, longest * 20);
    const dir = new THREE.Vector3(-0.85, 0.35, -1.0).normalize();
    camera.position.copy(dir.multiplyScalar(longest * 1.7));
    camera.position.y = (sz.y || 1) * 0.45;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    const canvas = renderer.domElement;
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png", 0.92),
    );
    return blob;
  } catch (e) {
    console.warn("[thumbnail] render failed", e);
    return null;
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
    }
  }
}
