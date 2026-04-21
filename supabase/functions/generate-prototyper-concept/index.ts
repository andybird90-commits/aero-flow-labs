// Generate a single concept image on top of a garage car view, for the new
// Prototyper Generate mode. The ONLY AI call path on the new Prototyper page.
//
// Body: { garage_car_id, view_angle, prompt, style_preset, target_zone, aggression }
// Returns: { image_url } — public PNG saved to prototype-uploads bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface ReqBody {
  prototype_id: string;
  garage_car_id: string;
  view_angle: "front" | "front34" | "side" | "rear34" | "rear";
  prompt: string;
  style_preset: string;
  target_zone: string;
  aggression: number; // 0..100
}

const VIEW_FIELD: Record<ReqBody["view_angle"], string> = {
  front: "ref_front_url",
  front34: "ref_front34_url",
  side: "ref_side_url",
  rear34: "ref_rear34_url",
  rear: "ref_rear_url",
};

const STYLE_PROMPT: Record<string, string> = {
  time_attack: "time-attack track car aero, exposed carbon, functional",
  gt_track: "GT3-style aero, motorsport vents, wide arches",
  street: "tasteful street body kit, clean lines, OEM+",
  widebody: "widebody fender flares, aggressive stance",
  rally: "rally raid look, mud flaps, robust bash plates",
};

const ZONE_PROMPT: Record<string, string> = {
  front_bumper: "front bumper / splitter area",
  front_quarter: "front quarter panel",
  bonnet: "bonnet / hood",
  door_quarter: "door / front quarter (side scoop area)",
  sill: "sill / side skirt",
  rear_quarter: "rear quarter panel",
  rear_bumper: "rear bumper / diffuser",
  wing_zone: "wing / tail zone",
};

function aggressionWord(n: number) {
  if (n < 20) return "subtle";
  if (n < 50) return "moderate";
  if (n < 80) return "aggressive";
  return "extreme";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.garage_car_id || !body.view_angle || !body.prototype_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the source car view URL
    const { data: car, error: carErr } = await supabase
      .from("garage_cars")
      .select(`id, make, model, year, color, ${VIEW_FIELD[body.view_angle]}`)
      .eq("id", body.garage_car_id)
      .single();
    if (carErr || !car) throw new Error("Garage car not found");
    const sourceUrl = (car as any)[VIEW_FIELD[body.view_angle]];
    if (!sourceUrl) throw new Error(`No ${body.view_angle} view available for this car`);

    const styleText = STYLE_PROMPT[body.style_preset] ?? body.style_preset;
    const zoneText = ZONE_PROMPT[body.target_zone] ?? body.target_zone;
    const agg = aggressionWord(body.aggression);

    const fullPrompt =
      `Edit this photo of a ${car.year ?? ""} ${car.make} ${car.model}: ` +
      `add ${agg} aero modification on the ${zoneText}. ` +
      `Style: ${styleText}. ` +
      `${body.prompt ? "User direction: " + body.prompt + ". " : ""}` +
      `Keep the car body, paint colour, lighting and camera angle identical. ` +
      `Only modify the ${zoneText}. Photoreal output.`;

    // Call Lovable AI Gateway (Gemini 3 image preview supports edit-with-reference)
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: fullPrompt },
            { type: "image_url", image_url: { url: sourceUrl } },
          ],
        }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI gateway ${aiRes.status}: ${errText}`);
    }

    const aiJson = await aiRes.json();
    const imageData =
      aiJson.choices?.[0]?.message?.images?.[0]?.image_url?.url ??
      aiJson.choices?.[0]?.message?.content?.find?.((c: any) => c.type === "image_url")?.image_url?.url;
    if (!imageData) throw new Error("No image returned from AI gateway");

    // Decode data URL → bytes
    const m = String(imageData).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("Unexpected AI image payload");
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const path = `${user.id}/${body.prototype_id}/concept-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("prototype-uploads")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = admin.storage
      .from("prototype-uploads").getPublicUrl(path);

    return new Response(
      JSON.stringify({ image_url: publicUrl, source_url: sourceUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[generate-prototyper-concept] error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
