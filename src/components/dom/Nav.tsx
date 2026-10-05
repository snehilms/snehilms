'use client';

import { useRef, useState } from 'react';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { scrollTo } from './SmoothScroll';
import { chapters, identity } from '@/config/content';
import styles from './Nav.module.css';

/* ============================================================================
   NAV

   Sits above the canvas but stays out of its way: the bar itself is
   transparent until the visitor leaves the hero, at which point a glass
   plane fades in behind it so text stays legible over bright particles.
   ========================================================================= */

export function Nav() {
  const ref = useRef<HTMLElement>(null);
  const [condensed, setCondensed] = useState(false);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      // Entrance is deferred past the preloader handoff.
      gsap.from(el, {
        yPercent: -140,
        opacity: 0,
        duration: 1.1,
        delay: 2.4,
        ease: 'expo.out',
      });

      const st = ScrollTrigger.create({
        start: 'top -80',
        end: 'max',
        onToggle: (self) => setCondensed(self.isActive),
      });

      return () => st.kill();
    },
    { scope: ref },
  );

  return (
    <header ref={ref} className={`${styles.root} ${condensed ? styles.condensed : ''}`}>
      <div className={styles.inner}>
        <button className={styles.brand} onClick={() => scrollTo('#signal')} aria-label="Back to top">
          <span className={styles.mark}>{identity.initials}</span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>{identity.name}</span>
            <span className="u-mono">{identity.role}</span>
          </span>
        </button>

        <nav className={styles.links} aria-label="Chapters">
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              className={styles.link}
              onClick={() => scrollTo(`#${chapter.id}`)}
            >
              <span className={styles.linkIndex}>{chapter.index}</span>
              <span className={styles.linkLabel}>{chapter.title}</span>
            </button>
          ))}
        </nav>

        <a className={styles.status} href={`mailto:${identity.email}`}>
          <span className={styles.pulse} aria-hidden="true" />
          <span className="u-mono">{identity.availability}</span>
        </a>
      </div>
    </header>
  );
}
