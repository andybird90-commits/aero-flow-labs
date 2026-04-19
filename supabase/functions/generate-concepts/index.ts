/**
 * generate-concepts
 *
 * Given a project + design brief (and optionally a viewer screenshot of the
 * uploaded car), generate 3 styling concept variations using Lovable AI's
 * image model. Each generated image is uploaded to the `concept-renders`
 * bucket and inserted as a `concepts` row tied to the project.
 *
 * Body shape:
 *   { project_id: string; brief_id: string; snapshot_data_url?: string }
 *
 * Returns: { count: number, concept_ids: string[] }
 *
 * Notes
 * - We deliberately do NOT promise photorealistic concept-to-mesh fidelity.
 *   These renders are creative direction; geometry comes from the parametric
 *   parts pipeline downstream.
 * - Auth: caller must be the owner of `project_id` (RLS enforces this on the
 *   final concept insert via service role check).
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

type AngleKey = "front_three_quarter" | "side" | "rear_three_quarter" | "rear";

interface Body {
  project_id: string;
  brief_id: string;
  /** Legacy single snapshot (front 3/4). Kept for backward compatibility. */
  snapshot_data_url?: string | null;
  /** Map of camera preset -> data URL. Preferred input. */
  snapshots?: Partial<Record<AngleKey, string | null>>;
}

