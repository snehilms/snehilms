import { NOISE_CHUNK } from './noise.glsl';
import { GLYPH_GLSL } from './careerGlyphs';

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

/* Up to three targets at once, weighted. The chapters only ever blend two,
   but the Experience chapter is a chain of its own inside chapter 1 (stream,
   pipeline, stream, book, stream, vault, stream), and at its edges that
   chain is itself blending while the chapter blends with its neighbour.

   KIND says how to read a slot: 0 a plain cloud, 1 the stream (procedural,
   no texture), 2 pipeline, 3 book, 4 vault. A glyph is posed (a 3/4 view,
   turning a little) and its moving parts are animated here, from the part
   tag and param in its attr texture. */
uniform sampler2D uTargetA;
uniform sampler2D uTargetB;
uniform sampler2D uTargetC;
uniform sampler2D uAttrA;
uniform sampler2D uAttrB;
uniform sampler2D uAttrC;
uniform vec3 uWeights;
uniform vec3 uKinds;
uniform mat3 uPosePipe;
uniform mat3 uPoseBook;
uniform mat3 uPoseVault;
uniform float uWheel;
uniform float uDoorOpen;
uniform vec3 uHover;       // the cursor on the glyph plane, field space
uniform float uHoverAmt;   // 0..1, how much the cursor is on a glyph
uniform float uBook;       // the order book's clock (integrated: it quickens)

uniform float uStiffness;
uniform float uDamping;
uniform float uTurbulence;
uniform float uNoiseScale;
uniform float uDispersion;

uniform vec3  uPointer;
uniform float uPointerRadius;
uniform float uPointerStrength;

${NOISE_CHUNK}
${GLYPH_GLSL}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* The stream: a bundle of seven fine strands, like fibre carrying data,
   pinched together at both ends and fanned a little apart in the middle,
   following one long, slow S-curve. Each strand ripples on its own phase.
   Beads keep their place along it; the ripples carry the eye along, so it
   reads as flowing without any bead ever wrapping round. A few loose beads
   drift around it as mist. Every motion here is slow on purpose: beads
   spring after their targets with different eagerness, so a fast-moving
   target smears a fine strand into a sheet. */
vec3 streamTarget(vec2 uv) {
  float h1 = hash12(uv * 391.7);
  float h2 = hash12(uv * 173.3 + 11.0);
  float h3 = hash12(uv * 257.1 + 23.0);
  float h4 = hash12(uv * 89.9 + 37.0);
  float x = (h1 - 0.5) * 5.6;
  float k = floor(h2 * 7.0) - 3.0;
  float env = smoothstep(0.0, 0.3, h1) * smoothstep(1.0, 0.7, h1);
  vec3 c = vec3(
    x,
    0.36 * sin(x * 0.62 - uTime * 0.09) + k * 0.13 * env + 0.035 * sin(x * 2.4 - uTime * 0.28 + k * 0.9) * env,
    k * 0.015 * env
  );
  float mist = step(0.97, h3);
  float radius = mix(0.007, 0.05 + 0.2 * h4, mist);
  float ang = h4 * 43.98 + h2 * 13.0;
  return c + vec3(0.0, cos(ang), sin(ang)) * radius * sqrt(fract(h3 * 7.0));
}

