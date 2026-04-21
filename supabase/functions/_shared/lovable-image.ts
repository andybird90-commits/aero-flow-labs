/**
 * Thin wrapper around Lovable AI Gateway image models. Returns a data URL on
 * success so call sites can decode → upload to a Supabase storage bucket.
 *
 * Default model: google/gemini-3.1-flash-image-preview (fast + good fidelity).
 * Fallback for retries: google/gemini-3-pro-image-preview (slower, higher fidelity).
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface LovableImageResult {
  ok: boolean;
  dataUrl?: string;
  status?: number;
  error?: string;
}

interface LovableImageOpts {
  apiKey: string;
  prompt: string;
  /** Reference images (data URLs OR public http(s) URLs). */
  referenceImages?: string[];
  /** Override the model. Defaults to google/gemini-3.1-flash-image-preview. */
  model?: string;
}

export async function lovableGenerateImage(opts: LovableImageOpts): Promise<LovableImageResult> {
  const model = opts.model ?? "google/gemini-3.1-flash-image-preview";
  const refs = opts.referenceImages?.filter(Boolean) ?? [];

  const userContent: any[] = [{ type: "text", text: opts.prompt }];
  for (const ref of refs) {
    userContent.push({ type: "image_url", image_url: { url: ref } });
  }

  try {
    const resp = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userContent }],
        modalities: ["image", "text"],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, status: resp.status, error: t.slice(0, 400) };
    }
    const j = await resp.json();
    const url = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
    if (!url) return { ok: false, status: 502, error: "no image in Lovable AI response" };
    return { ok: true, dataUrl: url };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Try fast model first, then fall back to pro on retry/quality failure.
 */
export async function lovableGenerateImageWithFallback(opts: LovableImageOpts): Promise<LovableImageResult> {
  const fast = await lovableGenerateImage(opts);
  if (fast.ok) return fast;
  // Don't burn through pro on hard auth/quota errors.
  if (fast.status === 429 || fast.status === 402 || fast.status === 403) return fast;
  const pro = await lovableGenerateImage({ ...opts, model: "google/gemini-3-pro-image-preview" });
  return pro.ok ? pro : fast;
}
