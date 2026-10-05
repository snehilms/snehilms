/* ============================================================================
   SCROLL STATE — a mutable singleton, deliberately outside React.

   The WebGL scene reads scroll progress every frame at 60fps. Routing that
   through useState would re-render the React tree 60 times a second and
   destroy the frame budget. Instead: ScrollTrigger writes here, useFrame
   reads here, and React never learns about it.
   ========================================================================= */

export type ScrollState = {
  /** Global page progress, 0 → 1. */
  progress: number;
  /** Smoothed progress — what the shader actually consumes. */
  smooth: number;
  /** Signed scroll velocity, normalised and damped. */
  velocity: number;
  /** Index of the chapter currently occupying the viewport. */
  chapter: number;
  /**
   * Continuous position in CHAPTER space, 0 → chapters.length - 1.
   *
   * Not the same thing as `progress`. Chapters have wildly different heights
   * — the archive is more than twice the height of the hero — so mapping the
   * particle field's formations onto raw page progress would have a shape
   * finish forming halfway down the wrong section. This value is 2.0 exactly
   * when chapter 2 is centred in the viewport, whatever it is measured in.
   */
  chapterT: number;
  /** Damped chapterT — what the field and camera actually consume. */
  chapterSmooth: number;
  /** Pointer in normalised device coords, -1 → 1. */
  pointer: { x: number; y: number };
  /** Smoothed pointer — kills jitter before it reaches the sim. */
  pointerSmooth: { x: number; y: number };
  /** Set once the preloader hands off. Gates the intro timeline. */
  ready: boolean;
};

export const scrollState: ScrollState = {
  progress: 0,
  smooth: 0,
  velocity: 0,
  chapter: 0,
  chapterT: 0,
  chapterSmooth: 0,
  pointer: { x: 0, y: 0 },
  pointerSmooth: { x: 0, y: 0 },
  ready: false,
};

/** Frame-rate independent exponential damping. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Map a value from one range to another, clamped. */
export function remap(v: number, inMin: number, inMax: number, outMin = 0, outMax = 1) {
  const t = Math.min(Math.max((v - inMin) / (inMax - inMin), 0), 1);
  return outMin + t * (outMax - outMin);
}

export const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Smoothstep — the standard S-curve, for easing without a tween. */
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