vec3 slotTarget(sampler2D tex, sampler2D attr, float kind, vec2 uv) {
  if (kind > 0.5 && kind < 1.5) return streamTarget(uv);
  vec3 p = texture2D(tex, uv).xyz;
  if (kind < 1.5) return p;
  vec4 a = texture2D(attr, uv);
  if (kind < 2.5) return uPosePipe * p;
  // Row-vector multiply: the transpose of a rotation is its inverse, so this
  // carries the cursor into the book's own frame.
  if (kind < 3.5) return uPoseBook * bookPoint(p, a.x, a.y, uBook, uHover * uPoseBook, uHoverAmt);
  // The wheel's turn is applied at draw time (POINTS_VERTEX), not here:
  // beads chasing a turning target lag by their eagerness and smear the
  // spokes into a disc.
  return uPoseVault * vaultPoint(p, a.x, 0.0, uDoorOpen);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos  = posData.xyz;
  vec3 vel  = velData.xyz;
  float seed = posData.w;

  vec3 target = slotTarget(uTargetA, uAttrA, uKinds.x, uv) * uWeights.x;
  if (uWeights.y > 0.0001) target += slotTarget(uTargetB, uAttrB, uKinds.y, uv) * uWeights.y;
  if (uWeights.z > 0.0001) target += slotTarget(uTargetC, uAttrC, uKinds.z, uv) * uWeights.z;

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

/* The Experience glyphs: the same slots, weights and poses the simulation
   uses, read here for each bead's surface normal (so a glyph is lit as a
   solid) and for its part, which decides its tint and its pulses of light. */
uniform sampler2D uAttrA;
uniform sampler2D uAttrB;
uniform sampler2D uAttrC;
uniform vec3 uWeights;
uniform vec3 uKinds;
uniform mat3 uPosePipe;
uniform mat3 uPoseBook;
uniform mat3 uPoseVault;
uniform float uWheel;
uniform float uDoorOpen;
uniform vec3 uHover;
uniform float uHoverAmt;
uniform float uBook;
uniform float uFlow;       // the pipeline's clock
uniform float uPay;        // the payouts' clock
uniform float uPacketX;

attribute vec2  aRef;
attribute float aSeed;
attribute float aScale;

varying float vSeed;
varying float vDepth;
varying float vSpeed;
varying float vNear;
varying float vHeight;
varying vec3  vObjNormal;
varying float vTint;
varying float vSignal;

${GLYPH_GLSL}

// A short comet of light: sharp head, soft tail behind it.
float comet(float x) {
  return smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.05, 0.24, x));
}

void glyphLook(sampler2D attr, float kind, float w, vec3 pos,
               inout vec3 nSum, inout float nW, inout float tint, inout float signal) {
  if (w < 0.001 || kind < 0.5) return;
  if (kind < 1.5) {
    // The stream carries one packet of signal along its length.
    float d = (pos.x - uPacketX) / 0.3;
    tint += w * exp(-d * d) * 0.9;
    return;
  }
  vec4 a = texture2D(attr, aRef);
  float tag = a.x;
  vec3 n = decodeNormal(a.zw);
  if (kind < 2.5) {
    n = uPosePipe * n;
    if (isTag(tag, TAG_PIPE_STREAM)) {
      tint += w * 0.9;
      signal += w * comet(fract(a.y * 2.0 - uFlow * 0.42));
    }
  } else if (kind < 3.5) {
    n = uPoseBook * n;
    vec3 hc = uHover * uPoseBook;
    if (isTag(tag, TAG_BOOK_BID)) tint += w * 0.85;
    if (isTag(tag, TAG_BOOK_ASK) || isTag(tag, TAG_BOOK_BID)) {
      // The level's own height, back in the book's frame.
      vec3 b = bookRow(tag, a.y, (pos * uPoseBook).y, uBook, hc, uHoverAmt);
      signal += w * (b.y * 0.9 + b.z * 0.55);
    }
    // A trade prints: the spread and the last-trade knot flash with it.
    if (isTag(tag, TAG_BOOK_SPREAD) || isTag(tag, TAG_BOOK_TRADE)) {
      float traded = max(bookRow(TAG_BOOK_ASK, 0.0, 0.0, uBook, hc, 0.0).y, bookRow(TAG_BOOK_BID, 0.0, 0.0, uBook, hc, 0.0).y);
      signal += w * traded;
      tint += w * 0.5;
    }
  } else {
    n = uPoseVault * vaultNormal(n, tag, uWheel, uDoorOpen);
    if (isTag(tag, TAG_VAULT_PAYOUT)) {
      tint += w * 0.85;
      signal += w * comet(fract(a.y * 1.6 - uPay * 0.38));
    }
  }
  // Light gathers under the cursor, on any glyph.
  float near = 1.0 - smoothstep(0.0, 0.55, length(pos.xy - uHover.xy));
  signal += w * uHoverAmt * near * 0.7;
  nSum += n * w;
  nW += w;
}

