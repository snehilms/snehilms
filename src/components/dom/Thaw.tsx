'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { RevealText } from './RevealText';
import { about, chapters } from '@/config/content';
import styles from './Thaw.module.css';

/* ============================================================================
   THAW — 01 / ABOUT

   Two columns that move at different speeds. The stat rail is scrubbed on a
   slower parallax than the prose, which produces depth without a single
   extra element or blur pass.
   ========================================================================= */

export function Thaw() {
  const ref = useRef<HTMLDivElement>(null);
  const chapter = chapters[1];

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const rail = gsap.to(`.${styles.rail}`, {
          yPercent: -14,
          ease: 'none',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.8,
          },
        });

        const stats = gsap.from(`.${styles.stat}`, {
          yPercent: 55,
          opacity: 0,
          duration: 1,
          stagger: 0.09,
          ease: 'expo.out',
          scrollTrigger: { trigger: `.${styles.rail}`, start: 'top 82%', once: true },
        });

        // Each stat's hairline draws itself as the number lands.
        const rules = gsap.from(`.${styles.statRule}`, {
          scaleX: 0,
          duration: 1.2,
          stagger: 0.09,
          ease: 'expo.inOut',
          scrollTrigger: { trigger: `.${styles.rail}`, start: 'top 82%', once: true },
        });

        return () => {
          [rail, stats, rules].forEach((t) => {
            t.scrollTrigger?.kill();
            t.kill();
          });
        };
      });

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Chapter id={chapter.id} title={chapter.title} caption={chapter.caption}>
      <div ref={ref} className={styles.grid}>
        <div className={styles.prose}>
          <RevealText as="p" className={styles.lead} mode="lines" stagger={0.06}>
            {about.lead}
          </RevealText>

          {about.body.map((paragraph, i) => (
            <RevealText key={i} as="p" className={styles.body} mode="lines" stagger={0.045}>
              {paragraph}
            </RevealText>
          ))}
        </div>

        <aside className={styles.rail}>
          <dl className={styles.stats}>
            {about.stats.map((stat) => (
              <div key={stat.label} className={styles.stat}>
                <div className={styles.statRule} aria-hidden="true" />
                <dt className={styles.statValue}>{stat.value}</dt>
                <dd className="u-mono">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </Chapter>
  );
}
