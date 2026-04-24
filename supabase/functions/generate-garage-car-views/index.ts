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
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { lovableGenerateImageWithFallback } from "../_shared/lovable-image.ts";

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
    framing: "front three-quarter view from the driver's side, slight low angle, full car visible",
  },
  {
    key: "front" as const,
    column: "ref_front_url",
    framing: "direct front view, perpendicular to the car, headlights and grille fully visible, full width in frame",
  },
  {
    key: "side" as const,
    column: "ref_side_url",
    framing: "pure side profile view from the driver's side, perpendicular to the car, full body in frame",
  },
  {
    key: "side_opposite" as const,
    column: "ref_side_opposite_url",
    framing: "pure side profile from the OPPOSITE side of the car to the previous side reference (i.e. the passenger side in left-hand-drive markets, driver side in right-hand-drive markets — whichever is opposite to the reference image). Mirror-image perspective compared to the reference. Perpendicular camera, full body in frame. This side should show any asymmetric details such as the fuel filler cap on this flank",
  },
  {
    key: "rear34" as const,
    column: "ref_rear34_url",
    framing: "rear three-quarter view from the passenger side, full car visible",
  },
  {
    key: "rear" as const,
    column: "ref_rear_url",
    framing: "direct rear view showing the full back of the car, taillights visible",
  },
];

type AngleKey = (typeof ANGLES)[number]["key"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { garage_car_id, angles: requestedAngles } = await req.json() as {
      garage_car_id?: string;
      angles?: string[];
    };
    if (!garage_car_id) return json({ error: "garage_car_id required" }, 400);

    // Validate optional partial regeneration list. Empty/undefined = all 6.
    const validKeys = new Set(ANGLES.map((a) => a.key));
    const partialAngles = Array.isArray(requestedAngles) && requestedAngles.length > 0
      ? requestedAngles.filter((k) => validKeys.has(k as any))
      : null;

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

    // Mark as generating. For partial regeneration only clear the requested
    // columns so the other angles stay visible while one is being redone.
    const clearPatch: Record<string, any> = {
      generation_status: "generating",
      generation_error: null,
    };
    const anglesToRun = partialAngles
      ? ANGLES.filter((a) => partialAngles.includes(a.key))
      : ANGLES;
    for (const a of anglesToRun) clearPatch[a.column] = null;
    await admin.from("garage_cars").update(clearPatch).eq("id", garage_car_id);

    // Background work — return immediately so the UI can poll.
    // @ts-ignore EdgeRuntime is provided by Deno.
    EdgeRuntime.waitUntil(runGeneration(admin, car, userId, anglesToRun).catch(async (e) => {
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

async function runGeneration(
  admin: any,
  car: any,
  userId: string,
  anglesToRun: typeof ANGLES,
) {
  const carLabel = [
    car.year ? String(car.year) : "",
    car.make,
    car.model,
    car.trim ?? "",
  ].filter(Boolean).join(" ");

  const colorClause = car.color ? `Paint colour: ${car.color}.` : "";
  const notesClause = car.notes ? `Additional notes: ${car.notes}.` : "";

  const references: Partial<Record<AngleKey, string>> = {};
  for (const angle of ANGLES) {
    const existing = car[angle.column];
    if (typeof existing === "string" && existing) references[angle.key] = existing;
  }

  for (const angle of anglesToRun) {
    const promptText = buildAnglePrompt({
      angleKey: angle.key,
      carLabel,
      colorClause,
      notesClause,
    });
    const referenceImages = getReferenceImagesForAngle(angle.key, references);
    const generated = await lovableGenerateImageWithFallback({
      apiKey: LOVABLE_API_KEY,
      prompt: promptText,
      referenceImages,
    });
    const dataUrl = generated.dataUrl;
    if (!generated.ok || !dataUrl?.startsWith("data:image/")) {
      throw new Error(`Image generation failed for ${angle.key}: ${generated.error ?? "no image returned"}`);
    }

    references[angle.key] = dataUrl;

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
    references[angle.key] = publicUrl;
  }

  await admin.from("garage_cars").update({
    generation_status: "ready",
    generation_error: null,
  }).eq("id", car.id);
}

function buildAnglePrompt({
  angleKey,
  carLabel,
  colorClause,
  notesClause,
}: {
  angleKey: AngleKey;
  carLabel: string;
  colorClause: string;
  notesClause: string;
}) {
  const baseIdentity = [
    `Stock factory ${carLabel}.`,
    colorClause,
    notesClause,
    `This must stay OEM and unmodified: stock bumpers, stock wheels, stock ride height, stock trim, stock badging.`,
    `Photoreal studio press photography on a dark seamless backdrop with soft even lighting, accurate proportions, sharp focus, subtle floor reflection.`,
    `No text, no watermark, no UI overlays, no people, no other vehicles.`,
  ].filter(Boolean).join(" ");

  if (angleKey === "front34") {
    return `${baseIdentity} Camera framing: front three-quarter view from the driver's side, slight low angle, full car visible.`;
  }

  if (angleKey === "side") {
    return [
      `The attached reference shows the approved exact same car identity for ${carLabel}.`,
      baseIdentity,
      `Camera framing: pure side profile view from one flank only, perfectly perpendicular, full body in frame bumper-to-bumper, both wheels fully visible.`,
      `Keep this as Side A, with crisp side-profile geometry and no three-quarter drift.`,
    ].join(" ");
  }

  if (angleKey === "side_opposite") {
    return [
      `The attached references show the approved exact same car identity for ${carLabel}, including the already-approved first side profile.`,
      baseIdentity,
      `Camera framing: pure side profile of the OPPOSITE flank from the approved side reference, perfectly perpendicular, full body in frame bumper-to-bumper, both wheels fully visible.`,
      `CRITICAL: Do not repeat Side A. Render Side B only — the other side of the car. Preserve all identity cues while moving side-specific details to the opposite flank, such as fuel door or charging-port placement when applicable.`,
      `Match the studio lighting and ride height exactly to the other side reference.`,
    ].join(" ");
  }

  if (angleKey === "front") {
    return [
      `The attached reference shows the approved exact same car identity for ${carLabel}.`,
      baseIdentity,
      `Camera framing: direct front view, perpendicular to the car, headlights and grille fully visible, full width in frame.`,
      `Keep the exact same lighting, wheel design, paint, and stance as the references.`,
    ].join(" ");
  }

  if (angleKey === "rear34") {
    return [
      `The attached reference shows the approved exact same car identity for ${carLabel}.`,
      baseIdentity,
      `Camera framing: rear three-quarter view from the passenger side, full car visible.`,
      `Match the reference lighting, backdrop, and precise stock body geometry exactly.`,
    ].join(" ");
  }

  return [
    `The attached reference shows the approved exact same car identity for ${carLabel}.`,
    baseIdentity,
    `Camera framing: direct rear view showing the full back of the car, taillights visible.`,
    `Keep the image perfectly centred and OEM-accurate.`,
  ].join(" ");
}

function getReferenceImagesForAngle(
  angleKey: AngleKey,
  references: Partial<Record<AngleKey, string>>,
) {
  const desiredOrder: Record<AngleKey, AngleKey[]> = {
    front34: [],
    front: ["front34"],
    side: ["front34", "front"],
    side_opposite: ["side", "front34", "front", "rear34"],
    rear34: ["front34", "side_opposite", "side"],
    rear: ["rear34", "side_opposite", "front34"],
  };

  return desiredOrder[angleKey]
    .map((key) => references[key])
    .filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index)
    .slice(0, 3);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
