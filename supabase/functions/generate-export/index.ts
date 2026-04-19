// Edge function: generate-export
// Generates a downloadable export artifact (PDF / image pack / CSV / etc.),
// uploads it to the `exports` storage bucket, and updates the exports row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return j({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return j({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const build_id: string | null = body.build_id ?? null;
    const variant_id: string | null = body.variant_id ?? null;
    const kind: string = body.kind ?? "pdf_report";
    const sections: string[] = body.sections ?? [];
    const audience: string = body.audience ?? "internal";

    // Load build + variant + result for content
    let buildName = "AeroLab Build";
    let variantName = "";
    let result: any = null;

    if (build_id) {
      const { data: b } = await supabase.from("builds").select("*, car:cars(*, template:car_templates(*))").eq("id", build_id).maybeSingle();
      if (b) buildName = b.name;
    }
    if (variant_id) {
      const { data: v } = await supabase.from("variants").select("*").eq("id", variant_id).maybeSingle();
      if (v) variantName = v.name;
      const { data: r } = await supabase.from("simulation_results")
        .select("*").eq("variant_id", variant_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      result = r;
    }

    // Create exports row (generating)
    const { data: exp, error: expErr } = await admin.from("exports").insert({
      user_id: user.id, build_id, variant_id, kind, sections, audience,
      status: "generating",
    }).select("*").single();
    if (expErr) throw expErr;

    // Generate content based on kind
    const { content, mime, ext, size } = generateContent(kind, buildName, variantName, result, sections);

    // Upload to exports bucket
    const path = `${user.id}/${exp.id}.${ext}`;
    const { error: upErr } = await admin.storage.from("exports").upload(path, content, {
      contentType: mime, upsert: true,
    });
    if (upErr) throw upErr;

    // Update row
    await admin.from("exports").update({
      status: "ready",
      file_path: path,
      file_size_bytes: size,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", exp.id);

    return j({ export_id: exp.id, status: "ready", path });
  } catch (err) {
    console.error("generate-export error:", err);
    return j({ error: (err as Error).message }, 500);
  }
});

function generateContent(kind: string, buildName: string, variantName: string, result: any, sections: string[]) {
  if (kind === "comparison_sheet") {
    const rows = [
      ["Metric", "Value"],
      ["Build", buildName],
      ["Variant", variantName],
      ["Cd", result?.cd ?? "—"],
      ["Drag (kgf)", result?.drag_kgf ?? "—"],
      ["Downforce front (kgf)", result?.df_front_kgf ?? "—"],
      ["Downforce rear (kgf)", result?.df_rear_kgf ?? "—"],
      ["Downforce total (kgf)", result?.df_total_kgf ?? "—"],
      ["L/D ratio", result?.ld_ratio ?? "—"],
      ["Balance % front", result?.balance_front_pct ?? "—"],
      ["Top speed (km/h)", result?.top_speed_kmh ?? "—"],
      ["Confidence", result?.confidence ?? "—"],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const bytes = new TextEncoder().encode(csv);
    return { content: bytes, mime: "text/csv", ext: "csv", size: bytes.byteLength };
  }

  // Default: build a minimal valid PDF
  const lines = [
    `AEROLAB · ${kind.toUpperCase().replace(/_/g, " ")}`,
    "",
    `Build: ${buildName}`,
    variantName ? `Variant: ${variantName}` : "",
    "",
    "Performance summary:",
    result ? `  Cd               ${result.cd}` : "",
    result ? `  Drag             ${result.drag_kgf} kgf` : "",
    result ? `  Downforce front  ${result.df_front_kgf} kgf` : "",
    result ? `  Downforce rear   ${result.df_rear_kgf} kgf` : "",
    result ? `  Downforce total  ${result.df_total_kgf} kgf` : "",
    result ? `  L/D ratio        ${result.ld_ratio}` : "",
    result ? `  Balance % front  ${result.balance_front_pct}` : "",
    result ? `  Top speed        ${result.top_speed_kmh} km/h` : "",
    result ? `  Confidence       ${result.confidence}` : "",
    "",
    "Sections included:",
    ...sections.map((s) => `  - ${s}`),
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Lovable Cloud · AeroLab",
  ].filter(Boolean);

  const pdf = makePdf(lines);
  return { content: pdf, mime: "application/pdf", ext: "pdf", size: pdf.byteLength };
}

// Minimal PDF generator (single page, monospace text)
function makePdf(lines: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let textOps = "BT\n/F1 11 Tf\n60 760 Td\n14 TL\n";
  for (const line of lines) {
    textOps += `(${escape(line)}) Tj\nT*\n`;
  }
  textOps += "ET\n";

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  objects.push(`<< /Length ${textOps.length} >>\nstream\n${textOps}endstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) {
    pdf += `${o.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
