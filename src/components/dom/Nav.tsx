'use client';

import { useRef, useState } from 'react';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { scrollTo } from './SmoothScroll';
import { chapters, socialsSection } from '@/config/content';
import styles from './Nav.module.css';

/* ============================================================================
   NAV

   Sits above the canvas but stays out of its way: the chapter links alone,
   centred (no brand mark, name or status pill: owner's call). The bar is
   transparent until the visitor leaves the hero, at which point a glass
   plane fades in behind it so the links stay legible over bright particles.
   ========================================================================= */

export function Nav() {
  const ref = useRef<HTMLElement>(null);
  const [condensed, setCondensed] = useState(false);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      // Entrance is deferred past the preloader handoff.
      // End state pinned (fromTo): see Chapter.
      gsap.fromTo(
        el,
        { yPercent: -140, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.1, delay: 2.4, ease: 'expo.out' },
      );

      const st = ScrollTrigger.create({
        start: 'top -80',
        // One past max: at exactly 'max' the trigger deactivates on the last
        // pixel and the bar lost its frost under the footer.
        end: () => ScrollTrigger.maxScroll(window) + 1,
        onToggle: (self) => setCondensed(self.isActive),
      });

      return () => st.kill();
    },
    { scope: ref },
  );

  return (
    <header ref={ref} className={`${styles.root} ${condensed ? styles.condensed : ''}`}>
      <div className={styles.inner}>
        <nav className={styles.links} aria-label="Chapters">
          {[...chapters, socialsSection].map((section) => (
            <button
              key={section.id}
              className={styles.link}
              onClick={() => scrollTo(`#${section.id}`)}
            >
              <span className={styles.linkLabel}>{section.title}</span>
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
