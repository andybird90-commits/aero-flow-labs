/**
 * part-fidelity.ts
 *
 * Pure browser-side pixel comparison between two part images:
 *   - the source crop the user wanted (e.g. an isolated arch from the concept)
 *   - the AI-redrawn clay render that came back from Gemini
 *
 * Goal: catch cases where the render silently dropped/simplified geometry
 * (e.g. the rear arch fairing missing, narrowed skirt, wrong proportions)
 * before the user spends credits on a 3D mesh.
 *
 * No deps beyond browser canvas. Operates on ImageData.
 *
 * Final score is a 0-100 weighted sum:
 *   silhouette IoU      50%
 *   outline coverage    30%
 *   aspect & extent     20%
 *
 * Thresholds: ≥75 match, 50-74 drift, <50 mismatch.
 */

export interface FidelityBreakdown {
  silhouette: number;   // 0..1   — IoU of the two binary part masks
  edges: number;        // 0..1   — fraction of source edge pixels matched in render
  aspect: number;       // 0..1   — bbox aspect & area similarity
  notes: string[];      // human-readable diagnostics
}

export interface FidelityResult {
  score: number;        // 0..100
  status: "match" | "drift" | "mismatch";
  breakdown: FidelityBreakdown;
}

const WORK_SIZE = 256; // tradeoff: speed vs detail. 256 is plenty for silhouette + edge tests.

