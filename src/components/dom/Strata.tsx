'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { strata, chapters } from '@/config/content';
import styles from './Strata.module.css';

/* ============================================================================
   STRATA — 03 / STACK

   Skills read as a core sample: surface layers first, bedrock last. The
   particle field is holding its own banded formation behind this section,
   so the DOM bands and the WebGL bands are describing the same object.

   Each band's depth bar scrubs its own fill against scroll, which makes the
   section feel like it is being drilled rather than scrolled past.
   ========================================================================= */

export function Strata() {
  const ref = useRef<HTMLDivElement>(null);
  const chapter = chapters[3];

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const rows = gsap.utils.toArray<HTMLElement>(`.${styles.band}`);

        const tweens = rows.map((row) => {
          const bar = row.querySelector(`.${styles.barFill}`);
          const chips = row.querySelectorAll(`.${styles.chip}`);

          const tl = gsap.timeline({
            scrollTrigger: { trigger: row, start: 'top 84%', once: true },
          });

          tl.from(row.querySelector(`.${styles.bandMeta}`), {
            xPercent: -24,
            opacity: 0,
            duration: 1,
            ease: 'expo.out',
          })
            .from(bar, { scaleY: 0, duration: 1.3, ease: 'expo.inOut' }, 0)
            .from(
              chips,
              { yPercent: 70, opacity: 0, duration: 0.7, stagger: 0.035, ease: 'expo.out' },
              0.15,
            );

          return tl;
        });

        return () => {
          tweens.forEach((tl) => {
            tl.scrollTrigger?.kill();
            tl.kill();
          });
        };
      });

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Chapter id={chapter.id} index={chapter.index} kicker={chapter.kicker} caption={chapter.caption}>
      <div ref={ref} className={styles.core}>
        {strata.map((layer, i) => (
          <div key={layer.label} className={styles.band}>
            <div className={styles.bar} aria-hidden="true">
              <div className={styles.barFill} data-layer={i} />
            </div>

            <div className={styles.bandMeta}>
              <span className={`u-mono ${styles.depth}`}>{layer.depth}</span>
              <h3 className={styles.bandLabel}>{layer.label}</h3>
            </div>

            <ul className={styles.chips}>
              {layer.items.map((item) => (
                <li key={item} className={styles.chip}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Chapter>
  );
}
