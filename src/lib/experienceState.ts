/* ============================================================================
   EXPERIENCE STATE — a mutable singleton, like scrollState.

   The Experience chapter holds the viewport while its stations pass, and the
   bead field walks a chain of formations in step with it. Thaw's
   ScrollTrigger writes `progress`; ParticleField reads it every frame and
   writes back where each glyph label should sit on screen; Thaw's ticker
   moves the labels there. React never re-renders for any of it.
   ========================================================================= */

export type MarkPosition = { x: number; y: number; o: number };

export const experienceState = {
  /** 0 → 1 through the held chapter. Stays 0 when it is not held (phones,
      reduced motion): the chapter then shows the stream alone. */
  progress: 0,
  /** Damped progress: what the field consumes. */
  smooth: 0,
  /** Screen position and opacity of each glyph label, by anchor name. */
  marks: {} as Record<string, MarkPosition>,
};

/* Station centres along the held chapter, and the chain the field walks:
   stream → pipeline → book → vault → stream. Each glyph holds through a
   wide plateau around its station so it can be read, then morphs straight
   into the next. The stream only opens and closes the chapter: a detour
   through it between stations took longer than the gap allowed and read as
   filler (owner's call). */
export const STATION_CENTRES = [0.2, 0.5, 0.8] as const;

const CHAIN_KEYS: [number, number][] = [
  [0, 0],
  [0.06, 0],
  [0.13, 1],
  [0.3, 1],
  [0.4, 2],
  [0.6, 2],
  [0.7, 3],
  [0.87, 3],
  [0.94, 4],
  [1, 4],
];

/** Progress → position on the chain, 0 → 4. */
export function chainCoord(p: number) {
  if (p <= 0) return 0;
  for (let i = 0; i < CHAIN_KEYS.length - 1; i++) {
    const [p0, c0] = CHAIN_KEYS[i];
    const [p1, c1] = CHAIN_KEYS[i + 1];
    if (p <= p1) return c0 + ((p - p0) / (p1 - p0 || 1)) * (c1 - c0);
  }
  return 4;
}
