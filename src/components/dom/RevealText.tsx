'use client';

import { useRef, type ElementType, type ReactNode } from 'react';
import { gsap, useGSAP, SplitText } from '@/lib/gsap';

/* ============================================================================
   REVEAL TEXT

   Line- or character-level mask reveal. SplitText's `mask` option wraps each
   line in its own overflow-hidden container, so the reveal is a pure
   transform — no clip-path recalculation, no layout thrash.

   useGSAP runs in a layout effect, before paint, which is why nothing needs
   to be pre-hidden with opacity: the masks are already in place and the
   lines already translated out of frame by the time the first frame renders.
   ========================================================================= */

type RevealMode = 'lines' | 'words' | 'chars';

type Props = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  mode?: RevealMode;
  stagger?: number;
  delay?: number;
  duration?: number;
  /** ScrollTrigger start. Pass null to play immediately on mount. */
  start?: string | null;
};

export function RevealText({
  children,
  as,
  className,
  mode = 'lines',
  stagger = 0.075,
  delay = 0,
  duration = 1.15,
  start = 'top 84%',
}: Props) {
  const ref = useRef<HTMLParagraphElement>(null);

  /* `as` is a runtime tag switch. Casting to a single concrete intrinsic
     keeps ref and children correctly typed instead of collapsing to the
     `never` intersection that a bare ElementType union produces. */
  const Tag = (as ?? 'p') as 'p';

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { motion } = context.conditions as { motion: boolean; reduced: boolean };
          if (!motion) return;

          const split = SplitText.create(el, {
            type: mode === 'lines' ? 'lines' : `lines,${mode}`,
            mask: 'lines',
            linesClass: 'revealLine',
            autoSplit: true,
          });

          const targets =
            mode === 'chars' ? split.chars : mode === 'words' ? split.words : split.lines;

          // End state pinned (fromTo): see Chapter.
          gsap.fromTo(targets, {
            yPercent: 118,
            // A hair of rotation on per-character reveals reads as weight.
            rotate: mode === 'chars' ? 2.4 : 0,
          }, {
            yPercent: 0,
            rotate: 0,
            duration,
            delay,
            stagger,
            ease: 'expo.out',
            ...(start === null
              ? {}
              : {
                  scrollTrigger: {
                    trigger: el,
                    start,
                    once: true,
                  },
                }),
          });

          return () => split.revert();
        },
      );

      return () => mm.revert();
    },
    { scope: ref, dependencies: [mode, delay, duration, stagger, start] },
  );

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
