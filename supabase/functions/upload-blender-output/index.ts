/**
 * upload-blender-output
 *
 * Lets the local Blender worker hand back STL/GLB/PNG output bytes WITHOUT
 * needing the Supabase service-role key on the worker machine.
 *
 * Flow:
 *   worker -> POST /upload-blender-output
 *     headers: Authorization: Bearer <BLENDER_WORKER_TOKEN>
 *     query:   ?task_id=<task>&filename=<fitted.stl>
 *     body:    raw file bytes (Content-Type sets the mime)
 *   edge fn -> uploads to `geometries/blender-worker/<task_id>/<ts>-<filename>`
 *           -> returns { url } (7-day signed URL)
 *
 * Auth: shares the same BLENDER_WORKER_TOKEN the dispatcher uses to talk to
 * the worker, so we can authenticate machine-to-machine without involving the
 * end user's session.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BLENDER_WORKER_TOKEN = Deno.env.get("BLENDER_WORKER_TOKEN") ?? "";
const BUCKET = "geometries";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Bearer-token auth shared with the worker.
  if (!BLENDER_WORKER_TOKEN) {
    return json({ error: "BLENDER_WORKER_TOKEN not configured" }, 503);
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Missing bearer token" }, 401);
  }
  if (auth.slice(7).trim() !== BLENDER_WORKER_TOKEN) {
    return json({ error: "Bad token" }, 401);
  }

  const url = new URL(req.url);
  const taskId = safeName(url.searchParams.get("task_id") ?? "");
  const filename = safeName(url.searchParams.get("filename") ?? "");
  if (!taskId || !filename) {
    return json({ error: "task_id and filename query params are required" }, 400);
  }

  const contentType =
    req.headers.get("Content-Type") ?? "application/octet-stream";
  if (!req.body) {
    return json({ error: "Empty body" }, 400);
  }

  const ts = Date.now();
  const objectPath = `blender-worker/${taskId}/${ts}-${filename}`;

  // Stream the request body straight through to Storage so we never buffer
  // the whole STL/GLB in memory — large panel exports were tripping
  // SUPABASE_EDGE_RUNTIME_ERROR (memory / size cap) on `await arrayBuffer()`.
  const contentLength = req.headers.get("Content-Length") ?? undefined;
  const uploadHeaders: Record<string, string> = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
    "Content-Type": contentType,
    "x-upsert": "true",
  };
  if (contentLength) uploadHeaders["Content-Length"] = contentLength;

  let uploadResp: Response;
  try {
    uploadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`,
      {
        method: "POST",
        headers: uploadHeaders,
        body: req.body,
        // Deno fetch needs `duplex: "half"` to send a streaming body;
        // the type lib doesn't include it yet, hence the cast.
        ...({ duplex: "half" } as Record<string, unknown>),
      },
    );
  } catch (err) {
    return json(
      { error: `Storage upload threw: ${(err as Error).message}` },
      502,
    );
  }
  if (!uploadResp.ok) {
    const t = await uploadResp.text();
    return json(
      { error: `Storage upload failed ${uploadResp.status}: ${t.slice(0, 300)}` },
      502,
    );
  }

  const signResp = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
    },
  );
  if (!signResp.ok) {
    const t = await signResp.text();
    return json(
      { error: `Sign failed ${signResp.status}: ${t.slice(0, 300)}` },
      502,
    );
  }
  const signed = await signResp.json();
  const signedPath = signed.signedURL ?? signed.signedUrl;
  if (!signedPath) {
    return json({ error: "Signer returned no URL" }, 502);
  }

  return json({
    url: `${SUPABASE_URL}/storage/v1${signedPath}`,
    object_path: objectPath,
    bytes: contentLength ? Number(contentLength) : null,
  });
});
