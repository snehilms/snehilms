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
  index: string;
  kicker: string;
  caption: string;
  children: ReactNode;
  className?: string;
  /** Stretches the inner shell to the section's full height so a sticky
      child has real scroll runway to stick over. Without this the shell is
      only as tall as its content and `position: sticky` has nothing to do. */
  stretch?: boolean;
};

export function Chapter({ id, index, kicker, caption, children, className, stretch }: Props) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const head = ref.current?.querySelector<HTMLElement>(`.${styles.head}`);
      const rule = ref.current?.querySelector<HTMLElement>(`.${styles.rule}`);
      if (!head || !rule) return;

      const tl = gsap.timeline({
        scrollTrigger: { trigger: head, start: 'top 88%', once: true },
      });

      tl.from(head.children, {
        yPercent: 70,
        opacity: 0,
        duration: 0.9,
        stagger: 0.06,
        ease: 'expo.out',
      }).from(rule, { scaleX: 0, duration: 1.3, ease: 'expo.inOut' }, 0);

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
      className={`${styles.section} ${stretch ? styles.stretched : ''} ${className ?? ''}`}
    >
      <div className={styles.shell}>
        <header className={styles.head}>
          <span className={styles.index}>{index}</span>
          <span className={styles.kicker}>{kicker}</span>
          <span className={styles.caption}>{caption}</span>
        </header>
        <div className={styles.rule} aria-hidden="true" />
        {children}
      </div>
    </section>
  );
}
