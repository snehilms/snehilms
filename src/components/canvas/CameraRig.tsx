'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { scrollState, damp } from '@/lib/scrollState';

/* ============================================================================
   CAMERA RIG

   The camera never cuts. It dollies continuously through the whole journey
   and drifts with the pointer — that unbroken motion is what makes the
   distinct chapters read as one descent rather than separate slides.
   ========================================================================= */

/* Depth at each chapter boundary. Pulling in for the career glyphs (01) and the
   archive lattice (02), easing back for the strata (03). */
const DOLLY = [9.4, 7.6, 8.2, 8.6];

/** `t` is in chapter units (0 → chapters-1), not page progress. */
function sampleDolly(t: number) {
  const segments = DOLLY.length - 1;
  const scaled = Math.min(Math.max(t, 0), segments);
  const i = Math.min(Math.floor(scaled), segments - 1);
  const f = scaled - i;
  const eased = f * f * (3 - 2 * f);
  return DOLLY[i] + (DOLLY[i + 1] - DOLLY[i]) * eased;
}

export function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const parallax = useRef({ x: 0, y: 0 });

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);

    const targetZ = sampleDolly(scrollState.chapterSmooth);
    camera.position.z = damp(camera.position.z, targetZ, 2.2, dt);

    if (!reducedMotion) {
      // Pointer parallax is intentionally tiny. Anything larger and the
      // morph targets stop reading as stable objects in space.
      parallax.current.x = damp(parallax.current.x, scrollState.pointerSmooth.x * 0.42, 2.0, dt);
      parallax.current.y = damp(parallax.current.y, scrollState.pointerSmooth.y * 0.28, 2.0, dt);

      camera.position.x = parallax.current.x;
      camera.position.y = parallax.current.y;
    }

    camera.lookAt(0, 0, 0);
  });

  return null;
}
