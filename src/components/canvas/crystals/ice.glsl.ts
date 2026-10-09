/* ============================================================================
   ICE CRYSTAL SHADERS

   PLATE   The path-traced crystal. The video carries colour on top and alpha
           below (H.264 has no alpha channel), colour premultiplied in sRGB.
           It is sampled raw, un-premultiplied, linearised, and written
           premultiplied again for One / OneMinusSrcAlpha blending. The poster
           (reduced motion, and while the video loads) is an ordinary straight
           RGBA image through the same path.

   WIRE    The hover mesh: the ice block's evenly triangulated surface,
           pushed through the Blender camera and the rendered frame's pivot
           matrix, so it lands on the crystal in the picture, then laid flat
           on the plate. Revealed only by the front of a wave sent out
           when the pointer moves.

   GLINT   A few surface vertices flash as four-point stars on that front.

   Normal blending only: additive light vanishes against fog.
   ========================================================================= */

const SRGB_TO_LINEAR = /* glsl */ `
  vec3 srgbToLinear(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
`;

export const PLATE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const PLATE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uStacked;   // 1: video, colour over alpha; 0: straight RGBA poster
  uniform float uTexelY;    // half a texel of the stacked video, in uv
  uniform float uOpacity;
  varying vec2 vUv;
  ${SRGB_TO_LINEAR}

  void main() {
    vec3 rgb;
    float a;
    if (uStacked > 0.5) {
      // Stay half a texel clear of the seam, or the halves bleed into each other.
      float yc = clamp(0.5 + vUv.y * 0.5, 0.5 + uTexelY, 1.0 - uTexelY);
      float ya = clamp(vUv.y * 0.5, uTexelY, 0.5 - uTexelY);
      vec3 premul = texture2D(uMap, vec2(vUv.x, yc)).rgb;
      a = texture2D(uMap, vec2(vUv.x, ya)).r;
      // Encoder noise lifts the black around the crystal a hair; cut it.
      a = clamp((a - 0.012) / 0.988, 0.0, 1.0);
      rgb = a > 0.002 ? premul / max(a, 0.002) : vec3(0.0);
    } else {
      vec4 t = texture2D(uMap, vUv);
      rgb = t.rgb;
      a = t.a;
    }
    a *= uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(max(srgbToLinear(rgb), 0.0), a);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

/* Shared by WIRE and GLINT: Blender camera → plate. */
const PROJECT = /* glsl */ `
  uniform mat4 uView;    // Blender camera, world -> view
  uniform mat4 uProj;    // Blender camera, view -> clip
  uniform mat4 uPose;    // pivot matrix for the frame on screen
  uniform vec3 uCam;     // Blender camera position
  uniform vec2 uHalf;    // plate half extents, local units

  vec3 toPlate(vec4 world, out vec2 plateUv) {
    vec4 clip = uProj * uView * world;
    vec2 ndc = clip.xy / max(clip.w, 1e-4);
    plateUv = ndc * 0.5 + 0.5;
    return vec3(ndc * uHalf, 0.004);
  }
`;

/* The wave: the only thing that reveals the mesh (owner's calls, after the
   igloo.inc reference). Moving the pointer sends ONE wave at a time from
   where it is: it starts as a pinpoint and spreads outward in the direction
   of travel. The mesh it passes over glows: brightest along its soft leading
   edge, fading behind it, with its reach warped and its brightness mottled
   by noise, so it spreads like light through ice and never reads as a disc
   or a circle with a radius. Two slots only so a fading wave can finish while
   the next begins; the emitter never overlaps them more than that.
   xy = origin (plate uv), z = age 0..1 (1 = gone), w = strength. */
const WAVE = /* glsl */ `
  #define WAVES 2
  uniform vec4 uWave[WAVES];
  uniform vec2 uWaveDir[WAVES];  // unit direction of travel, aspect-corrected
  uniform float uWaveRadius;     // how far a wave travels, in plate heights
  uniform float uAspect;         // plate width / height

  // Value noise and a two-octave fbm: what keeps the glow from reading as a
  // circle. It warps how far the light reaches and mottles how bright each
  // patch of mesh gets, the way light catches some facets and not others.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.3 + 17.0) * 0.35;
  }

  float wave(vec2 uv, out float frontOut) {
    float m = 0.0;
    float edge = 0.0;
    vec2 q = uv * vec2(uAspect, 1.0);
    for (int i = 0; i < WAVES; i++) {
      vec4 p = uWave[i];
      float age = p.z;
      if (age >= 1.0) continue;
      vec2 dv = (uv - p.xy) * vec2(uAspect, 1.0);
      float d = length(dv);
      float life = 1.0 - age;
      vec2 seed = p.xy * 37.0 + float(i) * 11.0;
      // From a pinpoint, easing out: fast at first, settling as it fades.
      float r = uWaveRadius * (1.0 - pow(life, 2.2));
      // How far the light reaches varies by place: tongues and inlets, not
      // a radius. The warp drifts as the wave travels.
      float reach = r * (0.62 + 0.76 * fbm(q * 7.0 + seed + age * 0.6));
      // Leading edge: soft and brightest, widening as it slows.
      float bw = 0.018 + 0.05 * age;
      // z*z, never pow(z, 2.0): pow of a negative base is NaN on Macs.
      float z = (d - reach) / bw;
      float lead = exp(-z * z);
      // Behind it, a broad glow that thins toward the origin.
      float trail = smoothstep(reach * 0.1, reach, d) * (1.0 - smoothstep(reach, reach + bw * 1.5, d));
      // Mottled: some patches catch more light than others.
      float mottle = 0.4 + 0.6 * fbm(q * 13.0 - seed);
      // Directional, but with a soft, uneven shoulder rather than a cone edge.
      float cosA = d > 1e-4 ? dot(dv / d, uWaveDir[i]) : 1.0;
      float lobe = smoothstep(-0.25 + 0.35 * fbm(q * 5.0 + seed), 0.8, cosA);
      // Eases in from nothing, so the origin never pops as a dot.
      float fade = smoothstep(0.0, 0.1, age) * pow(life, 1.4) * p.w * lobe;
      m = max(m, (lead * 1.0 + trail * 0.52) * mottle * fade);
      edge = max(edge, lead * mottle * fade);
    }
    frontOut = edge;
    return m;
  }
`;

export const WIRE_VERTEX = /* glsl */ `
  attribute vec3 faceNormal;
  attribute vec3 bary;
  ${PROJECT}
  varying vec3 vBary;
  varying vec2 vPlateUv;
  varying float vFacing;

  void main() {
    vec4 world = uPose * vec4(position, 1.0);
    vec3 n = normalize(mat3(uPose) * faceNormal);
    vec3 toCam = uCam - world.xyz;
    float len = length(toCam);
    vFacing = len > 1e-4 ? dot(n, toCam / len) : 0.0;
    vBary = bary;
    vec3 local = toPlate(world, vPlateUv);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }
`;

export const WIRE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHalo;
  uniform float uOpacity;
  uniform float uPixelRatio;
  ${WAVE}
  varying vec3 vBary;
  varying vec2 vPlateUv;
  varying float vFacing;

  void main() {
    if (uOpacity < 0.004) discard;
    float front;
    float m = wave(vPlateUv, front);
    // Back faces of the surface would double the mesh into a moire.
    float facing = smoothstep(0.0, 0.25, vFacing);
    if (m * facing < 0.004) discard;
    // Distance to the nearest edge in device pixels: a true hairline, about
    // one CSS pixel at any density. Soft wide lines read as fog, not mesh.
    vec3 fw = max(fwidth(vBary), vec3(1e-5));
    vec3 e = vBary / fw;
    float edge = min(min(e.x, e.y), e.z);
    float line = 1.0 - smoothstep(0.45 * uPixelRatio, 0.45 * uPixelRatio + 1.1, edge);
    // A faint slate halo so the white line still reads on bright ice.
    float halo = (1.0 - smoothstep(1.1 * uPixelRatio, 2.2 * uPixelRatio, edge)) * 0.2;
    float cover = max(line, halo);
    float a = cover * min(m, 1.0) * facing * uOpacity;
    if (a < 0.004) discard;
    vec3 col = mix(uHalo, uColor, line / max(cover, 1e-4));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export const GLINT_VERTEX = /* glsl */ `
  attribute float seed;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  ${PROJECT}
  ${WAVE}
  varying float vAlpha;

  void main() {
    vec4 world = uPose * vec4(position, 1.0);
    vec2 uv;
    vec3 local = toPlate(world, uv);
    // A few stars ride the wave's front; each blinks on its own beat.
    float pick = fract(seed * 7.13);
    float front;
    wave(uv, front);
    float near = front * step(pick, 0.12);
    float chosen = 1.0;
    float beat = pow(max(sin(uTime * (1.6 + fract(seed * 3.7) * 2.2) + seed * 40.0), 0.0), 6.0);
    vAlpha = chosen * near * (0.35 + 0.65 * beat);
    gl_PointSize = vAlpha > 0.004 ? uSize * uPixelRatio * (0.55 + 0.45 * beat) : 0.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local + vec3(0.0, 0.0, 0.002), 1.0);
  }
`;

export const GLINT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    // Four-point star: two thin crossed bars and a soft core.
    float bars = max(
      (1.0 - smoothstep(0.0, 0.09, abs(p.y))) * (1.0 - smoothstep(0.2, 1.0, abs(p.x))),
      (1.0 - smoothstep(0.0, 0.09, abs(p.x))) * (1.0 - smoothstep(0.2, 1.0, abs(p.y)))
    );
    float core = 1.0 - smoothstep(0.0, 0.22, length(p));
    float a = max(bars, core) * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;
