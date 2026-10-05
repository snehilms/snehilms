'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { scrollState, damp } from '@/lib/scrollState';

/* ============================================================================
   ATMOSPHERE

   The ground the particles sit in: a deep radial gradient with slow aurora
   banding and film grain. Rendered as a single plane far behind the field
   with depth writes off, so it costs one fullscreen fragment pass and never
   interacts with anything in front of it.

   Doing this in WebGL rather than as a CSS gradient matters — the grain and
   the aurora drift have to share a colour space with the particles, or the
   seam between DOM background and canvas becomes visible on OLED panels.
   ========================================================================= */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform vec3  uVoid;
uniform vec3  uAbyss;
uniform vec3  uShelf;
uniform vec3  uIce;
uniform vec2  uPointer;

varying vec2 vUv;

// Cheap value noise — grain only, no need for simplex here.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;

  // Gradient centre drifts toward the pointer, very slightly.
  vec2 centre = vec2(0.5) + uPointer * 0.06;
  float d = distance(uv, centre);

  // Two-stop radial ground: lit core falling off into void.
  vec3 color = mix(uAbyss, uVoid, smoothstep(0.08, 0.72, d));

  // Cold light pooling at the centre, breathing with scroll depth.
  float pool = 1.0 - smoothstep(0.0, 0.46, d);
  color += uShelf * pool * (0.22 + 0.10 * sin(uTime * 0.28));

  // Aurora bands — low-frequency, almost subliminal, drifting upward.
  float band = sin(uv.y * 5.2 - uTime * 0.16 + uv.x * 1.8) * 0.5 + 0.5;
  band *= sin(uv.y * 2.1 + uTime * 0.09) * 0.5 + 0.5;
  float auroraMask = smoothstep(0.35, 1.0, band) * (1.0 - smoothstep(0.1, 0.85, d));
  color += uIce * auroraMask * 0.045;

  // Deeper into the archive, the ground cools and darkens.
  color = mix(color, uVoid, uProgress * 0.30);

  // Grain, scaled to the darkest tones only — kills gradient banding.
  float grain = hash(uv * 1400.0 + fract(uTime) * 100.0);
  color += (grain - 0.5) * 0.016;

  gl_FragColor = vec4(color, 1.0);
}
`;

export function Atmosphere() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const progressRef = useRef(0);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uVoid: { value: new THREE.Color('#05070f') },
      uAbyss: { value: new THREE.Color('#0a1222') },
      uShelf: { value: new THREE.Color('#101b30') },
      uIce: { value: new THREE.Color('#7fd4ff') },
      uPointer: { value: new THREE.Vector2(0, 0) },
    }),
    [],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    if (!materialRef.current) return;

    progressRef.current = damp(progressRef.current, scrollState.smooth, 2.4, dt);

    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uProgress.value = progressRef.current;
    uniforms.uPointer.value.set(scrollState.pointerSmooth.x, scrollState.pointerSmooth.y);
  });

  return (
    <mesh position={[0, 0, -14]} renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[70, 44]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}
