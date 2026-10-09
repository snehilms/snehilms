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
           on the plate. Revealed only by the wake the pointer leaves
           as it moves.

   GLINT   A few surface vertices flash as four-point stars on its crests.

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

/* The wake: the only thing that reveals the mesh (owner's calls: "like a
   ship moving through water, the water beside it moves sideways and flows
   far beyond", and seamless, never pulsing ripple by ripple). It is one
   continuous shape, not a train of ripples: the pointer's recent path, newest
   first, with the live pointer as its first point. Each point of the path is
   pushed out to both sides of the way the pointer was heading (and a touch
   astern) by how long ago the pointer was there, so the two arms of a V open
   from the pointer and keep spreading behind it. Each arm is drawn as the
   chain of segments joining those points, taking the nearest (max, never
   sum: joints must not brighten). Brightness follows the pointer's smoothed
   speed, so it swells and settles with the movement. Noise bends the arms
   and mottles their light, so it reads as light moving through ice.
   uWake[i]: xy = where the pointer was (plate uv), z = age 0..1 (1 = gone),
   w = strength. uWakeDir[i]: its heading then, aspect-corrected. */
const WAVE = /* glsl */ `
  #define WAKE 40
  uniform vec4 uWake[WAKE];
  uniform vec2 uWakeDir[WAKE];
  uniform float uWakeReach;  // how far the arms spread, in plate heights
  uniform float uWakeBreak;  // an age gap this big means the pointer rested
  uniform float uAspect;     // plate width / height

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

  // Where one side's arm passes for a point of the path: pushed out sideways
  // (and a touch astern), out fast and then settling, like a bow wave.
  vec2 armPoint(vec4 p, vec2 h, float sgn) {
    float life = 1.0 - min(p.z, 1.0);
    float spread = uWakeReach * (1.0 - life * life);
    return p.xy * vec2(uAspect, 1.0) + (vec2(-h.y, h.x) * sgn - h * 0.22) * spread;
  }

  float segDist(vec2 x, vec2 a, vec2 b, out float t) {
    vec2 ab = b - a;
    float l = dot(ab, ab);
    t = l > 1e-10 ? clamp(dot(x - a, ab) / l, 0.0, 1.0) : 0.0;
    return length(x - a - ab * t);
  }

  float wave(vec2 uv, out float frontOut) {
    vec2 q = uv * vec2(uAspect, 1.0);
    // Bent by the ice, not drawn with a ruler.
    vec2 x = q + (vec2(fbm(q * 6.0), fbm(q * 6.0 + 31.0)) - 0.5) * 0.04;
    float mottle = 0.4 + 0.6 * fbm(q * 13.0 + 5.0);
    float crest = 0.0;
    float body = 0.0;
    for (int i = 0; i < WAKE - 1; i++) {
      vec4 a = uWake[i];
      vec4 b = uWake[i + 1];
      // Newest first, so everything after a spent point is spent too.
      if (a.z >= 1.0) break;
      // Never join across a rest, or a jump in and out of the crystal.
      if (b.z - a.z > uWakeBreak) continue;
      vec2 jump = (b.xy - a.xy) * vec2(uAspect, 1.0);
      if (dot(jump, jump) > 0.0144) continue;
      for (int k = 0; k < 2; k++) {
        float sgn = float(k) * 2.0 - 1.0;
        float t;
        float d = segDist(x, armPoint(a, uWakeDir[i], sgn), armPoint(b, uWakeDir[i + 1], sgn), t);
        float age = min(mix(a.z, b.z, t), 1.0);
        float life = 1.0 - age;
        // The crest widens and softens as it runs out.
        float bw = 0.008 + 0.03 * age;
        // z*z, never pow(z, 2.0): pow of a negative base is NaN on Macs.
        float z = d / bw;
        float g = exp(-z * z);
        // Fades in off the pointer, so the tip never sits as a hot dot.
        float w = mix(a.w, b.w, t) * smoothstep(0.0, 0.12, age) * life * sqrt(life);
        crest = max(crest, g * w);
        // The water it has moved still glows a little either side of it.
        body = max(body, (g + 0.35 * exp(-z * z * 0.12)) * w);
      }
    }
    frontOut = min(crest, 1.0) * mottle;
    return min(body, 1.0) * mottle;
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
    // A few stars ride the wake's crests; each blinks on its own beat.
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
