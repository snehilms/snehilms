/* ============================================================================
   CRYSTAL SHADERS

   The body is a real glass model, not a fresnel silhouette:

   ENVIRONMENT  synthesised in the shader — sky gradient, horizon band, a key
                and a rim light. No cubemap to load, and because it is
                procedural it is the chamber itself: pale fog overhead, a
                white horizon strip, a slate floor. On a pale page the slate
                floor is what the lower facets report, and that contrast is
                what makes the glass read as a solid block of ice.

   DISPERSION   refraction is traced three times, once per colour channel at
                a slightly different IOR. The channels separate most where
                the surface turns away from the viewer, which is exactly
                where real crystal throws colour.

   ABSORPTION   Beer-Lambert over a path length found by exiting a bounding
                sphere in object space. Thick parts go deep and saturated,
                thin edges stay clear — this is what gives the shard volume
                rather than making it look like a printed decal.
   ========================================================================= */

import { SIMPLEX_CHUNK } from '../gpgpu/noise.glsl';

/* ----------------------------------------------------------------------
   HOVER DISTORTION

   A slow swell travelling over the surface — the shard breathing, not
   spinning. Shared verbatim by the body, the network lines and the node
   markers so all three ride the same wave and stay locked together.

   Displacement runs along the RADIAL direction, never along the facet
   normal. PolyhedronGeometry is non-indexed, so a corner exists once per
   touching face, each copy carrying a different normal — displacing along
   those would pull the copies apart and split the shard open at every
   corner. Radial direction is a function of position alone, so every copy
   of a corner moves identically and the mesh stays welded.
   -------------------------------------------------------------------- */
const DISTORT_CHUNK = /* glsl */ `
${SIMPLEX_CHUNK}

vec3 distort(vec3 p, float time, float amount) {
  if (amount <= 0.0) return p;
  float wave = snoise(p * 1.9 + vec3(0.0, time * 0.42, 0.0));
  return p + p / max(length(p), 1e-4) * wave * amount;
}
`;

const ENV_CHUNK = /* glsl */ `
uniform vec3  uEnvLow;
uniform vec3  uEnvHigh;
uniform vec3  uEnvBand;
uniform vec3  uKeyColor;
uniform vec3  uRimColor;
uniform vec3  uKeyDir;

vec3 envSample(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uEnvLow, uEnvHigh, pow(up, 1.35));

  // Bright horizon band — the studio strip light every product render has.
  col += uEnvBand * exp(-abs(dir.y) * 5.0) * 0.72;

  /* Two keys, both broad. A single narrow light only ever catches a couple
     of faces and the rest resolve to the gradient, which is what makes a
     faceted solid read as a smooth blob. Broad lights put every facet on one
     side or the other of a hard tonal step. */
  vec3 key = normalize(uKeyDir);
  col += uKeyColor * pow(max(dot(dir, key), 0.0), 16.0) * 3.4;

  vec3 fill = normalize(vec3(-key.x, key.y * 0.45, -key.z * 0.85));
  col += uKeyColor * pow(max(dot(dir, fill), 0.0), 24.0) * 1.6;

  vec3 rim = normalize(vec3(-key.x * 0.7, key.y * 0.35, -key.z) + vec3(0.25, 0.0, -0.4));
  col += uRimColor * pow(max(dot(dir, rim), 0.0), 18.0) * 1.35;

  return col;
}
`;

export const BODY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uDistort;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying float vHeight;

${DISTORT_CHUNK}

