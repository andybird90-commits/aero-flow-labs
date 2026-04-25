/**
 * Render Quality presets for the Build Studio viewport.
 *
 * Tiers control which postprocessing effects run + which "showroom"
 * extras (reflective floor, accumulative shadows) are enabled. Persisted
 * in localStorage so a user's choice survives reloads on a per-device basis
 * (weak laptops want Draft, beefy desktops want Cinematic).
 */
import { useEffect, useState } from "react";

export type RenderQuality = "draft" | "studio" | "cinematic";

export interface QualitySettings {
  /** Screen-space ambient occlusion pass. */
  ssao: boolean;
  /** Bloom highlight bleed. */
  bloom: boolean;
  /** Selection edge outline. */
  outline: boolean;
  /** Vignette + tone mapping. */
  cinematic: boolean;
  /** Reflective floor (replaces ContactShadows when on). */
  reflectorFloor: boolean;
  /** Soft progressive shadows under car. */
  accumulativeShadows: boolean;
  /** Use SMAA anti-aliasing pass. */
  smaa: boolean;
}

export const QUALITY_PRESETS: Record<RenderQuality, QualitySettings> = {
  draft: {
    ssao: false,
    bloom: false,
    outline: true,
    cinematic: false,
    reflectorFloor: false,
    accumulativeShadows: false,
    smaa: false,
  },
  studio: {
    ssao: true,
    bloom: true,
    outline: true,
    cinematic: true,
    reflectorFloor: true,
    accumulativeShadows: false,
    smaa: true,
  },
  cinematic: {
    ssao: true,
    bloom: true,
    outline: true,
    cinematic: true,
    reflectorFloor: true,
    accumulativeShadows: true,
    smaa: true,
  },
};

export const QUALITY_LABEL: Record<RenderQuality, string> = {
  draft: "Draft",
  studio: "Studio",
  cinematic: "Cinematic",
};

export const QUALITY_DESCRIPTION: Record<RenderQuality, string> = {
  draft: "Fastest. No effects.",
  studio: "Balanced. SSAO + bloom + reflective floor.",
  cinematic: "Maximum. Adds soft baked shadows.",
};

const STORAGE_KEY = "apex.build-studio.render-quality";

function readStored(): RenderQuality {
  if (typeof window === "undefined") return "studio";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "draft" || v === "studio" || v === "cinematic") return v;
  return "studio";
}

export function useRenderQuality() {
  const [quality, setQualityState] = useState<RenderQuality>(() => readStored());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, quality);
    } catch {
      // ignore quota / privacy errors
    }
  }, [quality]);

  return {
    quality,
    setQuality: setQualityState,
    settings: QUALITY_PRESETS[quality],
  };
}
