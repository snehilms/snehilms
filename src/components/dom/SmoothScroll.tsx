'use client';

import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { scrollState } from '@/lib/scrollState';
import { chapters } from '@/config/content';
import { useDeviceTier } from '@/hooks/useDeviceTier';

/* ============================================================================
   SMOOTH SCROLL

   One RAF loop for the whole application. Lenis is driven BY gsap.ticker
   rather than its own requestAnimationFrame, so Lenis, ScrollTrigger and
   the R3F render loop all advance on the same clock. Two RAF loops fighting
   each other is the single most common cause of jitter in sites like this.
   ========================================================================= */

/* Module-scope handle so nav / rail can drive scrolling imperatively
   without prop-drilling a ref through the tree. */
let lenisInstance: Lenis | null = null;

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const { reducedMotion } = useDeviceTier();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      // Honour the OS setting: native scroll, no interpolation, no hijack.
      ScrollTrigger.refresh();
      return;
    }

    const lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      smoothWheel: true,
      syncTouch: false,
    });
    lenisRef.current = lenis;
    lenisInstance = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
      lenisInstance = null;
    };
  }, [reducedMotion]);

  /* Global progress probe. Writes straight into the mutable store —
     zero React renders, readable from useFrame at 60fps. */
  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: document.documentElement,
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        scrollState.progress = self.progress;
        scrollState.velocity = gsap.utils.clamp(-1, 1, self.getVelocity() / 3000);
      },
    });

    const onResize = () => ScrollTrigger.refresh();
    window.addEventListener('resize', onResize);

    return () => {
      st.kill();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  /* Chapter-space probe.

     Measures the centre of every chapter section once per refresh, then maps
     the viewport centre onto that ladder. The result is piecewise-linear in
     chapter units, so "formation 2 is fully formed" and "chapter 2 is on
     screen" are the same instant regardless of how tall any section is. */
  useEffect(() => {
    let centres: number[] = [];

    const measure = () => {
      centres = chapters.map((chapter) => {
        const el = document.getElementById(chapter.id);
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return rect.top + window.scrollY + rect.height / 2;
      });
    };

    const compute = () => {
      if (centres.length < 2) return 0;

      const focus = window.scrollY + window.innerHeight / 2;
      if (focus <= centres[0]) return 0;
      if (focus >= centres[centres.length - 1]) return centres.length - 1;

      for (let i = 0; i < centres.length - 1; i++) {
        const a = centres[i];
        const b = centres[i + 1];
        if (focus >= a && focus <= b) {
          const span = b - a;
          return span === 0 ? i : i + (focus - a) / span;
        }
      }
      return 0;
    };

    measure();
    scrollState.chapterT = compute();

    const st = ScrollTrigger.create({
      trigger: document.documentElement,
      start: 0,
      end: 'max',
      onUpdate: () => {
        scrollState.chapterT = compute();
      },
      onRefresh: () => {
        measure();
        scrollState.chapterT = compute();
      },
    });

    ScrollTrigger.addEventListener('refresh', measure);

    return () => {
      st.kill();
      ScrollTrigger.removeEventListener('refresh', measure);
    };
  }, []);

  /* Pointer probe, normalised to -1..1, also outside React. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      scrollState.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      scrollState.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return <>{children}</>;
}

/* Imperative scroll-to for the nav and the chapter rail.
   Routed through Lenis so the easing matches every other scroll in the
   app; falls back to native behaviour when Lenis is disabled. */
export function scrollTo(target: string | number) {
  const destination =
    typeof target === 'number'
      ? target
      : (document.querySelector(target) as HTMLElement | null);

  if (destination === null) return;

  /* Sections taller than the viewport are scrolled to their CENTRE, not
     their top. The archive is more than two screens tall; landing on its
     top edge would show the chapter heading and none of the gallery. */
  let y: number;

  if (typeof destination === 'number') {
    y = destination;
  } else {
    const rect = destination.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    y =
      rect.height > window.innerHeight * 1.25
        ? top + rect.height / 2 - window.innerHeight / 2
        : top;
  }

  if (lenisInstance) {
    lenisInstance.scrollTo(y, { duration: 1.4, easing: easeInOutExpo });
    return;
  }

  window.scrollTo({ top: y, behavior: 'smooth' });
}

/* Matches --e-in-out closely enough that DOM and scroll motion read as one. */
const easeInOutExpo = (t: number) =>
  t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