/* ---------- helpers ---------- */

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${String(e)}`));
    img.src = url;
  });
}

function toCanvas(img: HTMLImageElement, size: number): ImageData {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  // Fit-contain on white so the surrounding region is "background", not part.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const ratio = Math.min(size / img.width, size / img.height);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const x = Math.floor((size - w) / 2);
  const y = Math.floor((size - h) / 2);
  ctx.drawImage(img, x, y, w, h);
  return ctx.getImageData(0, 0, size, size);
}

/** Convert RGBA → grayscale Uint8 (luma). */
function toGray(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}

/** Otsu's threshold. */
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, max = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

/**
 * Build a binary part mask. Convention: 1 = part, 0 = background.
 *
 * We assume the "part" is the darker-or-saturated foreground on a lighter
 * studio backdrop. Otsu gives us a threshold; whichever side has more
 * variance / saturation wins as foreground. Fallback heuristic: the side
 * with fewer pixels is the foreground (parts usually take <50% of the frame).
 */
export function otsuMask(img: ImageData): Uint8Array {
  const gray = toGray(img);
  const th = otsuThreshold(gray);
  const below = new Uint8Array(gray.length);
  let belowCount = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < th) { below[i] = 1; belowCount++; }
  }
  // If "below threshold" covers more than half the frame, it's likely the
  // background (e.g. the studio is darker than the part). Invert.
  if (belowCount > gray.length / 2) {
    for (let i = 0; i < below.length; i++) below[i] = below[i] ? 0 : 1;
  }
  return below;
}

/** Intersection-over-union of two binary masks (same length). */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i];
    if (av || bv) uni++;
    if (av && bv) inter++;
  }
  if (!uni) return 0;
  return inter / uni;
}

/** Sobel edge magnitude → binary edge map (1 if magnitude > thresh). */
export function sobelEdges(gray: Uint8Array, w: number, h: number, threshFrac = 0.18): Uint8Array {
  const mag = new Float32Array(gray.length);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
         gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
         gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  const th = maxMag * threshFrac;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < mag.length; i++) if (mag[i] > th) out[i] = 1;
  return out;
}

/**
 * Coverage: of all "edge" pixels in A, what fraction have an edge in B
 * within `radius` pixels (Chebyshev). Asymmetric: measures how much of A
 * is preserved in B. We average A→B and B→A for symmetry.
 */
export function edgeCoverage(a: Uint8Array, b: Uint8Array, w: number, h: number, radius = 3): number {
  const oneWay = (src: Uint8Array, dst: Uint8Array): number => {
    let total = 0, hit = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!src[i]) continue;
        total++;
        // Search neighbourhood
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
        let found = false;
        for (let yy = y0; yy <= y1 && !found; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (dst[yy * w + xx]) { found = true; break; }
          }
        }
        if (found) hit++;
      }
    }
    return total ? hit / total : 0;
  };
  const ab = oneWay(a, b);
  const ba = oneWay(b, a);
  return (ab + ba) / 2;
}

interface BBoxStats {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  area: number;
  aspect: number; // width/height
}

function maskStats(mask: Uint8Array, w: number, h: number): BBoxStats {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        area++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, area: 0, aspect: 1 };
  const bw = Math.max(1, x1 - x0 + 1);
  const bh = Math.max(1, y1 - y0 + 1);
  return { bbox: { x0, y0, x1, y1 }, area, aspect: bw / bh };
}

/* ---------- main entry ---------- */

export async function scoreFidelity(sourceUrl: string, renderUrl: string): Promise<FidelityResult> {
  const [srcImg, rndImg] = await Promise.all([loadImage(sourceUrl), loadImage(renderUrl)]);
  const srcData = toCanvas(srcImg, WORK_SIZE);
  const rndData = toCanvas(rndImg, WORK_SIZE);

  // Otsu, then take ONLY the largest connected component on each side.
  // The source crop often contains neighbouring parts (vents, lip etc.) that
  // the renderer is now explicitly told to ignore; comparing whole masks
  // would produce a false MISMATCH when the render is correctly single-part.
  const srcMaskRaw = otsuMask(srcData);
  const rndMaskRaw = otsuMask(rndData);
  const srcMask = largestComponent(srcMaskRaw, WORK_SIZE, WORK_SIZE);
  const rndMask = largestComponent(rndMaskRaw, WORK_SIZE, WORK_SIZE);

  // 1) Silhouette IoU — re-centre+rescale both masks to their own bbox so
  // we don't penalise the AI for putting the part dead-centre when the
  // source crop had it offset.
  const srcStats = maskStats(srcMask, WORK_SIZE, WORK_SIZE);
  const rndStats = maskStats(rndMask, WORK_SIZE, WORK_SIZE);
  const srcNorm = normaliseMask(srcMask, WORK_SIZE, srcStats.bbox);
  const rndNorm = normaliseMask(rndMask, WORK_SIZE, rndStats.bbox);
  const silhouette = maskIoU(srcNorm, rndNorm);

  // 2) Outline coverage — Sobel on grayscale, restricted to the part bbox
  // by zeroing edges outside the (largest-component) mask so neighbours and
  // background noise don't dominate.
  const srcGray = toGray(srcData);
  const rndGray = toGray(rndData);
  const srcEdges = maskedEdges(srcGray, srcMask, WORK_SIZE, WORK_SIZE);
  const rndEdges = maskedEdges(rndGray, rndMask, WORK_SIZE, WORK_SIZE);
  const edges = edgeCoverage(srcEdges, rndEdges, WORK_SIZE, WORK_SIZE, 4);

  // 3) Aspect & extent — how close are the bbox proportions and pixel area?
  const aspectRatio = Math.min(srcStats.aspect, rndStats.aspect) /
                      Math.max(srcStats.aspect, rndStats.aspect || 1);
  const areaRatio = srcStats.area && rndStats.area
    ? Math.min(srcStats.area, rndStats.area) / Math.max(srcStats.area, rndStats.area)
    : 0;
  const aspect = (aspectRatio * 0.5) + (areaRatio * 0.5);

  // Diagnostics — only the most relevant 1-2 notes.
  const notes: string[] = [];
  if (silhouette < 0.5) notes.push(`silhouette overlap only ${Math.round(silhouette * 100)}%`);
  if (edges < 0.45) notes.push(`outline coverage ${Math.round(edges * 100)}% — features may be missing`);
  if (aspectRatio < 0.78) {
    const dir = rndStats.aspect > srcStats.aspect ? "wider" : "narrower";
    notes.push(`render is ${Math.round((1 - aspectRatio) * 100)}% ${dir} than source`);
  }
  if (areaRatio && areaRatio < 0.6) {
    const dir = rndStats.area > srcStats.area ? "larger" : "smaller";
    notes.push(`render covers ${Math.round((1 - areaRatio) * 100)}% ${dir} area`);
  }
  if (!notes.length) notes.push("close geometric match");

  const score01 = silhouette * 0.5 + edges * 0.3 + aspect * 0.2;
  const score = Math.max(0, Math.min(100, Math.round(score01 * 100)));
  const status: FidelityResult["status"] =
    score >= 75 ? "match" : score >= 50 ? "drift" : "mismatch";

  return {
    score,
    status,
    breakdown: { silhouette, edges, aspect, notes },
  };
}

/** Resample a mask so its bbox fills the working frame. Returns a new mask
 *  of the same dimensions. Nearest-neighbour — fine for binary masks. */
function normaliseMask(
  mask: Uint8Array,
  size: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): Uint8Array {
  const bw = Math.max(1, bbox.x1 - bbox.x0 + 1);
  const bh = Math.max(1, bbox.y1 - bbox.y0 + 1);
  if (bw === size && bh === size && bbox.x0 === 0 && bbox.y0 === 0) return mask;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = bbox.y0 + Math.floor((y / size) * bh);
    for (let x = 0; x < size; x++) {
      const sx = bbox.x0 + Math.floor((x / size) * bw);
      if (mask[sy * size + sx]) out[y * size + x] = 1;
    }
  }
  return out;
}

/** Sobel restricted to within (or 1px around) the part mask, so background
 *  noise doesn't inflate edge counts. */
function maskedEdges(gray: Uint8Array, mask: Uint8Array, w: number, h: number): Uint8Array {
  const edges = sobelEdges(gray, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edges[i]) continue;
      // Keep edge if any of the 3x3 neighbourhood is masked-in.
      let near = false;
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      for (let yy = y0; yy <= y1 && !near; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (mask[yy * w + xx]) { near = true; break; }
        }
      }
      if (!near) edges[i] = 0;
    }
  }
  return edges;
}
