'use client';

import { useRef, useState } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { scrollState } from '@/lib/scrollState';
import { identity } from '@/config/content';
import styles from './Preloader.module.css';

/* ============================================================================
   PRELOADER

   Buys the GPGPU simulation its first ~1.5s of warm-up while giving the
   visitor something deliberate to watch. The counter is tweened, not tied to
   real load progress — honest progress bars on a site this light finish in
   180ms and read as a flicker.

   Scroll is locked for the duration, then handed over in one motion.
   ========================================================================= */

export function Preloader() {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const [done, setDone] = useState(false);

  useGSAP(
    () => {
      const counter = counterRef.current;
      if (!counter) return;

      document.documentElement.style.overflow = 'hidden';

      const value = { n: 0 };
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        onComplete: () => {
          document.documentElement.style.overflow = '';
          scrollState.ready = true;
          setDone(true);
        },
      });

      if (reduced) {
        document.documentElement.style.overflow = '';
        scrollState.ready = true;
        setDone(true);
        return;
      }

      tl.to(value, {
        n: 100,
        duration: 1.9,
        ease: 'power2.inOut',
        onUpdate: () => {
          counter.textContent = String(Math.round(value.n)).padStart(3, '0');
        },
      })
        .to(barRef.current, { scaleX: 1, duration: 1.9, ease: 'power2.inOut' }, 0)
        .to(`.${styles.line}`, { yPercent: -110, duration: 0.7, stagger: 0.05, ease: 'expo.in' }, '>-0.1')
        // Two panels part like a shelf splitting rather than a single fade.
        .to(
          `.${styles.panel}`,
          { scaleY: 0, duration: 1.0, stagger: 0.08, ease: 'expo.inOut', transformOrigin: 'top center' },
          '<0.2',
        )
        .set(rootRef.current, { pointerEvents: 'none' });

      return () => {
        document.documentElement.style.overflow = '';
      };
    },
    { scope: rootRef },
  );

  if (done) return null;

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.panels}>
        <div className={styles.panel} />
        <div className={styles.panel} />
        <div className={styles.panel} />
        <div className={styles.panel} />
      </div>

      <div className={styles.content}>
        <div className={styles.meta}>
          <span className={`u-mono ${styles.line}`}>{identity.name}</span>
          <span className={`u-mono ${styles.line}`}>Cryo Archive · Rev 04</span>
        </div>

        <div className={styles.readout}>
          <span ref={counterRef} className={styles.counter}>
            000
          </span>
          <span className={`u-mono ${styles.line}`}>Thawing</span>
        </div>

        <div className={styles.track}>
          <div ref={barRef} className={styles.bar} />
        </div>
      </div>
    </div>
  );
}
