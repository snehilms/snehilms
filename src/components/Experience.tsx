'use client';

import dynamic from 'next/dynamic';

import { SmoothScroll } from './dom/SmoothScroll';
import { Scrim } from './dom/Scrim';
import { Preloader } from './dom/Preloader';
import { Dossier } from './dom/Dossier';
import { Nav } from './dom/Nav';
import { ChapterRail } from './dom/ChapterRail';
import { Hero } from './dom/Hero';
import { Thaw } from './dom/Thaw';
import { Archive } from './dom/Archive';
import { Strata } from './dom/Strata';
import { SocialStage } from './dom/SocialStage';
import { SystemToggles } from './dom/SystemToggles';

/* The canvas is client-only: GPUComputationRenderer needs a live WebGL
   context, and rendering a placeholder on the server then hydrating over it
   would cost a full extra paint of the most expensive element on the page. */
const Scene = dynamic(() => import('./canvas/Scene').then((m) => m.Scene), {
  ssr: false,
});

/* ============================================================================
   EXPERIENCE

   Composition root. Order is deliberate:

   Scene first so the canvas is the bottom paint layer, then the scrim that
   makes text survivable over it, then the DOM chapters, then the fixed
   chrome, the cursor, and the preloader on top until it hands off.
   ========================================================================= */

export function Experience() {
  return (
    <SmoothScroll>
      <Scene />
      <Scrim />

      <main>
        <Hero />
        <Thaw />
        <Archive />
        <Strata />
        <SocialStage />
      </main>

      <Nav />
      <ChapterRail />
      <SystemToggles />
      <Dossier />
      <Preloader />
    </SmoothScroll>
  );
}
