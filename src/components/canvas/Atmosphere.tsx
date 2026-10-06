'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { scrollState, damp } from '@/lib/scrollState';

/* ============================================================================
   ATMOSPHERE

   The chamber the whole site happens in: cold fog lit from overhead,
   brightest just under the ceiling, a white horizon band where the light
   pools, then a slate floor falling away below it. Slow mist drifts through
   the volume and a faint grain keeps the long gradients from banding.

   One plane far behind everything with depth writes off: a single
   fullscreen fragment pass that never interacts with what sits in front.

   Doing this in WebGL rather than as a CSS gradient matters: the mist and
   grain have to share a colour space with the beads, or the seam between
   DOM background and canvas shows.
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
uniform vec3  uHaze;
uniform vec3  uFog;
uniform vec3  uFloor;
uniform vec3  uFloorDeep;
uniform vec3  uGlint;
uniform vec2  uPointer;
uniform float uStage;
uniform vec3  uRoom;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 uv = vUv;

  // The horizon drifts very slightly against the pointer: parallax, not tilt.
  /* Placed so the horizon lands about a fifth of the way up the frame at
     the usual camera depths, leaving a visible floor under it. */
  float horizon = 0.37 + uPointer.y * 0.012;
  float y = uv.y - horizon;

  /* Above the horizon: haze under the ceiling settling into mid fog. */
  vec3 sky = mix(uFog, uHaze, smoothstep(0.0, 0.62, y));

  /* Below it: the slate floor, darkening toward the viewer. */
  vec3 floorCol = mix(uFloor, uFloorDeep, smoothstep(0.0, -0.12, y));
  vec3 color = y > 0.0 ? sky : mix(uFog, floorCol, smoothstep(0.0, -0.035, y));

  /* The light pooling on the horizon line. Wide soft band plus a tight core. */
  float band = exp(-abs(y) * 26.0);
  float core = exp(-abs(y) * 140.0);
  float spread = 1.0 - smoothstep(0.0, 0.62, abs(uv.x - 0.5 - uPointer.x * 0.02));
  color = mix(color, uGlint, band * 0.34 * (0.55 + 0.45 * spread) + core * 0.5 * spread);

  /* Overhead light: a broad bloom near the top edge of the chamber. */
  float overhead = exp(-pow((1.0 - uv.y) * 3.2, 2.0)) * (1.0 - smoothstep(0.0, 0.55, abs(uv.x - 0.5)));
  color = mix(color, uGlint, overhead * 0.42);

  /* Mist: two octaves of value noise drifting sideways, strongest at
     horizon height where real fog lies. */
  vec2 m = vec2(uv.x * 3.2 + uTime * 0.018, uv.y * 5.0);
  float mist = vnoise(m) * 0.65 + vnoise(m * 2.3 - uTime * 0.03) * 0.35;
  float mistMask = exp(-abs(y - 0.06) * 6.0);
  color = mix(color, uHaze, (mist - 0.4) * 0.22 * mistMask);

  /* Deeper into the archive the chamber cools a touch, then lifts again
     as the visitor surfaces. */
  float depth = sin(clamp(uProgress, 0.0, 1.0) * 3.14159);
  color = mix(color, color * vec3(0.93, 0.95, 0.99), depth * 0.5);

  /* The socials stage is a dimmer room: mid-tone grey-blue, as in the
     reference, so beads flaring white against it actually read. */
  color = mix(color, uRoom * (0.82 + 0.3 * (color - uFog)), uStage * 0.85);

  float grain = hash(uv * 1400.0 + fract(uTime) * 100.0);
  color += (grain - 0.5) * 0.012;

  // Never below zero: the sRGB encode is a pow(), and pow of a negative is
  // NaN on Metal — which bloom then smears into a black block.
  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;

/** Reads a colour token from :root so the canvas and the DOM agree. */
export function cssColor(name: string, fallback: string) {
  if (typeof document === 'undefined') return new THREE.Color(fallback);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export function Atmosphere() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const progressRef = useRef(0);
  const stageRef = useRef(0);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uHaze: { value: cssColor('--c-fog-hi', '#eceff3') },
      uFog: { value: cssColor('--c-ground', '#dde1e7') },
      uFloor: { value: cssColor('--c-floor', '#8e97a5') },
      uFloorDeep: { value: cssColor('--c-floor-deep', '#5d6676') },
      uGlint: { value: cssColor('--c-glint', '#ffffff') },
      uStage: { value: 0 },
      uRoom: { value: cssColor('--c-room', '#9ea8b6') },
      uPointer: { value: new THREE.Vector2(0, 0) },
    }),
    [],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const material = materialRef.current;
    if (!material) return;

    /* Write to the LIVE material's uniforms. The <shaderMaterial uniforms>
       prop is copied into the material on creation, so mutating the memo'd
       object below does nothing — this loop silently updated a dead copy,
       freezing the mist, pointer parallax and depth cooling, until the
       stage dimming exposed it. */
    const u = material.uniforms;
    progressRef.current = damp(progressRef.current, scrollState.smooth, 2.4, dt);
    stageRef.current = damp(stageRef.current, scrollState.stage, 2.5, dt);

    u.uTime.value = state.clock.elapsedTime;
    u.uProgress.value = progressRef.current;
    u.uPointer.value.set(scrollState.pointerSmooth.x, scrollState.pointerSmooth.y);
    u.uStage.value = stageRef.current;
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
