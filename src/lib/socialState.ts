/* ============================================================================
   SOCIAL STATE

   Mutable, outside React, for the same reason as archiveState: these values
   change every frame and are read inside useFrame. The stage's ScrollTrigger
   and selector links write it; the stage canvas reads it.
   ========================================================================= */

export const socialState = {
  /** Continuous position through the socials while the stage is pinned,
      0 → socials.length - 1. Tweened by a scrubbed, snapping ScrollTrigger. */
  scrollIndex: 0,
  /** Selector link under the pointer or keyboard focus, or -1. Overrides
      the scroll position while set. */
  focus: -1,
  /** 0 → 1 as the stage scrolls into view: beads condense into the mark. */
  assemble: 0,
};

/** The mark the stage should be showing right now. */
export function activeSocial() {
  return socialState.focus >= 0 ? socialState.focus : Math.round(socialState.scrollIndex);
}
