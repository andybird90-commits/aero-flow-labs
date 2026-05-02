/**
 * Tiny Perplexity helper — used by spec part / concept generators to ground
 * prompts in real-world references (motorsport parts, body kit terminology,
 * brand-specific styling) before we hand them to image / mesh models.
 *
 * Returns a short factual blurb + a list of citation URLs. Designed to fail
 * silently so generation never blocks if Perplexity is unreachable.
 */

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

export interface PerplexityContext {
  /** Compact, model-readable summary (≤ ~600 chars). Empty string on failure. */
  summary: string;
  /** Citation URLs returned by Perplexity. */
  citations: string[];
}

/**
 * Quick factual lookup tailored for car-aero / parts research.
 * Times out fast (10s) — generation must not stall on a slow web call.
 */
export async function perplexityResearch(
  query: string,
  opts?: { systemHint?: string; recency?: "day" | "week" | "month" | "year" },
): Promise<PerplexityContext> {
  const apiKey = Deno.env.get("PERPLEXITY_API_KEY");
  if (!apiKey) return { summary: "", citations: [] };
  if (!query?.trim()) return { summary: "", citations: [] };

  const system = opts?.systemHint ??
    "You are a motorsport / automotive aero design researcher. Answer in 4–6 short bullet points. " +
    "Focus on: real-world part naming, common shapes/proportions, brands/products that match, " +
    "materials, mounting style. No prose, no intros, no disclaimers. Plain text bullets only.";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);

  try {
    const resp = await fetch(PERPLEXITY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: system },
          { role: "user", content: query.trim() },
        ],
        max_tokens: 400,
        temperature: 0.2,
        ...(opts?.recency ? { search_recency_filter: opts.recency } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(`[perplexity] ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      return { summary: "", citations: [] };
    }
    const j = await resp.json();
    const summary = String(j?.choices?.[0]?.message?.content ?? "").trim().slice(0, 800);
    const citations = Array.isArray(j?.citations) ? j.citations.slice(0, 6) : [];
    return { summary, citations };
  } catch (e) {
    console.warn("[perplexity] error:", e instanceof Error ? e.message : e);
    return { summary: "", citations: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Format the context as a prompt-injection block — empty string if no summary. */
export function formatResearchBlock(ctx: PerplexityContext, label = "REAL-WORLD REFERENCE"): string {
  if (!ctx.summary) return "";
  const cites = ctx.citations.length ? `\nSources: ${ctx.citations.join(" | ")}` : "";
  return `\n\n${label} (use to inform shape, naming, proportions — do not copy verbatim):\n${ctx.summary}${cites}`;
}
