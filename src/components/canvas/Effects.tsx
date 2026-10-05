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

   Bloom     — the particles are additive points; bloom is what turns them
               from pixels into light. Threshold sits low because the whole
               palette is dark and nothing else in frame will trigger it.
   Chromatic — scales with scroll velocity only. At rest it is zero. This is
               the single cue that ties scroll speed to the image.
   Vignette  — pulls the frame edges into the void so DOM text has somewhere
               quiet to sit.
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
        intensity={1.15}
        luminanceThreshold={0.08}
        luminanceSmoothing={0.32}
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
      <Vignette offset={0.26} darkness={0.72} blendFunction={BlendFunction.NORMAL} />
    </EffectComposer>
  );
}
