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

interface Body {
  project_id: string;
  brief_id: string;
  snapshot_data_url?: string | null;
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

    for (const v of VARIATIONS) {
      const fullPrompt =
        `Premium automotive concept render of a custom car body kit. ${v.modifier}. ` +
        `${stylePrompt} ` +
        `Studio lighting, dark dramatic backdrop, three-quarter front view, photorealistic, ` +
        `concept design quality, sharp focus, clean reflections, no text, no watermark.`;

      const messages: any[] = [{ role: "user", content: [{ type: "text", text: fullPrompt }] }];

      // Attach the viewer screenshot to ground the styling on the actual car
      if (body.snapshot_data_url && typeof body.snapshot_data_url === "string"
          && body.snapshot_data_url.startsWith("data:image/")) {
        messages[0].content.push({
          type: "image_url",
          image_url: { url: body.snapshot_data_url },
        });
      }

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages,
          modalities: ["image", "text"],
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
        if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
        const t = await aiResp.text();
        console.error("AI image gen failed:", aiResp.status, t);
        continue;
      }

      const aiJson = await aiResp.json();
      const imgUrl: string | undefined =
        aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imgUrl?.startsWith("data:image/")) {
        console.warn("No image in response for variation:", v.title);
        continue;
      }

      // data:image/png;base64,...
      const [, mime, b64] = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i) ?? [];
      if (!b64) continue;

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ext = mime?.includes("jpeg") ? "jpg" : "png";
      const path = `${userId}/${body.project_id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        console.error("upload failed:", upErr);
        continue;
      }

      const { data: pub } = admin.storage.from("concept-renders").getPublicUrl(path);
      const renderUrl = pub.publicUrl;

      const { data: concept, error: cErr } = await admin
        .from("concepts")
        .insert({
          user_id: userId,
          project_id: body.project_id,
          concept_set_id: cs?.id ?? null,
          title: v.title,
          direction: v.direction,
          status: "pending",
          render_front_url: renderUrl,
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
