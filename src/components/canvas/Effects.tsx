'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import type { ChromaticAberrationEffect } from 'postprocessing';
import { scrollState } from '@/lib/scrollState';

/* ============================================================================
   POST

   Three passes, each doing exactly one job:

   Bloom     — only the light sources bloom: the horizon strip, facet
               glints, the stage rings. The threshold sits high because
               the whole chamber is pale; anything lower turns the fog into
               a white-out.
   Chromatic — scales with scroll velocity only. At rest it is zero. This is
               the single cue that ties scroll speed to the image.
   Vignette  — a light hand: the chamber's corners settle a shade toward
               slate, so the lit centre reads as the room's light source.
   ========================================================================= */

const MAX_ABERRATION = 0.0022;

export function Effects() {
  const chromaRef = useRef<ChromaticAberrationEffect>(null);
  const offset = useRef(new THREE.Vector2(0, 0));
  const current = useRef(0);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const target = Math.abs(scrollState.velocity);

    // Asymmetric response: ramps up fast, falls away slowly.
    const rate = target > current.current ? 10 : 3.4;
    current.current += (target - current.current) * (1 - Math.exp(-rate * dt));

    if (chromaRef.current) {
      offset.current.set(current.current * MAX_ABERRATION, current.current * MAX_ABERRATION * 0.55);
      chromaRef.current.offset = offset.current;
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.86}
        luminanceSmoothing={0.18}
        mipmapBlur
        radius={0.72}
      />
      <ChromaticAberration
        ref={chromaRef}
        blendFunction={BlendFunction.NORMAL}
        offset={offset.current}
        radialModulation={false}
        modulationOffset={0}
      />
      <Vignette offset={0.32} darkness={0.3} blendFunction={BlendFunction.NORMAL} />
    </EffectComposer>
  );
}
