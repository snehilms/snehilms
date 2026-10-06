'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import styles from './MistText.module.css';

/* ============================================================================
   MIST TEXT

   Cycles through a list the way breath clears on cold glass: the current
   line lifts and blurs away letter by letter, and the next condenses out of
   the blur in the same order, so the two overlap in one continuous drift.
   Calm on purpose — it repeats for as long as the hero is up, so it must
   never compete with the one-off glitch on the motto below it.

   Two stacked slots (A/B) swap roles each cycle, so the outgoing and
   incoming lines can overlap without reflowing anything. The server renders
   the first item; screen readers get the whole list once.
   ========================================================================= */

const HOLD = 2.6; // seconds a line stays fully resolved
const STAGGER = 0.028;

type Props = {
  items: readonly string[];
  /** Seconds after mount before the first change. */
  delay: number;
  className?: string;
};

function fill(slot: HTMLElement, text: string) {
  slot.replaceChildren(
    ...[...text].map((ch) => {
      const span = document.createElement('span');
      span.className = styles.char;
      span.textContent = ch === ' ' ? ' ' : ch;
      return span;
    }),
  );
}

export function MistText({ items, delay, className }: Props) {
  const root = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || items.length < 2) return;
      let front = el.querySelector<HTMLElement>(`.${styles.slotA}`)!;
      let back = el.querySelector<HTMLElement>(`.${styles.slotB}`)!;
      let index = 0;
      let call: gsap.core.Tween | undefined;
      let current: gsap.core.Timeline | undefined;

      const mm = gsap.matchMedia();
      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { motion } = context.conditions as { motion: boolean };
          fill(front, items[index]);
          back.replaceChildren();

          const change = () => {
            index = (index + 1) % items.length;
            fill(back, items[index]);
            const out = front.querySelectorAll(`.${styles.char}`);
            const into = back.querySelectorAll(`.${styles.char}`);

            current = gsap.timeline({
              onComplete: () => {
                front.replaceChildren();
                [front, back] = [back, front];
              },
            });

            if (!motion) {
              current
                .to(out, { opacity: 0, duration: 0.3, ease: 'power1.out' })
                .fromTo(into, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.in' }, '<0.15');
              return;
            }

            current
              .to(out, {
                opacity: 0,
                yPercent: -40,
                filter: 'blur(8px)',
                duration: 0.55,
                stagger: STAGGER,
                ease: 'power2.in',
              })
              .fromTo(
                into,
                { opacity: 0, yPercent: 45, filter: 'blur(10px)' },
                {
                  opacity: 1,
                  yPercent: 0,
                  filter: 'blur(0px)',
                  duration: 0.9,
                  stagger: STAGGER,
                  ease: 'expo.out',
                },
                0.32,
              );
          };

          const loop = () => {
            change();
            call = gsap.delayedCall(HOLD + 1, loop);
          };
          call = gsap.delayedCall(delay, loop);

          return () => {
            call?.kill();
            current?.kill();
          };
        },
      );

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <span ref={root} className={`${styles.root} ${className ?? ''}`}>
      <span className="u-sr">{items.join(', ')}</span>
      <span className={styles.stage} aria-hidden="true">
        <span className={styles.slotA}>{items[0]}</span>
        <span className={styles.slotB} />
      </span>
    </span>
  );
}
