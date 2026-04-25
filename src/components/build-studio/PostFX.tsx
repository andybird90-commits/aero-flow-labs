/**
 * PostFX — postprocessing pipeline for the Build Studio viewport.
 *
 * Stack (when enabled by quality settings):
 *   1. SSAO         — contact-crevice darkening for fitted assemblies
 *   2. Bloom        — highlight bleed on paint + HDRI reflections
 *   3. Outline      — orange edge glow on the selected/hovered object
 *   4. Vignette     — subtle edge darkening (cinematic framing)
 *   5. SMAA         — anti-aliasing
 *
 * Tone mapping is set on the renderer itself (ACES Filmic) for cinematic
 * mode — it's not a postprocessing pass but a renderer-level setting.
 *
 * NOTE: We render only the effects that are turned on, in a stable order.
 * EffectComposer is recreated whenever the effect set changes, which is
 * fine — quality changes are user-initiated and rare.
 */
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  EffectComposer,
  SSAO,
  Bloom,
  Outline,
  Vignette,
  SMAA,
} from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";
import type { QualitySettings } from "@/lib/build-studio/render-quality";

interface Props {
  settings: QualitySettings;
  /** Objects to outline (selected part + shell when in shell-fit mode). */
  outlineTargets?: THREE.Object3D[];
}

export function PostFX({ settings, outlineTargets = [] }: Props) {
  const { gl } = useThree();

  // Apply tone mapping at the renderer level when in cinematic modes.
  useEffect(() => {
    const prevMapping = gl.toneMapping;
    const prevExposure = gl.toneMappingExposure;
    if (settings.cinematic) {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
    } else {
      gl.toneMapping = THREE.NoToneMapping;
      gl.toneMappingExposure = 1.0;
    }
    return () => {
      gl.toneMapping = prevMapping;
      gl.toneMappingExposure = prevExposure;
    };
  }, [settings.cinematic, gl]);

  // Stable identity for effect set so EffectComposer remounts when needed.
  const effectKey = useMemo(
    () =>
      [
        settings.ssao ? "ssao" : "",
        settings.bloom ? "bloom" : "",
        settings.outline ? "outline" : "",
        settings.cinematic ? "vig" : "",
        settings.smaa ? "smaa" : "",
      ]
        .filter(Boolean)
        .join("|"),
    [settings.ssao, settings.bloom, settings.outline, settings.cinematic, settings.smaa],
  );

  // If nothing's enabled, render nothing — saves the EffectComposer overhead entirely.
  const anyEffect =
    settings.ssao || settings.bloom || settings.outline || settings.cinematic || settings.smaa;
  if (!anyEffect) return null;

  return (
    <EffectComposer
      key={effectKey}
      multisampling={settings.smaa ? 0 : 4}
      enableNormalPass={settings.ssao}
    >
      {settings.ssao ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={20}
          radius={0.07}
          intensity={28}
          luminanceInfluence={0.5}
          worldDistanceThreshold={1.5}
          worldDistanceFalloff={0.4}
          worldProximityThreshold={0.4}
          worldProximityFalloff={0.1}
        />
      ) : (
        <></>
      )}

      {settings.bloom ? (
        <Bloom
          intensity={0.55}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.2}
          mipmapBlur
          kernelSize={KernelSize.LARGE}
        />
      ) : (
        <></>
      )}

      {settings.outline && outlineTargets.length > 0 ? (
        <Outline
          selection={outlineTargets}
          edgeStrength={6}
          pulseSpeed={0}
          visibleEdgeColor={0xfb923c}
          hiddenEdgeColor={0x7c2d12}
          blur
          xRay
        />
      ) : (
        <></>
      )}

      {settings.cinematic ? (
        <Vignette eskil={false} offset={0.18} darkness={0.55} />
      ) : (
        <></>
      )}

      {settings.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  );
}
