import { NOISE_CHUNK } from '../canvas/gpgpu/noise.glsl';

/* ============================================================================
   STAGE MARK — simulation and render shaders

   Modelled on igloo.inc's social marks: a volume of beads with real
   momentum. Every bead has a home on the current logo and a velocity, and
   the GPU integrates them every frame:

   spring     pulls each bead toward its home, which turns with the mark, so
              beads lag a hair behind a fast turn instead of being glued.
   wind       the cursor is a gust along its own velocity, applied to beads
              near the cursor's line of sight through the volume.
   heat       disturbance per bead, stored in velocity.w. A hot bead loosens
              its spring, swirls on curl flow, drifts up like smoke and
              glows. Heat cools with time — faster near the base, so a torn
              mark re-forms from the feet up, as in the reference.
   morph      changing logo blends each bead's home from the old logo to the
              new on a per-bead delay, and a kick of heat throws the old
              shape into smoke so the new one condenses out of it.

   position.w carries a per-bead seed, constant for the life of the bead.
   ========================================================================= */

export const STAGE_VELOCITY = /* glsl */ `
${NOISE_CHUNK}

uniform float uTime;
uniform float uDelta;
uniform float uMotion;

uniform sampler2D uTargetA;
uniform sampler2D uTargetB;
uniform float uMix;

uniform mat3  uRot;
uniform vec3  uOffset;
uniform float uScale;

uniform vec3  uRayO;
uniform vec3  uRayD;
uniform vec3  uWind;
uniform float uWindRadius;

uniform float uKick;
uniform float uHold;
uniform float uBurst;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  float seed = pos.w;

  /* --- home on the (morphing) logo --- */
  float m = clamp((uMix - seed * 0.45) / 0.55, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec3 local = mix(texture2D(uTargetA, uv).xyz, texture2D(uTargetB, uv).xyz, m);
  vec3 home = uRot * (local * uScale) + uOffset;

  /* --- cursor: distance from the bead to the cursor's ray --- */
  vec3 rel = pos.xyz - uRayO;
  vec3 off = rel - uRayD * dot(rel, uRayD);
  float d = length(off);
  float reach = exp(-(d * d) / (uWindRadius * uWindRadius));
  vec3 outward = off / max(d, 1e-4);

  /* In the reference a hit does not comb beads into strands: the region
     around the hit point flares and swells OUTWARD as one dense mass, then
     drifts. So the gust is part outward bloom (from the cursor's line of
     sight) and part carry (along the cursor's motion), and the whole region
     inside the radius heats evenly, which keeps it cohesive. */
  float strength = clamp(length(uWind) * 0.7, 0.0, 1.0);
  vec3 gust = (uWind * 0.4 + outward * length(uWind) * 0.3) * reach;
  vec3 knock = outward * uBurst * smoothstep(0.3, 0.8, reach) * 2.6;

  /* --- heat --- */
  float heat = vel.w;
  // A hover only warms beads (capped well below white); a click still flares.
  heat = max(heat, smoothstep(0.2, 0.75, reach) * max(strength * 0.45, uBurst));
  heat = min(1.0, heat + uKick * (0.55 + 0.45 * seed));
  heat = max(heat, uHold);
  // Cool from the base up: low beads settle first.
  float height01 = clamp(local.y * 0.5 + 0.5, 0.0, 1.0);
  float cooling = mix(0.95, 0.38, height01) * (0.75 + 0.5 * fract(seed * 13.7));
  heat = max(0.0, heat - uDelta * cooling);

  /* --- forces --- */
  float loose = smoothstep(0.0, 0.55, heat);
  float stiffness = mix(26.0, 0.6, loose);
  vec3 acc = (home - pos.xyz) * stiffness;

  vec3 flow = curlNoise(pos.xyz * 0.62 + vec3(0.0, uTime * 0.16, uTime * 0.07));
  acc += flow * (0.12 + loose * 1.5) * uMotion;
  acc += vec3(0.0, 0.42, 0.0) * loose * uMotion;   // hot beads rise like smoke
  acc += gust * 7.0;

  // The knock is an impulse (velocity), not a force: one frame, full effect.
  vec3 v = vel.xyz + acc * uDelta + knock;
  // Damping is frame-rate independent: the factor is per 1/60 s. Hot beads
  // keep their momentum longer so a torn region travels as one cloud.
  v *= pow(mix(0.80, 0.948, loose), uDelta * 60.0);

  // A NaN bead never recovers on its own; drop it to rest instead.
  if (any(isnan(v)) || any(isinf(v))) v = vec3(0.0);

  gl_FragColor = vec4(v, heat);
}
`;

export const STAGE_POSITION = /* glsl */ `
uniform float uDelta;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  vec3 p = pos.xyz + vel.xyz * uDelta;
  if (any(isnan(p)) || any(isinf(p))) p = vec3(0.0); // springs back home
  gl_FragColor = vec4(p, pos.w);
}
`;

/* --- Render ---------------------------------------------------------------
   Beads are pebbles, not dots: an ellipse in the sprite, oriented by a
   per-bead angle at rest and stretched along their screen-space motion
   when flying, so a gust reads as streaks. Shading blends a pebble normal
   with the surface normal of the bead's home, so the cloud still lights as
   one solid. Heat lifts a bead toward icy white.
   ------------------------------------------------------------------------- */

