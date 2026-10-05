'use client';

import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Suspense } from 'react';

import { ParticleField } from './ParticleField';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './CameraRig';
import { CrystalGallery } from './crystals/CrystalGallery';
import { Effects } from './Effects';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import styles from './Scene.module.css';

/* ============================================================================
   SCENE

   One canvas, fixed to the viewport, mounted once and never unmounted for
   the lifetime of the page. DOM chapters scroll over it. This is the whole
   reason the experience reads as continuous: there is no point at which the
   WebGL context tears down and rebuilds between sections.

   pointer-events is off so every click, selection and focus ring belongs to
   the DOM layer above.
   ========================================================================= */

export function Scene() {
  const { simSize, dpr, postprocessing, reducedMotion } = useDeviceTier();

  return (
    <div className={styles.stage} aria-hidden="true">
      <Canvas
        dpr={dpr}
        gl={{
          antialias: false, // bloom + additive points; MSAA would be wasted cost
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        camera={{ fov: 45, near: 0.1, far: 120, position: [0, 0, 9.4] }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color('#05070f'), 1);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Suspense fallback={null}>
          {/* Only a loaded .glb core responds to these — every material
              written in this project is a ShaderMaterial and ignores lights. */}
          <ambientLight intensity={0.55} />
          <directionalLight position={[3.4, 5.4, 3.9]} intensity={2.1} />

          <Atmosphere />
          <ParticleField simSize={simSize} reducedMotion={reducedMotion} />
          <CrystalGallery />
          <CameraRig reducedMotion={reducedMotion} />
          {postprocessing && <Effects />}
        </Suspense>
      </Canvas>
    </div>
  );
}
