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

  // One NaN bead is enough to black out a block of the screen: bloom's
  // mip chain spreads it across the coarsest levels. Recover, don't carry it.
  if (any(isnan(vel)) || any(isinf(vel))) vel = vec3(0.0);

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

  // See the velocity pass: a poisoned bead restarts at the centre and
  // springs back to its formation.
  if (any(isnan(pos)) || any(isinf(pos))) pos = vec3(0.0);

  gl_FragColor = vec4(pos, posData.w);
}
`;

/* ============================================================================
   RENDER SHADERS

   One draw call for the entire field. The vertex shader has no incoming
   position attribute worth speaking of — it reads each particle's position
   out of the simulation texture using a per-vertex UV reference.
   ========================================================================= */

/* --- Render pass ---------------------------------------------------------
   Every particle is a lit bead of rime, not a point of light. The field sits
   in a pale chamber, so it has to read by value against the fog rather than
   by glowing on black: each sprite is shaded as a sphere under the chamber's
   overhead key, and distance folds it into the fog colour instead of fading
   its alpha. Beads are opaque and write depth, so they occlude each other
   correctly without sorting.

   Opacity is spent as DENSITY: a chapter at 0.3 keeps 30% of the beads, each
   fully solid. Translucent beads read as smudges; fewer solid ones read as a
   thinner cloud.
   ------------------------------------------------------------------------- */

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
varying float vHeight;

void main() {
  vec3 pos = texture2D(uPositions, aRef).xyz;
  vHeight = (modelMatrix * vec4(pos, 1.0)).y;
  float speed = length(texture2D(uVelocities, aRef).xyz);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float dist = max(-mvPosition.z, 0.001);

  vSeed  = aSeed;
  vDepth = dist;
  vSpeed = speed;

  // Beads drifting at the near plane are dropped, not blown up.
  vNear = smoothstep(0.0, uNearFade, dist);

  // Fast beads swell slightly: motion made visible without a glow.
  float energy = 1.0 + clamp(speed * 0.8, 0.0, 0.5);

  float size = uSize * aScale * energy * uReveal * uPixelRatio * (10.0 / dist);
  gl_PointSize = min(size, uMaxSize * uPixelRatio);
}
`;

export const POINTS_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uColorLit;
uniform vec3  uColorShade;
uniform vec3  uColorHot;
uniform vec3  uFogColor;
uniform float uOpacity;
uniform float uFogNear;
uniform float uFogFar;

varying float vSeed;
varying float vDepth;
varying float vSpeed;
varying float vNear;
varying float vHeight;

void main() {
  // Density, not translucency — see the block comment above.
  if (vSeed > uOpacity) discard;
  if (vNear < fract(vSeed * 7.13)) discard;

  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;

  vec3 n = vec3(c, sqrt(1.0 - r2));
  vec3 L = normalize(vec3(-0.35, 0.8, 0.5));
  float diffuse = max(dot(n, L), 0.0) * 0.88 + 0.12;
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);

  vec3 color = mix(uColorShade, uColorLit, diffuse) + spec * 0.22;

  // Overhead light: the chamber is lit from above, so the top of any
  // formation is brighter than its underside.
  color *= mix(0.78, 1.06, smoothstep(-3.0, 3.0, vHeight));

  // Beads in fast motion catch a frost sheen: lighter, never a new hue.
  color = mix(color, uColorHot, clamp(vSpeed * 0.9, 0.0, 0.4));

  // Atmospheric perspective: far beads dissolve into the chamber's fog.
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  color = mix(color, uFogColor, fog * 0.75);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
