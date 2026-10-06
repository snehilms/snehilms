'use client';

import { Fragment, useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import styles from './GlitchText.module.css';

/* ============================================================================
   GLITCH TEXT

   A line that opens as `from` and corrupts into `to`, one word at a time.
   Words are aligned by position, so words the two lines share hold still and
   only the ones that differ glitch: each scrambles through signal glyphs
   while two sliced, offset copies of the incoming word tear across it.
   Hovering replays it (back to `from`, then forward again).

   Layout never moves: an invisible copy of `to` reserves the final size, and
   the live words sit over it. The server renders `to`, so reduced motion and
   no-JS visitors simply read the final line; screen readers always get `to`.
   ========================================================================= */

const GLYPHS = '!<>-_\\/[]{}=+*^?#01';
const WORD_SECONDS = 0.55;

type Slot = { from: string; to: string };

function align(from: string, to: string): Slot[] {
  const a = from.split(' ');
  const b = to.split(' ');
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({
    from: a[i] ?? '',
    to: b[i] ?? '',
  }));
}

type Props = {
  from: string;
  to: string;
  /** Seconds after mount before the first transition. */
  delay: number;
  className?: string;
};

export function GlitchText({ from, to, delay, className }: Props) {
  const root = useRef<HTMLParagraphElement>(null);
  const slots = align(from, to);

  useGSAP(
    () => {
      const words = gsap.utils.toArray<HTMLElement>(`.${styles.word}`, root.current);
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        words.forEach((el, i) => (el.textContent = slots[i].from));

        /* One word after another, skipping the words both lines share. */
        const run = (key: 'from' | 'to', stagger: number) => {
          const tl = gsap.timeline();
          let k = 0;
          slots.forEach((slot, i) => {
            const target = slot[key];
            const other = key === 'to' ? slot.from : slot.to;
            if (target === other) return;
            const el = words[i];
            const at = k++ * stagger;
            tl.call(
              () => {
                el.dataset.text = target || other;
                el.classList.add(styles.glitching);
              },
              [],
              at,
            )
              .to(
                el,
                {
                  duration: WORD_SECONDS,
                  ease: 'none',
                  scrambleText: { text: target, chars: GLYPHS, speed: 0.9, revealDelay: 0.18 },
                },
                at,
              )
              .call(() => el.classList.remove(styles.glitching), [], at + WORD_SECONDS);
          });
          return tl;
        };

        let current = gsap.timeline({ delay }).add(run('to', 0.2));

        const replay = () => {
          if (current.isActive()) return;
          current = gsap.timeline().add(run('from', 0.08)).add(run('to', 0.16), '+=0.45');
        };
        const el = root.current;
        el?.addEventListener('pointerenter', replay);

        return () => {
          el?.removeEventListener('pointerenter', replay);
          current.kill();
          words.forEach((w, i) => {
            w.textContent = slots[i].to;
            w.classList.remove(styles.glitching);
          });
        };
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <p ref={root} className={`${styles.root} ${className ?? ''}`}>
      <span className="u-sr">{to}</span>
      <span className={styles.ghost} aria-hidden="true">
        {to}
      </span>
      <span className={styles.live} aria-hidden="true">
        {slots.map((slot, i) => (
          <Fragment key={i}>
            <span className={styles.word}>{slot.to}</span>{' '}
          </Fragment>
        ))}
      </span>
    </p>
  );
}
