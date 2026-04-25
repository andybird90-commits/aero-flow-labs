/**
 * save-car-material-map — admin-only endpoint that stores a manually
 * curated per-triangle paint map for a car_stl.
 *
 * Body: { car_stl_id: string, tags_b64: string, stats?: {...}, notes?: string }
 *
 * Sets `method = 'manual'` so the client's auto-classify hook will leave it
 * alone — admins curate once, end-users get the perfect map for free.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SaveBody {
  car_stl_id: string;
  tags_b64: string;
  triangle_count: number;
  stats?: { body?: number; glass?: number; wheel?: number; tyre?: number; total?: number };
  notes?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Verify caller identity
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    // Verify admin role via has_role()
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr) throw roleErr;
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    const body = (await req.json()) as SaveBody;
    if (!body.car_stl_id || !body.tags_b64 || !body.triangle_count) {
      return json({ error: "car_stl_id, tags_b64, triangle_count required" }, 400);
    }
    if (body.triangle_count > 5_000_000) {
      return json({ error: "triangle_count too large" }, 400);
    }

    const { data: saved, error: upErr } = await admin
      .from("car_material_maps")
      .upsert(
        {
          car_stl_id: body.car_stl_id,
          method: "manual",
          triangle_count: body.triangle_count,
          tag_blob_b64: body.tags_b64,
          stats: body.stats ?? {},
          ai_notes: body.notes ?? null,
        },
        { onConflict: "car_stl_id" },
      )
      .select("id, method, triangle_count, stats")
      .single();
    if (upErr) throw upErr;

    return json({ ok: true, map: saved });
  } catch (e) {
    console.error("[save-car-material-map] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
