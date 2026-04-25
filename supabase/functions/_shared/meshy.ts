/**
 * Shared Meshy v1 (Meshy 6) client for image-to-3d generation.
 *
 * Endpoint base: https://api.meshy.ai/openapi/v1/image-to-3d
 * Auth:          Bearer ${MESHY_API_KEY}
 *
 * Meshy 6 image-to-3d takes a SINGLE image. For multi-view pipelines we pick
 * a primary image (typically the side or front 3/4 silhouette) — Meshy 6's
 * vision model infers the rest. Optional `texture_image_url` lets us bias
 * surfacing toward another reference angle.
 *
 * Returns are normalised so callers don't need to know the wire shape:
 *   createImageTo3dTask(...) → { task_id }
 *   getImageTo3dTask(id)     → { status, progress, glb_url, stl_url, thumbnail_url, error? }
 */

const MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

export interface MeshyCreateInput {
  image_url: string;
  /** Texture-only secondary reference image. Use for back/rear bias. */
  texture_image_url?: string;
  /** Texture prompt. Ignored if texture_image_url present (per Meshy docs). */
  texture_prompt?: string;
  /** Defaults to "latest" (Meshy 6). */
  ai_model?: "meshy-5" | "meshy-6" | "latest";
  /** Defaults to true. PBR metallic/roughness/normal maps. */
  enable_pbr?: boolean;
  /** Defaults to true. Set false to keep raw high-poly triangle mesh. */
  should_remesh?: boolean;
  /** Defaults to true. */
  should_texture?: boolean;
  /** Defaults to 30000. */
  target_polycount?: number;
  /** "off" | "auto" | "on". Defaults to auto. */
  symmetry_mode?: "off" | "auto" | "on";
  /** Preserve exact appearance instead of stylising. Defaults true on Meshy. */
  image_enhancement?: boolean;
  /** Strip baked-in shadows/highlights. */
  remove_lighting?: boolean;
  /** Limit returned formats. Defaults to ["glb", "stl"] for our pipeline. */
  target_formats?: Array<"glb" | "obj" | "fbx" | "stl" | "usdz" | "3mf">;
}

export interface MeshyCreateResult {
  task_id: string;
}

export type MeshyStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED" | "EXPIRED";

export interface MeshyTaskResult {
  status: MeshyStatus;
  progress: number;
  glb_url: string | null;
  stl_url: string | null;
  obj_url: string | null;
  thumbnail_url: string | null;
  error: string | null;
}

function authHeaders(): HeadersInit {
  const key = Deno.env.get("MESHY_API_KEY");
  if (!key) throw new Error("MESHY_API_KEY is not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create a Meshy image-to-3d task. Resolves with the task id immediately —
 * caller is responsible for polling getImageTo3dTask until SUCCEEDED.
 */
export async function createImageTo3dTask(input: MeshyCreateInput): Promise<MeshyCreateResult> {
  const body: Record<string, unknown> = {
    image_url: input.image_url,
    ai_model: input.ai_model ?? "latest",
    enable_pbr: input.enable_pbr ?? true,
    should_remesh: input.should_remesh ?? true,
    should_texture: input.should_texture ?? true,
    target_polycount: input.target_polycount ?? 30000,
    symmetry_mode: input.symmetry_mode ?? "auto",
    image_enhancement: input.image_enhancement ?? false, // we want fidelity to our renders
    remove_lighting: input.remove_lighting ?? true,
    target_formats: input.target_formats ?? ["glb", "stl"],
  };
  if (input.texture_image_url) body.texture_image_url = input.texture_image_url;
  else if (input.texture_prompt) body.texture_prompt = input.texture_prompt;

  const resp = await fetch(MESHY_BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    const err = new Error(`Meshy ${resp.status}: ${t.slice(0, 400)}`);
    (err as any).status = resp.status;
    (err as any).body = t;
    throw err;
  }
  const json = await resp.json();
  const task_id = typeof json?.result === "string" ? json.result : json?.id;
  if (!task_id) throw new Error("Meshy returned no task id");
  return { task_id };
}

/**
 * Poll a Meshy image-to-3d task once. Normalises status and surfaces error.
 */
export async function getImageTo3dTask(taskId: string): Promise<MeshyTaskResult> {
  const resp = await fetch(`${MESHY_BASE}/${taskId}`, { headers: authHeaders() });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Meshy poll ${resp.status}: ${t.slice(0, 300)}`);
  }
  const j = await resp.json();
  const status = (j?.status ?? "PENDING") as MeshyStatus;
  const urls = j?.model_urls ?? {};
  const errMsg = j?.task_error?.message || null;
  return {
    status,
    progress: typeof j?.progress === "number" ? j.progress : statusToFakeProgress(status),
    glb_url: typeof urls.glb === "string" ? urls.glb : null,
    stl_url: typeof urls.stl === "string" ? urls.stl : null,
    obj_url: typeof urls.obj === "string" ? urls.obj : null,
    thumbnail_url: typeof j?.thumbnail_url === "string" ? j.thumbnail_url : null,
    error: errMsg && errMsg.length > 0 ? errMsg : null,
  };
}

function statusToFakeProgress(status: MeshyStatus): number {
  switch (status) {
    case "PENDING":     return 5;
    case "IN_PROGRESS": return 50;
    case "SUCCEEDED":   return 100;
    default:            return 0;
  }
}
