'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import styles from './Cursor.module.css';

/* ============================================================================
   CURSOR

   A ring that trails the pointer and swells over interactive elements, and
   shrinks out of the way over the ice crystals ([data-cursor="inspect"]).

   Driven by gsap.quickTo rather than a tween-per-move: quickTo reuses one
   tween instance and just retargets it, so a pointermove at 1000Hz costs
   nothing. Positioning is transform-only against a top-left origin, so this
   never touches layout.
   ========================================================================= */

export function Cursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const isTouch = useDeviceTier().isTouch;

  useGSAP(
    () => {
      if (isTouch) return;

      const ring = ringRef.current;
      const dot = dotRef.current;
      if (!ring || !dot) return;

      gsap.set([ring, dot], { xPercent: -50, yPercent: -50, opacity: 0 });

      // The ring lags; the dot is exact. That difference is the whole effect.
      const ringX = gsap.quickTo(ring, 'x', { duration: 0.52, ease: 'power3.out' });
      const ringY = gsap.quickTo(ring, 'y', { duration: 0.52, ease: 'power3.out' });
      const dotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power2.out' });
      const dotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power2.out' });

      let visible = false;

      const onMove = (e: PointerEvent) => {
        if (!visible) {
          visible = true;
          gsap.to([ring, dot], { opacity: 1, duration: 0.3 });
        }
        ringX(e.clientX);
        ringY(e.clientY);
        dotX(e.clientX);
        dotY(e.clientY);
      };

      const onLeave = () => {
        visible = false;
        gsap.to([ring, dot], { opacity: 0, duration: 0.2 });
      };

      // Delegated hover detection — works for content added after mount.
      const onOver = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        /* Over an ice crystal the ring steps aside: small, faint and without
           its frosted fill, so the hover mesh drawn around the pointer reads. */
        const inspect = !!target?.closest('[data-cursor="inspect"]');
        ring.classList.toggle(styles.clear, inspect);
        const interactive = !inspect && target?.closest('a, button, [data-cursor="hover"]');
        gsap.to(ring, {
          scale: inspect ? 0.5 : interactive ? 2.1 : 1,
          opacity: inspect ? 0.45 : 1,
          borderColor: interactive
            ? 'rgba(127, 212, 255, 0.85)'
            : 'rgba(191, 226, 247, 0.34)',
          duration: 0.4,
          ease: 'power3.out',
        });
      };

      const onDown = () => gsap.to(ring, { scale: 0.82, duration: 0.18 });
      const onUp = () => gsap.to(ring, { scale: 1, duration: 0.32 });

      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerover', onOver, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      document.addEventListener('pointerleave', onLeave);

      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerover', onOver);
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointerleave', onLeave);
      };
    },
    { dependencies: [isTouch] },
  );

  if (isTouch) return null;

  return (
    <div className={styles.root} aria-hidden="true">
      <div ref={ringRef} className={styles.ring} />
      <div ref={dotRef} className={styles.dot} />
    </div>
  );
}
