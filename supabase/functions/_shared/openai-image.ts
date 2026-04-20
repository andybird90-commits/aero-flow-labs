/**
 * Thin wrapper around OpenAI's Images API (gpt-image-1) that mirrors the
 * shape our existing Lovable AI Gateway call sites expect:
 *
 *   { ok: true,  dataUrl: "data:image/png;base64,..." }   on success
 *   { ok: false, status, error }                          on failure
 *
 * Both `generate-concepts` and `render-isolated-part` previously talked to
 * the gateway and pulled `aiJson.choices[0].message.images[0].image_url.url`
 * (a data URL). This helper returns the same data-URL string so the rest of
 * each function (decode → upload to bucket) stays identical.
 *
 * - Text-to-image  → POST /v1/images/generations
 * - Image edit/ref → POST /v1/images/edits  (multipart, used when ref images
 *                                            are supplied so OpenAI keeps
 *                                            identity / styling like Gemini did)
 *
 * Errors propagate the underlying HTTP status so callers can keep the
 * existing 429/402 toast logic.
 */

const OPENAI_BASE = "https://api.openai.com/v1";

export interface OpenAIImageResult {
  ok: boolean;
  dataUrl?: string;          // "data:image/png;base64,..."
  status?: number;           // upstream HTTP status on failure
  error?: string;
}

interface OpenAIImageOpts {
  apiKey: string;
  prompt: string;
  /** Optional reference images as data URLs OR public http(s) URLs. */
  referenceImages?: string[];
  /** OpenAI image model id. Defaults to gpt-image-1. */
  model?: string;
  /** "1024x1024" | "1024x1536" | "1536x1024" | "auto". */
  size?: string;
  /** "low" | "medium" | "high" | "auto". */
  quality?: string;
}

export async function openaiGenerateImage(opts: OpenAIImageOpts): Promise<OpenAIImageResult> {
  const model = opts.model ?? "gpt-image-1";
  const size = opts.size ?? "1536x1024";
  const quality = opts.quality ?? "high";
  const refs = opts.referenceImages?.filter(Boolean) ?? [];

  try {
    if (refs.length === 0) {
      // Pure text-to-image
      const resp = await fetch(`${OPENAI_BASE}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
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

    // With references → use the edits endpoint (multipart). OpenAI accepts
    // up to N images; we send all refs as `image[]`.
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
      headers: { Authorization: `Bearer ${opts.apiKey}` },
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

/** Convert a data: URL or http(s) URL to a Blob suitable for FormData. */
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
