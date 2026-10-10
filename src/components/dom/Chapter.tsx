'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import styles from './Chapter.module.css';

/* ============================================================================
   CHAPTER

   The section shell. Owns the header rule that draws itself in as the
   chapter arrives — the one piece of motion every chapter shares, which is
   what makes five different layouts read as one document.

   The rule is its own element scaled on X rather than an animated
   border-bottom, so the whole reveal stays on the compositor.
   ========================================================================= */

type Props = {
  id: string;
  /** The section's heading — a real h2, not a numbered eyebrow label. */
  title: string;
  caption: string;
  children: ReactNode;
  className?: string;
  /** The whole shell — heading, rule and content as one composition — holds
      the viewport (sticky, full height) while the tall section scrolls
      underneath it. Holding only the content let it slide up over its own
      heading on the way in. */
  hold?: boolean;
};

export function Chapter({ id, title, caption, children, className, hold }: Props) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const head = ref.current?.querySelector<HTMLElement>(`.${styles.head}`);
      const rule = ref.current?.querySelector<HTMLElement>(`.${styles.rule}`);
      if (!head || !rule) return;

      const tl = gsap.timeline({
        scrollTrigger: { trigger: head, start: 'top 88%', once: true },
      });

      /* fromTo with the end state pinned, never `from`: a from-tween takes
         whatever the element shows when it is built as its resting state,
         and with reduced motion the setup ran twice, so the second build
         read the first one's hidden start as "rest" and every heading
         stayed invisible. */
      tl.fromTo(
        head.children,
        { yPercent: 70, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.06, ease: 'expo.out' },
      ).fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 1.3, ease: 'expo.inOut' }, 0);

      return () => {
        tl.scrollTrigger?.kill();
        tl.kill();
      };
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      id={id}
      className={`${styles.section} ${hold ? styles.holding : ''} ${className ?? ''}`}
    >
      <div className={styles.shell}>
        <header className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.caption}>{caption}</p>
        </header>
        <div className={styles.rule} aria-hidden="true" />
        {children}
      </div>
    </section>
  );
}
