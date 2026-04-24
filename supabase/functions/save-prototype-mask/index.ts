/**
 * save-prototype-mask
 *
 * Stores a user-painted binary mask aligned to one of the prototype's source
 * photos. The mask is white-on-transparent PNG where painted pixels = part.
 *
 * Body: { prototype_id: string, source_url: string, mask_data_url: string }
 *
 * Side effects:
 *  - Uploads mask PNG to prototype-uploads/<user>/<proto>/mask-<ts>.png
 *  - Appends the public URL to prototypes.source_mask_urls
 *  - Sets prototypes.primary_source_index to the matching source index
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prototype_id, source_url, mask_data_url } = (await req.json()) as {
      prototype_id?: string; source_url?: string; mask_data_url?: string;
    };
    if (!prototype_id || !source_url || !mask_data_url) {
      return json({ error: "prototype_id, source_url, mask_data_url required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: proto, error: protoErr } = await admin
      .from("prototypes")
      .select("id, user_id, source_image_urls, source_mask_urls")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    const sources = ((proto as any).source_image_urls as string[] | null) ?? [];
    const sourceIdx = sources.findIndex((u) => u === source_url);
    if (sourceIdx < 0) return json({ error: "source_url does not match any prototype source" }, 400);

    // Decode mask data URL
    const m = mask_data_url.match(/^data:(.+?);base64,(.+)$/);
    if (!m) return json({ error: "mask_data_url must be a base64 data URL" }, 400);
    const mime = m[1];
    if (!mime.includes("png")) return json({ error: "mask must be PNG" }, 400);
    const bytes = base64ToBytes(m[2]);
    if (bytes.byteLength > 8 * 1024 * 1024) return json({ error: "mask too large (>8MB)" }, 400);

    const path = `${userId}/${prototype_id}/mask-${Date.now()}.png`;
    const { error: upErr } = await admin.storage.from("prototype-uploads").upload(path, bytes, {
      contentType: "image/png", upsert: true,
    });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const publicUrl = admin.storage.from("prototype-uploads").getPublicUrl(path).data.publicUrl;

    // Replace any existing mask for this source index, otherwise append.
    const existing = ((proto as any).source_mask_urls as Array<{ source_index: number; url: string }> | null) ?? [];
    const next = existing.filter((e) => e?.source_index !== sourceIdx);
    next.push({ source_index: sourceIdx, url: publicUrl });

    await admin.from("prototypes").update({
      source_mask_urls: next,
      primary_source_index: sourceIdx,
    }).eq("id", prototype_id);

    return json({ url: publicUrl, source_index: sourceIdx });
  } catch (e) {
    console.error("save-prototype-mask error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
