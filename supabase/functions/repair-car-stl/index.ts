/**
 * repair-car-stl
 *
 * Admin-only. Loads a hero-car STL row from `car_stls`, downloads the raw
 * file from the `car-stls` bucket, runs the repair pass (weld + degenerate
 * removal + outward normal orientation + manifold check), uploads the
 * repaired result alongside the original, and updates the row with stats.
 *
 * Body: { car_stl_id: string }
 *
 * The boolean aero-kit pipeline refuses to run on non-manifold inputs, so
 * `manifold_clean` is the gate the rest of the system reads.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { repairObj } from "../_shared/obj-repair.ts";
import { repairStl } from "../_shared/stl-repair.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { car_stl_id?: string };
    if (!body.car_stl_id) return json({ error: "car_stl_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userRes.user.id,
      _role: "admin",
    });
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: row, error: rowErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: "car_stls row not found" }, 404);

    const { data: file, error: dlErr } = await admin.storage
      .from("car-stls")
      .download(row.stl_path);
    if (dlErr || !file) return json({ error: `Download failed: ${dlErr?.message ?? "unknown"}` }, 500);

    const inputBytes = new Uint8Array(await file.arrayBuffer());
    if (inputBytes.length === 0) return json({ error: "Empty mesh file" }, 400);

    const isObj = /\.obj$/i.test(row.stl_path);
    const result = isObj ? repairObj(inputBytes) : repairStl(inputBytes);

    const repairedPath = row.stl_path.replace(/\.(stl|obj)$/i, "") + ".repaired.stl";
    const { error: upErr } = await admin.storage
      .from("car-stls")
      .upload(repairedPath, result.bytes, {
        contentType: "model/stl",
        upsert: true,
      });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const { error: updErr } = await admin
      .from("car_stls")
      .update({
        repaired_stl_path: repairedPath,
        manifold_clean: result.stats.manifold,
        triangle_count: result.stats.triangle_count_out,
        bbox_min_mm: result.stats.bbox_min,
        bbox_max_mm: result.stats.bbox_max,
      })
      .eq("id", row.id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, stats: result.stats, repaired_stl_path: repairedPath });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