// The vault wheel turns here, at draw time, so its beads hold a still shape
// in the simulation and the spokes stay crisp at any speed: carry the bead
// back into the door's closed frame, turn it about the axle, and swing it
// back out with the door.
vec3 spinWheel(vec3 pos, sampler2D attr, float kind, float w) {
  if (w < 0.001 || kind < 3.5) return pos;
  vec4 a = texture2D(attr, aRef);
  if (!isTag(a.x, TAG_VAULT_WHEEL)) return pos;
  vec3 hinge = vec3(VAULT_HINGE_X, 0.0, 0.0);
  vec3 axle = vec3(VAULT_AXIS, 0.0);
  vec3 c = pos * uPoseVault;
  c = hinge + rotY(c - hinge, -uDoorOpen);
  c = axle + rotZ(c - axle, uWheel);
  c = hinge + rotY(c - hinge, uDoorOpen);
  return mix(pos, uPoseVault * c, w);
}

void main() {
  vec3 pos = texture2D(uPositions, aRef).xyz;
  pos = spinWheel(pos, uAttrA, uKinds.x, uWeights.x);
  pos = spinWheel(pos, uAttrB, uKinds.y, uWeights.y);
  pos = spinWheel(pos, uAttrC, uKinds.z, uWeights.z);

  vec3 nSum = vec3(0.0);
  float nW = 0.0;
  float tint = 0.0;
  float signal = 0.0;
  glyphLook(uAttrA, uKinds.x, uWeights.x, pos, nSum, nW, tint, signal);
  glyphLook(uAttrB, uKinds.y, uWeights.y, pos, nSum, nW, tint, signal);
  glyphLook(uAttrC, uKinds.z, uWeights.z, pos, nSum, nW, tint, signal);
  // Never normalise a vector that can be zero: plain clouds carry none.
  float nl = length(nSum);
  vObjNormal = nl > 1e-4 ? normalize(normalMatrix * (nSum / nl)) * min(nW, 1.0) : vec3(0.0);
  vTint = clamp(tint, 0.0, 1.0);
  vSignal = clamp(signal, 0.0, 1.0);
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
uniform vec3  uColorSignal;
uniform vec3  uFogColor;
uniform float uOpacity;
uniform float uFogNear;
uniform float uFogFar;

varying float vSeed;
varying float vDepth;
varying float vSpeed;
varying float vNear;
varying float vHeight;
varying vec3  vObjNormal;
varying float vTint;
varying float vSignal;

void main() {
  // Density, not translucency — see the block comment above.
  if (vSeed > uOpacity) discard;
  if (vNear < fract(vSeed * 7.13)) discard;

  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;

  // A bead of a glyph is lit as part of its solid as well as round in
  // itself: the surface normal and the sphere's own normal, blended.
  vec3 n = normalize(vec3(c, sqrt(max(1.0 - r2, 0.0))) * 0.55 + vObjNormal * 0.6);
  vec3 L = normalize(vec3(-0.35, 0.8, 0.5));
  float diffuse = max(dot(n, L), 0.0) * 0.88 + 0.12;
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);

  vec3 color = mix(uColorShade, uColorLit, diffuse) + spec * 0.22;

  // Overhead light: the chamber is lit from above, so the top of any
  // formation is brighter than its underside.
  color *= mix(0.78, 1.06, smoothstep(-3.0, 3.0, vHeight));

  // Beads in fast motion catch a frost sheen: lighter, never a new hue.
  color = mix(color, uColorHot, clamp(vSpeed * 0.9, 0.0, 0.4));

  // The live parts of a glyph (the pipes, the bids, the payouts, the
  // stream's packet) take the glacial ink, still lit; signal running
  // through them is frost-white light.
  color = mix(color, uColorSignal * (0.45 + 0.75 * diffuse), vTint * 0.85);
  color = mix(color, uColorHot * 1.06, vSignal * 0.85);

  // Atmospheric perspective: far beads dissolve into the chamber's fog.
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  color = mix(color, uFogColor, fog * 0.75);

  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;
