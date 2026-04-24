/**
 * cad-worker-status
 *
 * Reports whether the CAD worker integration is ready to use. Used by the
 * in-app guided setup flow to decide whether to enable "Build with CAD" or
 * walk the user through entering / fixing their secrets.
 *
 * Returns:
 *   {
 *     state: "ok" | "missing_secrets" | "unreachable" | "unauthorized" | "unhealthy",
 *     has_url: boolean,
 *     has_token: boolean,
 *     worker_url?: string,    // host only, never the token
 *     http_status?: number,
 *     detail?: string,
 *   }
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CAD_WORKER_URL =
  Deno.env.get("CAD_WORKER_URL") ?? Deno.env.get("ONSHAPE_WORKER_URL");
const CAD_WORKER_TOKEN =
  Deno.env.get("CAD_WORKER_TOKEN") ?? Deno.env.get("ONSHAPE_WORKER_TOKEN");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hostOnly(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const has_url = !!CAD_WORKER_URL;
  const has_token = !!CAD_WORKER_TOKEN;
  const worker_url = hostOnly(CAD_WORKER_URL);

  if (!has_url || !has_token) {
    return json({
      state: "missing_secrets",
      has_url,
      has_token,
      worker_url,
      detail: !has_url && !has_token
        ? "Both CAD_WORKER_URL and CAD_WORKER_TOKEN are missing."
        : !has_url
          ? "CAD_WORKER_URL is missing."
          : "CAD_WORKER_TOKEN is missing.",
    });
  }

  // Probe /health on the worker. Treat 401/403 as token problem; non-2xx as
  // unhealthy; network errors as unreachable.
  const base = CAD_WORKER_URL!.replace(/\/$/, "");
  const probeUrl = `${base}/health`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(probeUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${CAD_WORKER_TOKEN}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (resp.status === 401 || resp.status === 403) {
      return json({
        state: "unauthorized",
        has_url,
        has_token,
        worker_url,
        http_status: resp.status,
        detail: "Worker rejected the token. Check CAD_WORKER_TOKEN matches the value set in the worker.",
      });
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return json({
        state: "unhealthy",
        has_url,
        has_token,
        worker_url,
        http_status: resp.status,
        detail: `Worker /health returned ${resp.status}: ${text.slice(0, 200)}`,
      });
    }
    return json({
      state: "ok",
      has_url,
      has_token,
      worker_url,
      http_status: resp.status,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({
      state: "unreachable",
      has_url,
      has_token,
      worker_url,
      detail: `Could not reach worker: ${msg}`,
    });
  }
});