const VARIATIONS: Array<{ title: string; direction: string; modifier: string }> = [
  {
    title: "OEM+ refined",
    direction: "Subtle, road-friendly enhancements that keep the factory identity. Clean splitter, modest skirts, restrained ducktail.",
    modifier: "OEM+ subtle styling, factory-respectful body kit, clean lines, premium street look",
  },
  {
    title: "Track-focused aggression",
    direction: "Aggressive aero kit with deeper splitter, larger canards, prominent rear wing and diffuser.",
    modifier: "aggressive track build, deep front splitter, large rear wing, exposed canards, race-inspired bodywork",
  },
  {
    title: "Widebody GT",
    direction: "Widebody arches, GT-style splitter, integrated side skirts, motorsport-grade rear wing.",
    modifier: "widebody GT aero kit, flared arches, motorsport rear wing, GT3-inspired bodywork, fitment-focused stance",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.project_id || !body?.brief_id) {
      return json({ error: "project_id and brief_id are required" }, 400);
    }

    // Auth user
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load brief
    const { data: brief, error: bErr } = await admin
      .from("design_briefs")
      .select("*")
      .eq("id", body.brief_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (bErr || !brief) return json({ error: "Brief not found" }, 404);

    // Resolve concept_set
    const { data: cs } = await admin
      .from("concept_sets")
      .select("id")
      .eq("project_id", body.project_id)
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    const stylePrompt = [
      brief.prompt,
      brief.build_type ? `Build type: ${brief.build_type}.` : "",
      Array.isArray(brief.style_tags) && brief.style_tags.length
        ? `Style tags: ${brief.style_tags.join(", ")}.`
        : "",
      Array.isArray(brief.constraints) && brief.constraints.length
        ? `Constraints: ${brief.constraints.join("; ")}.`
        : "",
    ].filter(Boolean).join(" ");

    const inserted: string[] = [];

    const hasSnapshot = !!(body.snapshot_data_url
      && typeof body.snapshot_data_url === "string"
      && body.snapshot_data_url.startsWith("data:image/"));
    console.log("generate-concepts: snapshot attached =", hasSnapshot,
      "len =", body.snapshot_data_url?.length ?? 0);

    // Normalise snapshots: prefer per-angle map, fall back to legacy single image.
    const snaps: Record<AngleKey, string | null> = {
      front_three_quarter: body.snapshots?.front_three_quarter ?? body.snapshot_data_url ?? null,
      side: body.snapshots?.side ?? null,
      rear_three_quarter: body.snapshots?.rear_three_quarter ?? null,
      rear: body.snapshots?.rear ?? body.snapshots?.rear_three_quarter ?? null,
    };

    const ANGLES: Array<{ key: AngleKey; label: string; framing: string }> = [
      { key: "front_three_quarter", label: "front three-quarter",
        framing: "three-quarter front view, slight low angle, full car in frame" },
      { key: "side", label: "side profile",
        framing: "pure side profile view, perpendicular to the car, full body in frame" },
      { key: "rear_three_quarter", label: "rear three-quarter",
        framing: "three-quarter rear view from the opposite side, full car in frame" },
      { key: "rear", label: "rear",
        framing: "direct rear view showing the full back of the car, taillights visible" },
    ];

    console.log("generate-concepts: snapshots present =",
      Object.fromEntries(Object.entries(snaps).map(([k, v]) => [k, !!v])));

    async function renderAngle(v: typeof VARIATIONS[number], angle: typeof ANGLES[number]): Promise<string | null> {
      const ref = snaps[angle.key];
      const hasRef = !!(ref && ref.startsWith("data:image/"));

      const editPrompt =
        `Re-render THE EXACT CAR shown in the reference image with an added ${v.modifier} body kit, ` +
        `framed as a ${angle.framing}. ` +
        `CRITICAL: Preserve the original car's identity — same make and model, same body shape, ` +
        `same silhouette, same greenhouse, same headlight and taillight design, same wheelbase, ` +
        `same door and window lines, same overall proportions. Do NOT replace the car with a ` +
        `different model. Across all generated angles for this concept, keep the SAME paint colour, ` +
        `SAME wheels, and the SAME body kit details so the four views look like one consistent car. ` +
        `Only add or modify bolt-on aero/styling parts (front splitter, side skirts, arches, rear ` +
        `diffuser, wing, canards) consistent with the styling brief. ` +
        `${stylePrompt} ` +
        `Studio lighting, dark dramatic backdrop, photorealistic, sharp focus, clean reflections, ` +
        `no text, no watermark, no UI overlays.`;

      const textPrompt =
        `Premium automotive concept render of a custom car body kit, ${angle.framing}. ${v.modifier}. ` +
        `${stylePrompt} ` +
        `Studio lighting, dark dramatic backdrop, photorealistic, concept design quality, ` +
        `sharp focus, clean reflections, no text, no watermark.`;

      const messages: any[] = [{
        role: "user",
        content: [{ type: "text", text: hasRef ? editPrompt : textPrompt }],
      }];
      if (hasRef) {
        messages[0].content.push({ type: "image_url", image_url: { url: ref } });
      }

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image-preview",
          messages,
          modalities: ["image", "text"],
        }),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error(`AI gen failed (${v.title} / ${angle.key}):`, aiResp.status, t.slice(0, 200));
        // Surface rate-limit / payment errors up so the caller sees them
        if (aiResp.status === 429) throw new Error("__RATE_LIMIT__");
        if (aiResp.status === 402) throw new Error("__NO_CREDITS__");
        return null;
      }

      const aiJson = await aiResp.json();
      const imgUrl: string | undefined =
        aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imgUrl?.startsWith("data:image/")) return null;

      const [, mime, b64] = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i) ?? [];
      if (!b64) return null;

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ext = mime?.includes("jpeg") ? "jpg" : "png";
      const path = `${userId}/${body.project_id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        console.error("upload failed:", upErr);
        return null;
      }
      return admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    }

    try {
      for (const v of VARIATIONS) {
        // Render all 4 angles in parallel
        const results = await Promise.all(ANGLES.map((a) => renderAngle(v, a)));
        const [front, side, rear34, rear] = results;

        if (!front && !side && !rear34 && !rear) {
          console.warn("All angles failed for variation:", v.title);
          continue;
        }

        const { data: concept, error: cErr } = await admin
          .from("concepts")
          .insert({
            user_id: userId,
            project_id: body.project_id,
            concept_set_id: cs?.id ?? null,
            title: v.title,
            direction: v.direction,
            status: "pending",
            render_front_url: front,
            render_side_url: side,
            render_rear34_url: rear34,
            render_rear_url: rear,
            ai_notes: stylePrompt.slice(0, 500),
          })
          .select("id")
          .single();
        if (cErr) {
          console.error("concept insert failed:", cErr);
          continue;
        }
        inserted.push(concept.id);
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === "__RATE_LIMIT__") return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (msg === "__NO_CREDITS__") return json({ error: "AI credits exhausted." }, 402);
      throw err;
    }

    if (inserted.length === 0) {
      return json({ error: "No concepts could be generated. Please try again." }, 500);
    }

    // Bump project status
    await admin
      .from("projects")
      .update({ status: "concepts" })
      .eq("id", body.project_id)
      .eq("user_id", userId);

    return json({ count: inserted.length, concept_ids: inserted });
  } catch (e) {
    console.error("generate-concepts error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
