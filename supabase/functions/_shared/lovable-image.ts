/**
 * Image generation wrapper.
 *
 * Historically this called the Lovable AI Gateway (Gemini Nano-Banana). It
 * now routes everything to OpenAI's GPT Image 2 (`gpt-image-2`) so all image
 * generation in the project goes through one provider with consistent
 * fidelity and prompt-adherence.
 *
 * The exported names (`lovableGenerateImage`, `lovableGenerateImageWithFallback`)
 * and result shape (`{ ok, dataUrl, status, error }`) are preserved so every
 * existing call site keeps working without changes.
 *
 * - Text-only prompts → POST /v1/images/generations
 * - With reference images → POST /v1/images/edits  (multipart)
 *
 * Returns a base64 data URL on success so callers can decode → upload to
 * a Supabase storage bucket.
 */

const OPENAI_BASE = "https://api.openai.com/v1";

export interface LovableImageResult {
  ok: boolean;
  dataUrl?: string;
  status?: number;
  error?: string;
}

interface LovableImageOpts {
  /** Lovable AI key — kept for backwards compat but ignored. We use OPENAI_API_KEY. */
  apiKey?: string;
  prompt: string;
  referenceImages?: string[];
  /** Override model. Defaults to gpt-image-2. */
  model?: string;
  /** "1024x1024" | "1024x1536" | "1536x1024" | "auto". */
  size?: string;
  /** "low" | "medium" | "high" | "auto". */
  quality?: string;
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

export async function lovableGenerateImage(opts: LovableImageOpts): Promise<LovableImageResult> {
  if (!OPENAI_API_KEY) {
    return { ok: false, status: 500, error: "OPENAI_API_KEY not configured" };
  }
  const model = opts.model ?? "gpt-image-2";
  const size = opts.size ?? "1536x1024";
  const quality = opts.quality ?? "high";
  const refs = (opts.referenceImages ?? []).filter(Boolean);

  try {
    if (refs.length === 0) {
      const resp = await fetch(`${OPENAI_BASE}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, prompt: opts.prompt, size, quality, n: 1 }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return { ok: false, status: resp.status, error: t.slice(0, 400) };
      }
      const j = await resp.json();
      const b64 = j?.data?.[0]?.b64_json;
      if (!b64) return { ok: false, status: 502, error: "no image in OpenAI response" };
      return { ok: true, dataUrl: `data:image/png;base64,${b64}` };
    }

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("n", "1");
    for (let i = 0; i < refs.length; i++) {
      const blob = await refToBlob(refs[i]);
      form.append("image[]", blob, `ref-${i}.png`);
    }

    const resp = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, status: resp.status, error: t.slice(0, 400) };
    }
    const j = await resp.json();
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, status: 502, error: "no image in OpenAI response" };
    return { ok: true, dataUrl: `data:image/png;base64,${b64}` };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Backwards-compatible name. With a single provider there's no model fallback —
 * we just retry once on transient (non-auth/non-quota) failures.
 */
export async function lovableGenerateImageWithFallback(opts: LovableImageOpts): Promise<LovableImageResult> {
  const first = await lovableGenerateImage(opts);
  if (first.ok) return first;
  if (first.status === 429 || first.status === 402 || first.status === 401 || first.status === 403) return first;
  const second = await lovableGenerateImage(opts);
  return second.ok ? second : first;
}

async function refToBlob(ref: string): Promise<Blob> {
  if (ref.startsWith("data:")) {
    const m = ref.match(/^data:(.+?);base64,(.+)$/);
    if (!m) throw new Error("invalid data URL");
    const mime = m[1];
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }
  const r = await fetch(ref);
  if (!r.ok) throw new Error(`failed to fetch ref image: ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Blob([buf], { type: r.headers.get("content-type") ?? "image/png" });
}
