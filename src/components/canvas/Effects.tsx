'use client';

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

/* ============================================================================
   POST

   Two passes, each doing exactly one job:

   Bloom     — only the light sources bloom: the horizon strip, facet
               glints, the stage rings. The threshold sits high because
               the whole chamber is pale; anything lower turns the fog into
               a white-out.
   Vignette  — a light hand: the chamber's corners settle a shade toward
               slate, so the lit centre reads as the room's light source.

   There is deliberately no chromatic aberration: on scroll it split the grey
   beads into blue and red fringes, a hue the monochrome world doesn't have.
   ========================================================================= */

export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.86}
        luminanceSmoothing={0.18}
        mipmapBlur
        radius={0.72}
      />
      <Vignette offset={0.32} darkness={0.3} blendFunction={BlendFunction.NORMAL} />
    </EffectComposer>
  );
}