export const STAGE_POINTS_VERTEX = /* glsl */ `
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uNormalA;
uniform sampler2D uNormalB;
uniform float uMix;
uniform mat3  uRot;
uniform float uBead;
uniform float uPxPerUnit;
uniform float uRefDist;
uniform float uDpr;
uniform vec2  uResolution;
uniform float uPresence;

attribute vec2 aRef;

varying vec3  vNormal;
varying float vHeat;
varying vec2  vDir;
varying float vStretch;

void main() {
  vec4 pos = texture2D(uPositions, aRef);
  vec4 vel = texture2D(uVelocities, aRef);
  float seed = pos.w;

  float m = clamp((uMix - seed * 0.45) / 0.55, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec3 n = normalize(mix(texture2D(uNormalA, aRef).xyz, texture2D(uNormalB, aRef).xyz, m) + vec3(1e-4));
  vNormal = normalize(mat3(viewMatrix) * (uRot * n));
  vHeat = vel.w;

  vec4 mv = viewMatrix * vec4(pos.xyz, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = clip;

  /* Screen-space motion over 1/30 s decides the streak — but only for
     disturbed beads. Every bead moves while the mark turns; streaking on
     that would comb the whole volume into one direction. At rest a bead
     keeps its own random orientation. */
  vec4 ahead = projectionMatrix * (viewMatrix * vec4(pos.xyz + vel.xyz * 0.033, 1.0));
  vec2 shift = (ahead.xy / ahead.w - clip.xy / clip.w) * 0.5 * uResolution;
  float speedPx = length(shift);
  float angle = seed * 6.2831;
  vec2 restDir = vec2(cos(angle), sin(angle));
  float flying = smoothstep(0.12, 0.45, vel.w) * step(0.6, speedPx);
  vDir = normalize(mix(restDir, shift / max(speedPx, 1e-3), flying) + vec2(1e-4));
  vStretch = 1.4 + clamp(speedPx * 0.35, 0.0, 2.6) * flying;

  float size = uBead * uPxPerUnit * (uRefDist / -mv.z) * uDpr * (0.78 + fract(seed * 7.31) * 0.44);
  // Arrival and departure by density: whole beads drop out by seed (a
  // translucent mark reads as a smudge on the pale room).
  gl_PointSize = fract(seed * 3.17) < uPresence ? size * vStretch : 0.0;
}
`;

export const STAGE_POINTS_FRAGMENT = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHot;

varying vec3  vNormal;
varying float vHeat;
varying vec2  vDir;
varying float vStretch;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  // Into the bead's own frame: x along its long axis.
  vec2 q = vec2(dot(c, vDir), dot(c, vec2(-vDir.y, vDir.x)) * vStretch);
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;

  vec3 pebble = vec3(q.x, q.y / vStretch, sqrt(1.0 - r2));
  vec3 n = normalize(pebble + vNormal * 1.25);

  vec3 L = normalize(vec3(-0.3, 0.85, 0.42));
  float diffuse = max(dot(n, L), 0.0);
  float wrap = diffuse * 0.86 + 0.14;
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);

  vec3 colour = mix(uShade, uLit, wrap) + spec * 0.16;
  /* Torn beads go icy white against the slate body: the contrast is what
     makes a gust read as light catching loose ice, as in the reference. */
  // Starts above the hover's heat cap (0.45): a hover never whitens a bead,
  // only a click or a change of mark does.
  float glow = smoothstep(0.5, 0.9, vHeat) * 0.7;
  colour = mix(colour, uHot * (1.0 + 0.12 * wrap), glow);

  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

/* --- Ambient dust ---------------------------------------------------------
   Fine specks drifting down through the chamber, densest in a soft column
   beside the mark, as in the reference. Pure function of time: no state.
   ------------------------------------------------------------------------- */

export const DUST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uDpr;
uniform float uMotion;
attribute vec4 aSeed;
varying float vAlpha;

void main() {
  float t = uTime * uMotion;
  float fall = fract(aSeed.y - t * (0.012 + aSeed.z * 0.02));
  vec3 p = vec3(
    position.x + sin(t * 0.3 + aSeed.x * 20.0) * 0.08,
    mix(3.2, -2.2, fall),
    position.z
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.2 + aSeed.w * 1.4) * uDpr;
  vAlpha = smoothstep(0.0, 0.12, fall) * (1.0 - smoothstep(0.85, 1.0, fall)) * (0.35 + aSeed.w * 0.5);
}
`;

export const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  gl_FragColor = vec4(uColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/* --- Glow halo ------------------------------------------------------------
   The stage canvas has no bloom pass, but the reference's torn beads flare
   white with a soft halo. A second, additive draw of only the hot beads —
   larger, soft-edged, scaled by heat — gives that flare at a fraction of a
   bloom pass's cost.
   ------------------------------------------------------------------------- */

export const HALO_VERTEX = /* glsl */ `
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform float uBead;
uniform float uPxPerUnit;
uniform float uRefDist;
uniform float uDpr;
uniform float uPresence;
attribute vec2 aRef;
varying float vHeat;

void main() {
  vec4 pos = texture2D(uPositions, aRef);
  float heat = texture2D(uVelocities, aRef).w;
  vHeat = heat;
  vec4 mv = viewMatrix * vec4(pos.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  // Only real flares (a click, a change of mark) get a halo; a hover caps
  // heat below this, and thousands of faint discs would stack into a cloud.
  gl_PointSize = heat < 0.5 || fract(pos.w * 3.17) >= uPresence ? 0.0 : uBead * uPxPerUnit * (uRefDist / -mv.z) * uDpr * 2.6 * heat;
}
`;

export const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vHeat;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.2) * vHeat * vHeat * 0.22;
  gl_FragColor = vec4(uColor * a, a);
}
`;
