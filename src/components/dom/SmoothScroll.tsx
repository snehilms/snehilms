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
    let lastUpdate = 0;
    const st = ScrollTrigger.create({
      trigger: document.documentElement,
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        scrollState.progress = self.progress;
        scrollState.velocity = gsap.utils.clamp(-1, 1, self.getVelocity() / 3000);
        lastUpdate = performance.now();
      },
    });

    /* onUpdate only fires while scrolling, so the last velocity it wrote
       would stick after the page stops, leaving the field's turbulence raised.
       Once updates stop, bleed velocity back to zero. */
    const settle = (_time: number, deltaMs: number) => {
      if (performance.now() - lastUpdate < 90) return;
      scrollState.velocity *= Math.exp(-(deltaMs / 1000) * 9);
      if (Math.abs(scrollState.velocity) < 0.001) scrollState.velocity = 0;
    };
    gsap.ticker.add(settle);

    const onResize = () => ScrollTrigger.refresh();
    window.addEventListener('resize', onResize);

    /* Re-measure whenever the page's height changes, not just the window.
       The held Experience chapter grows from its list height to four
       screens after its triggers exist; under reduced motion nothing else
       re-measured, so its triggers kept the list's span and the held
       stations never showed. Debounced, and only on a real change. */
    let height = document.body.scrollHeight;
    let pending = 0;
    const grew = new ResizeObserver(() => {
      const h = document.body.scrollHeight;
      if (Math.abs(h - height) < 1) return;
      height = h;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    });
    grew.observe(document.body);

    return () => {
      st.kill();
      gsap.ticker.remove(settle);
      window.removeEventListener('resize', onResize);
      grew.disconnect();
      window.clearTimeout(pending);
    };
  }, []);

  /* Chapter-space probe.

     Measures where every chapter is "on" once per refresh, then maps the
     viewport centre onto that ladder. The result is piecewise-linear in
     chapter units, so "formation 2 is fully formed" and "chapter 2 is on
     screen" are the same instant regardless of how tall any section is.

     A chapter is on at its centre, except one marked data-span="whole" (the
     Experience chapter, held or listed): it is on for its whole length, so
     chapterT stays flat at its index there and the chapter's own progress
     drives what happens inside it. */
  useEffect(() => {
    let spans: [number, number][] = [];

    const measure = () => {
      const half = window.innerHeight / 2;
      spans = chapters.map((chapter) => {
        const el = document.getElementById(chapter.id);
        if (!el) return [0, 0];
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        if (el.dataset.span === 'whole') return [top + half, top + rect.height - half];
        const centre = top + rect.height / 2;
        return [centre, centre];
      });
    };

    const compute = () => {
      if (spans.length < 2) return 0;

      const focus = window.scrollY + window.innerHeight / 2;
      if (focus <= spans[0][1]) return 0;
      for (let i = 0; i < spans.length; i++) {
        const [a, b] = spans[i];
        if (focus >= a && focus <= b) return i;
        const next = spans[i + 1];
        if (next && focus > b && focus < next[0]) {
          const span = next[0] - b;
          return span <= 0 ? i : i + (focus - b) / span;
        }
      }
      return spans.length - 1;
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
    // A held chapter starts at its top: that is where its story begins.
    const held = destination.dataset.layout === 'pinned';
    y =
      !held && rect.height > window.innerHeight * 1.25
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
