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

  // Probe the worker. Try /health first, then fall back to / so workers that
  // don't expose a dedicated health route still pass. Treat 401/403 as a
  // token problem; network errors as unreachable; anything else (including
  // 404 on /health when / responds) as ok.
  const base = CAD_WORKER_URL!.replace(/\/$/, "");

  async function probe(path: string) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${CAD_WORKER_TOKEN}` },
        signal: ctrl.signal,
      });
      return { resp, error: null as string | null };
    } catch (e) {
      return { resp: null, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(t);
    }
  }

  try {
    let { resp, error } = await probe("/health");
    // Fall back to root if /health is missing on this worker.
    if (resp && resp.status === 404) {
      ({ resp, error } = await probe("/"));
    }

    if (!resp) {
      return json({
        state: "unreachable",
        has_url,
        has_token,
        worker_url,
        detail: `Could not reach worker: ${error}`,
      });
    }

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

    // Anything else (2xx, 3xx, 404, 405, 5xx) means the host is up and the
    // token wasn't rejected. Treat 5xx as unhealthy; otherwise ok.
    if (resp.status >= 500) {
      const text = await resp.text().catch(() => "");
      return json({
        state: "unhealthy",
        has_url,
        has_token,
        worker_url,
        http_status: resp.status,
        detail: `Worker returned ${resp.status}: ${text.slice(0, 200)}`,
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
