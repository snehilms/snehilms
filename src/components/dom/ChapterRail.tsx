'use client';

import { useRef, useState } from 'react';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { scrollTo } from './SmoothScroll';
import { chapters } from '@/config/content';
import { scrollState } from '@/lib/scrollState';
import styles from './ChapterRail.module.css';

/* ============================================================================
   CHAPTER RAIL

   Replaces the scrollbar we hid. Two things happen here, deliberately split
   by cost:

   - The fill line is scrubbed by ScrollTrigger directly onto a transform.
     It updates every frame and never touches React.
   - The active chapter is React state, because it changes five times in the
     whole page and the readability of declarative markup is worth more than
     the five renders.
   ========================================================================= */

export function ChapterRail() {
  const ref = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      // End state pinned (fromTo): see Chapter.
      gsap.fromTo(el, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 1, delay: 2.6, ease: 'expo.out' });

      const fillTrigger = ScrollTrigger.create({
        trigger: document.documentElement,
        start: 0,
        end: 'max',
        scrub: true,
        onUpdate: (self) => {
          gsap.set(fillRef.current, { scaleY: self.progress });
        },
      });

      /* Resolve the section elements by hand rather than passing selector
         strings. useGSAP scopes every selector string to `ref`, and these
         sections live outside it — a string here silently matches nothing. */
      const sectionTriggers = chapters
        .map((chapter, i) => {
          const section = document.getElementById(chapter.id);
          if (!section) return null;

          return ScrollTrigger.create({
            trigger: section,
            start: 'top 55%',
            end: 'bottom 55%',
            onToggle: (self) => {
              if (self.isActive) {
                setActive(i);
                scrollState.chapter = i;
              }
            },
          });
        })
        .filter((t): t is ScrollTrigger => t !== null);

      return () => {
        fillTrigger.kill();
        sectionTriggers.forEach((t) => t.kill());
      };
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={styles.root}>
      <div className={styles.track}>
        <div ref={fillRef} className={styles.fill} />
      </div>

      <ol className={styles.list}>
        {chapters.map((chapter, i) => (
          <li key={chapter.id}>
            <button
              className={`${styles.node} ${i === active ? styles.active : ''}`}
              onClick={() => scrollTo(`#${chapter.id}`)}
              aria-current={i === active ? 'true' : undefined}
              aria-label={chapter.title}
            >
              <span className={styles.tick} aria-hidden="true" />
              <span className={styles.label}>
                {chapter.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
