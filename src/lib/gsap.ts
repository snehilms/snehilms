'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { useGSAP } from '@gsap/react';

/* Register once, at module scope, guarded for SSR. Every component imports
   gsap from HERE — never from 'gsap' directly — so registration can never
   be missed and plugin order can never race. */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, useGSAP);

  gsap.defaults({
    ease: 'power3.out',
    duration: 0.8,
  });

  /* Tell ScrollTrigger to trust our Lenis-driven RAF rather than scroll events. */
  ScrollTrigger.config({
    ignoreMobileResize: true,
  });
}

export { gsap, ScrollTrigger, SplitText, useGSAP };

/* Shared easing vocabulary — mirrors the CSS tokens so DOM transitions and
   GSAP tweens never disagree about what "out" means. */
export const EASE = {
  out: 'power3.out',
  inOut: 'power2.inOut',
  expo: 'expo.out',
  /* cubic-bezier(0.16, 1, 0.3, 1) — the --e-out token, exactly. */
  token: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

export const DUR = {
  fast: 0.24,
  base: 0.48,
  slow: 0.96,
  reveal: 1.2,
} as const;