void main() {
  vec3 displaced = distort(position, uTime, uDistort);

  vec4 world = modelMatrix * vec4(displaced, 1.0);

  vWorldPos = world.xyz;
  // Scaling is uniform on these shards, so the plain model matrix is a
  // correct normal matrix and we avoid inverting anything per vertex.
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vObjPos = displaced;
  vObjNormal = normalize(normal);
  vHeight = clamp((position.y + 1.45) / 2.9, 0.0, 1.0);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BODY_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uTint;
uniform vec3  uAbsorb;
uniform vec3  uIce;
uniform float uHover;
uniform float uOpacity;
uniform float uFacing;     // +1 front pass, -1 back pass
uniform float uRadius;     // bounding radius, object space
uniform float uIor;
uniform float uDispersion;
uniform float uBaseAlpha;
uniform vec3  uCamObj;     // camera position in this shard's object space

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying float vHeight;

${ENV_CHUNK}

void main() {
  vec3 N = normalize(vWorldNormal) * uFacing;
  vec3 V = normalize(cameraPosition - vWorldPos);

  float NdotV = clamp(dot(N, V), 0.0, 1.0);

  // Schlick, with a high-ish F0 so the shard keeps a hard specular skin.
  float fres = 0.05 + 0.95 * pow(1.0 - NdotV, 4.0);

  /* --- Refraction with per-channel IOR ------------------------------- */
  float iorR = uIor - uDispersion;
  float iorG = uIor;
  float iorB = uIor + uDispersion;

  vec3 refracted = vec3(
    envSample(refract(-V, N, 1.0 / iorR)).r,
    envSample(refract(-V, N, 1.0 / iorG)).g,
    envSample(refract(-V, N, 1.0 / iorB)).b
  );

  /* --- Path length by exiting a bounding sphere in object space ------ */
  vec3 Nobj = normalize(vObjNormal) * uFacing;
  vec3 Vobj = normalize(uCamObj - vObjPos);
  vec3 rd = refract(-Vobj, Nobj, 1.0 / iorG);

  float b = dot(vObjPos, rd);
  float c = dot(vObjPos, vObjPos) - uRadius * uRadius;
  float h = b * b - c;
  float path = h > 0.0 ? max(-b + sqrt(h), 0.0) : uRadius;

  // Beer-Lambert. Deep paths saturate toward the tint, thin edges stay clear.
  vec3 absorption = exp(-uAbsorb * path);
  refracted = mix(uTint * refracted, refracted, absorption);

  /* --- Reflection ---------------------------------------------------- */
  vec3 reflected = envSample(reflect(-V, N));

  vec3 color = mix(refracted, reflected, fres);

  // Hard facet glint. Sharp exponent so it lands on individual faces.
  vec3 key = normalize(uKeyDir);
  float glint = pow(max(dot(reflect(-V, N), key), 0.0), 44.0);
  color += uKeyColor * glint * 2.6 * (0.7 + uHover * 0.5);

  // Cold edge bloom, and a little pooled light toward the base.
  color += uIce * pow(fres, 1.6) * (0.46 + uHover * 0.52);
  color += uIce * 0.06 * (1.0 - vHeight);

  /* --- Opacity -------------------------------------------------------
     Face-on stays translucent enough to read the core through it; edges
     go almost solid. That contrast is what makes it look thick. */
  float alpha = uBaseAlpha + fres * 0.60 + glint;
  alpha = clamp(alpha, 0.0, 1.0) * uOpacity;

  // The back pass sits under the front one and must not double the value.
  alpha *= uFacing > 0.0 ? 1.0 : 0.42;

  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/* ============================================================================
   CORE — the object suspended inside the shard.
   Lit by the same synthetic key so it belongs to the same world as the glass.
   ========================================================================= */

export const CORE_VERTEX = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const CORE_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uBase;
uniform vec3  uHighlight;
uniform vec3  uKeyDir;
uniform float uHover;
uniform float uOpacity;

varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 key = normalize(uKeyDir);

  // Half-lambert: nothing in frame should fall to pure black, or the core
  // disappears into the crystal's own interior shadow.
  float diffuse = dot(N, key) * 0.5 + 0.5;

  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
  float spec = pow(max(dot(reflect(-V, N), key), 0.0), 48.0);

  vec3 color = uBase * (0.28 + diffuse * 0.85);
  color += uHighlight * rim * (0.42 + uHover * 0.48);
  color += uHighlight * spec * 1.3;

  gl_FragColor = vec4(color, uOpacity);
  #include <colorspace_fragment>
}
`;

/* ============================================================================
   MESH NETWORK — unchanged in behaviour, drawn over the glass.
   ========================================================================= */

export const LINE_VERTEX = /* glsl */ `
attribute float aT;
attribute float aSeed;

uniform float uTime;
uniform float uDistort;

varying float vT;
varying float vSeed;

${DISTORT_CHUNK}

void main() {
  vT = aT;
  vSeed = aSeed;

  vec3 displaced = distort(position, uTime, uDistort);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const LINE_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uTime;
uniform float uHover;
uniform float uOpacity;
uniform float uReveal;

varying float vT;
varying float vSeed;

void main() {
  float phase = fract(uTime * 0.28 + vSeed);
  float d = abs(fract(vT - phase + 0.5) - 0.5);
  float pulse = 1.0 - smoothstep(0.0, 0.10, d);

  float base = 0.24 + uHover * 0.52;
  float alpha = base + pulse * (0.18 + uHover * 0.82);

  alpha *= smoothstep(vSeed * 0.55, vSeed * 0.55 + 0.45, uReveal);

  gl_FragColor = vec4(uColor, alpha * uOpacity);
  #include <colorspace_fragment>
}
`;

export const NODE_VERTEX = /* glsl */ `
attribute float aScale;
attribute float aSeed;

uniform float uSize;
uniform float uPixelRatio;
uniform float uHover;
uniform float uTime;
uniform float uDistort;

varying float vSeed;

${DISTORT_CHUNK}

void main() {
  vSeed = aSeed;

  vec3 displaced = distort(position, uTime, uDistort);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 0.001);
  gl_PointSize = uSize * aScale * (1.0 + uHover * 0.45) * uPixelRatio * (10.0 / dist);
}
`;

export const NODE_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uHover;
uniform float uOpacity;
uniform float uReveal;
uniform float uTime;

varying float vSeed;

void main() {
  // Cut a plus out of the sprite. No texture, no atlas, crisp at any size.
  vec2 p = gl_PointCoord - 0.5;

  float thickness = 0.06;
  float arm = 0.32;

  float horizontal = step(abs(p.y), thickness) * step(abs(p.x), arm);
  float vertical = step(abs(p.x), thickness) * step(abs(p.y), arm);
  float mark = max(horizontal, vertical);

  if (mark < 0.5) discard;

  float blink = 0.80 + 0.20 * sin(uTime * 2.1 + vSeed * 30.0);
  float alpha = (0.46 + uHover * 0.54) * blink;
  alpha *= smoothstep(vSeed * 0.5, vSeed * 0.5 + 0.5, uReveal);

  gl_FragColor = vec4(uColor, alpha * uOpacity);
  #include <colorspace_fragment>
}
`;
