'use client';

import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { createPortal, useFrame } from '@react-three/fiber';

/* ============================================================================
   ICE OVERLAY

   The crystals are finished pictures: path traced and tone mapped in Blender.
   Through the page's post stack they came out washed flat, because bloom on
   a page that is almost all pale fog lays a bright haze over anything dark
   (a black test plate measured 168/255 on screen). So the gallery lives in
   its own scene, drawn straight to the screen after the composer has
   finished, and reaches the screen with the colours Cycles produced.

   Priority 2 runs after the EffectComposer's own priority-1 render. Without
   post (low tier) nothing else renders the main scene once a priority frame
   callback exists, so this pass renders it first.

   Nothing in front of the gallery needs to occlude it: in the Projects
   chapter the bead formation sits behind the slots.
   ========================================================================= */

export function IceOverlay({ children, renderMain }: { children: ReactNode; renderMain: boolean }) {
  const scene = useMemo(() => new THREE.Scene(), []);

  useFrame(({ gl, scene: main, camera }) => {
    if (renderMain) gl.render(main, camera);
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(scene, camera);
    gl.autoClear = autoClear;
  }, 2);

  return <>{createPortal(children, scene)}</>;
}
