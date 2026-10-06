'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { identity, chapters } from '@/config/content';
import { scrollTo } from './SmoothScroll';
import styles from './Hero.module.css';

/* ============================================================================
   HERO — 00 / SIGNAL

   The only section that opens on a timed timeline rather than on scroll.
   It is choreographed against the preloader: the panels finish parting at
   roughly 2.3s, and the headline starts at 2.35s, so the two read as one
   continuous move instead of two separate animations.

   On scroll, everything here leaves on a scrub — the hero doesn't cut away,
   it recedes, which keeps the canvas continuous underneath.
   ========================================================================= */

const INTRO_START = 2.35;

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const lines = identity.headline.split('\n');

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { motion } = context.conditions as { motion: boolean; reduced: boolean };
              if (!motion) return;

          const tl = gsap.timeline({ delay: INTRO_START });

          /* Explicit start AND end values on every property, including y.
             The transform cache on these elements can be re-read between
             mount and the intro's start; a `from` tween then animates
             yPercent home on top of a stale pixel offset and leaves the line
             parked under its mask. Pinning both ends makes that impossible. */
          tl.fromTo(
            `.${styles.headlineLine} > span`,
            { yPercent: 116, y: 0 },
            { yPercent: 0, y: 0, duration: 1.35, stagger: 0.09, ease: 'expo.out' },
          )
            .fromTo(
              `.${styles.tagline}`,
              { yPercent: 40, y: 0, opacity: 0 },
              { yPercent: 0, y: 0, opacity: 1, duration: 1.1, ease: 'expo.out' },
              '-=0.95',
            )
            .fromTo(
              `.${styles.metaItem}`,
              { yPercent: 60, y: 0, opacity: 0 },
              { yPercent: 0, y: 0, opacity: 1, duration: 0.9, stagger: 0.07, ease: 'expo.out' },
              '-=0.85',
            )
            .fromTo(`.${styles.hint}`, { opacity: 0 }, { opacity: 1, duration: 0.8 }, '-=0.6');

          /* Departure. Scrubbed, so scroll position always maps to the exact
             same frame of the exit — no catching up, no overshoot. */
          const exit = gsap.to(`.${styles.parallax}`, {
            yPercent: -18,
            opacity: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: ref.current,
              start: 'top top',
              end: 'bottom 30%',
              scrub: 0.6,
            },
          });

          return () => {
            tl.kill();
            exit.scrollTrigger?.kill();
            exit.kill();
          };
        },
      );

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id={chapters[0].id} className={styles.root}>
      <div className={`${styles.shell} ${styles.parallax}`}>
        <div className={styles.top}>
          <span className={`u-mono ${styles.metaItem}`}>{chapters[0].index} — {chapters[0].kicker}</span>
          <span className={`u-mono ${styles.metaItem}`}>{chapters[0].caption}</span>
        </div>

        <h1 className={styles.headline}>
          {lines.map((line, i) => (
            <span key={i} className={styles.headlineLine}>
              <span>{line}</span>
            </span>
          ))}
        </h1>

        <div className={styles.bottom}>
          <p className={styles.tagline}>{identity.tagline}</p>

          <dl className={styles.meta}>
            <div className={styles.metaItem}>
              <dt className="u-mono">Based</dt>
              <dd>{identity.location}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt className="u-mono">Status</dt>
              <dd>{identity.availability}</dd>
            </div>
          </dl>
        </div>
      </div>

      <button className={styles.hint} onClick={() => scrollTo(`#${chapters[1].id}`)}>
        <span className="u-cue">Scroll to {chapters[1].title.toLowerCase()}</span>
        <span className={styles.hintTrack} aria-hidden="true">
          <span className={styles.hintBead} />
        </span>
      </button>
    </section>
  );
}
