/**
 * generate-garage-car-views
 *
 * Given a garage_cars row, generate 4 canonical OEM photographs of the car
 * (front 3/4, side, rear 3/4, rear) using Gemini and store them on the row.
 *
 * Runs the heavy generation in the background via EdgeRuntime.waitUntil so
 * the request returns immediately and the UI can poll the row's
 * `generation_status` column.
 *
 * Body: { garage_car_id: string }
 * Returns: { ok: true } (immediate; status updates land on the row)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ANGLES = [
  {
    key: "front34" as const,
    column: "ref_front34_url",
    framing: "front three-quarter view, slight low angle, full car visible",
  },
  {
    key: "side" as const,
    column: "ref_side_url",
    framing: "pure side profile view, perpendicular to the car, full body in frame",
  },
  {
    key: "rear34" as const,
    column: "ref_rear34_url",
    framing: "rear three-quarter view from the opposite side, full car visible",
  },
  {
    key: "rear" as const,
    column: "ref_rear_url",
    framing: "direct rear view showing the full back of the car, taillights visible",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { garage_car_id } = await req.json() as { garage_car_id?: string };
    if (!garage_car_id) return json({ error: "garage_car_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: car } = await admin
      .from("garage_cars")
      .select("*")
      .eq("id", garage_car_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!car) return json({ error: "Garage car not found" }, 404);

    // Mark as generating, clear previous urls
    await admin.from("garage_cars").update({
      generation_status: "generating",
      generation_error: null,
      ref_front34_url: null,
      ref_side_url: null,
      ref_rear34_url: null,
      ref_rear_url: null,
    }).eq("id", garage_car_id);

    // Background work — return immediately so the UI can poll.
    // @ts-ignore EdgeRuntime is provided by Deno.
    EdgeRuntime.waitUntil(runGeneration(admin, car, userId).catch(async (e) => {
      console.error("garage gen failed:", e);
      await admin.from("garage_cars").update({
        generation_status: "failed",
        generation_error: e instanceof Error ? e.message : String(e),
      }).eq("id", garage_car_id);
    }));

    return json({ ok: true });
  } catch (e) {
    console.error("generate-garage-car-views error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runGeneration(admin: any, car: any, userId: string) {
  const carLabel = [
    car.year ? String(car.year) : "",
    car.make,
    car.model,
    car.trim ?? "",
  ].filter(Boolean).join(" ");

  const colorClause = car.color ? `Paint colour: ${car.color}.` : "";
  const notesClause = car.notes ? `Additional notes: ${car.notes}.` : "";

  // Step 1: generate the hero (front 3/4) shot from text. This locks in
  // identity (paint, wheels, stance, lighting). The other 3 angles will
  // reuse it as the primary reference for visual consistency.
  let heroDataUrl: string | null = null;

  for (const angle of ANGLES) {
    const isHero = angle.key === "front34";
    const promptText = isHero
      ? [
          `Photorealistic studio photograph of a STOCK FACTORY ${carLabel}. ` +
            `${colorClause} ${notesClause}`,
          `CRITICAL: This is the OEM, unmodified vehicle exactly as it left the factory. ` +
            `No body kit, no aftermarket parts, no modifications. Stock bumpers, stock wheels, ` +
            `stock ride height, stock badging, stock everything.`,
          `Camera framing: ${angle.framing}.`,
          `Style: clean automotive press photo, dark seamless studio backdrop, soft even ` +
            `professional lighting with subtle rim highlights, sharp focus, accurate proportions.`,
          `No text, no watermark, no UI overlays, no people, no other vehicles.`,
        ].join(" ")
      : [
          `The attached image is a stock factory ${carLabel} that we already approved.`,
          `Render THE EXACT SAME PHYSICAL CAR — same paint colour, same wheels, same trim, ` +
            `same ride height, same badging — but viewed from a different camera angle.`,
          `Camera framing: ${angle.framing}.`,
          `Match the reference's lighting style, backdrop, and overall mood exactly.`,
          `This is still a stock OEM vehicle, no modifications.`,
          `No text, no watermark, no UI overlays.`,
        ].join(" ");

    const content: any[] = [{ type: "text", text: promptText }];
    if (!isHero && heroDataUrl) {
      content.push({ type: "image_url", image_url: { url: heroDataUrl } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      throw new Error(`Gateway ${aiResp.status} on ${angle.key}: ${t.slice(0, 200)}`);
    }
    const j = await aiResp.json();
    const dataUrl: string | undefined = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl?.startsWith("data:image/")) {
      throw new Error(`No image in response for ${angle.key}`);
    }

    if (isHero) heroDataUrl = dataUrl;

    const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
    if (!m) throw new Error("invalid data URL");
    const mime = m[1];
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const ext = mime.includes("jpeg") ? "jpg" : "png";
    const path = `garage/${userId}/${car.id}/${angle.key}-${Date.now()}.${ext}`;

    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`upload failed for ${angle.key}: ${upErr.message}`);
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    await admin.from("garage_cars").update({ [angle.column]: publicUrl }).eq("id", car.id);
  }

  await admin.from("garage_cars").update({
    generation_status: "ready",
    generation_error: null,
  }).eq("id", car.id);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
