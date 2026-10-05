import { NOISE_CHUNK } from './noise.glsl';

/* ============================================================================
   SIMULATION SHADERS

   Two ping-ponged float textures, 256×256 by default = 65,536 particles,
   the whole field advanced in two fullscreen fragment passes per frame.
   The CPU never touches a particle position — it only writes uniforms.
   ========================================================================= */

/* --- VELOCITY PASS ------------------------------------------------------
   Integrates three forces:
     1. a spring toward the interpolated morph target,
     2. curl-noise turbulence (divergence-free, so the cloud never clumps),
     3. a pointer repulsion well that punches a hole in the field.
   ---------------------------------------------------------------------- */
export const VELOCITY_SHADER = /* glsl */ `
uniform float uTime;
uniform float uDelta;

uniform sampler2D uTargetA;
uniform sampler2D uTargetB;
uniform float uMix;

uniform float uStiffness;
uniform float uDamping;
uniform float uTurbulence;
uniform float uNoiseScale;
uniform float uDispersion;

uniform vec3  uPointer;
uniform float uPointerRadius;
uniform float uPointerStrength;

${NOISE_CHUNK}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos  = posData.xyz;
  vec3 vel  = velData.xyz;
  float seed = posData.w;

  vec3 target = mix(
    texture2D(uTargetA, uv).xyz,
    texture2D(uTargetB, uv).xyz,
    uMix
  );

  // Per-particle eagerness staggers arrival so the cloud lands as a wave
  // instead of snapping into place all at once.
  float eagerness = 0.55 + seed * 0.90;

  vec3 acceleration = (target - pos) * uStiffness * eagerness;

  // Breathing turbulence. uDispersion is pushed up during transitions to
  // let the form scatter before it re-forms.
  vec3 curl = curlNoise(pos * uNoiseScale + vec3(0.0, uTime * 0.08, 0.0));
  acceleration += curl * (uTurbulence + uDispersion * 2.4);

  // Pointer well — quadratic falloff reads as a soft magnetic push.
  vec3 toPointer = pos - uPointer;
  float d = length(toPointer);
  float influence = 1.0 - smoothstep(0.0, uPointerRadius, d);
  acceleration += normalize(toPointer + vec3(1e-4)) * influence * influence * uPointerStrength;

  vel += acceleration * uDelta;
  vel *= uDamping;

  gl_FragColor = vec4(vel, velData.w);
}
`;

/* --- POSITION PASS ------------------------------------------------------
   Plain Euler integration. Deliberately trivial: all of the character lives
   in the velocity pass, which keeps this one cheap and stable.
   ---------------------------------------------------------------------- */
export const POSITION_SHADER = /* glsl */ `
uniform float uDelta;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz + velData.xyz * uDelta;

  gl_FragColor = vec4(pos, posData.w);
}
`;

/* ============================================================================
   RENDER SHADERS

   One draw call for the entire field. The vertex shader has no incoming
   position attribute worth speaking of — it reads each particle's position
   out of the simulation texture using a per-vertex UV reference.
   ========================================================================= */

export const POINTS_VERTEX = /* glsl */ `
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform float uSize;
uniform float uTime;
uniform float uPixelRatio;
uniform float uReveal;
uniform float uMaxSize;
uniform float uNearFade;

attribute vec2  aRef;
attribute float aSeed;
attribute float aScale;

varying float vSeed;
varying float vDepth;
varying float vSpeed;
varying float vNear;

void main() {
  vec3 pos = texture2D(uPositions, aRef).xyz;
  float speed = length(texture2D(uVelocities, aRef).xyz);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float dist = max(-mvPosition.z, 0.001);

  vSeed  = aSeed;
  vDepth = dist;
  vSpeed = speed;

  // Slow asynchronous twinkle. Frozen particulate catching a low sun.
  float twinkle = 0.72 + 0.28 * sin(uTime * 1.4 + aSeed * 42.0);

  // Fast particles stretch slightly brighter and larger — motion made visible.
  float energy = 1.0 + clamp(speed * 1.6, 0.0, 1.2);

  // Particles that drift close to the near plane would otherwise blow up
  // into screen-filling discs. Clamp the size and fade them out instead, so
  // they read as passing out of frame rather than as artefacts.
  vNear = smoothstep(0.0, uNearFade, dist);

  float size = uSize * aScale * twinkle * energy * uReveal * uPixelRatio * (10.0 / dist);
  gl_PointSize = min(size, uMaxSize * uPixelRatio);
}
`;

export const POINTS_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uColorCore;
uniform vec3  uColorEdge;
uniform vec3  uColorHot;
uniform float uOpacity;
uniform float uFogNear;
uniform float uFogFar;

varying float vSeed;
varying float vDepth;
varying float vSpeed;
varying float vNear;

void main() {
  // Round the point sprite and build a soft radial falloff.
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c);
  if (d2 > 0.25) discard;

  float alpha = smoothstep(0.25, 0.0, d2);
  alpha = pow(alpha, 1.7);

  vec3 color = mix(uColorEdge, uColorCore, alpha);
  color = mix(color, uColorHot, clamp(vSpeed * 1.9, 0.0, 1.0));

  // Depth fog folds the far field into the void instead of ending abruptly.
  float fog = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);

  gl_FragColor = vec4(color, alpha * uOpacity * fog * vNear);
}
`;
