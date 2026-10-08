'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { RevealText } from './RevealText';
import { identity, chapters } from '@/config/content';
import styles from './Surface.module.css';

/* ============================================================================
   SURFACE — 04 / CONTACT

   The ascent. The particle ring opens behind this section while the DOM
   resolves to a single action. The socials and the colophon follow in the
   stage below (SocialStage), which is where the descent ends.

   The email link is magnetic: it leans toward the pointer inside a
   generous hit area, then springs back on exit. Elastic on the return is
   doing real work here — it is the only place on the page that overshoots,
   which is what makes the one interactive target feel physical.
   ========================================================================= */

const MAGNET_STRENGTH = 0.32;

function MagneticLink({ href, children }: { href: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia('(hover: none)').matches) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const moveX = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power3.out' });
      const moveY = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3.out' });

      const onMove = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        moveX((e.clientX - (rect.left + rect.width / 2)) * MAGNET_STRENGTH);
        moveY((e.clientY - (rect.top + rect.height / 2)) * MAGNET_STRENGTH);
      };

      const onLeave = () => {
        gsap.to(el, { x: 0, y: 0, duration: 1.1, ease: 'elastic.out(1, 0.35)' });
      };

      const zone = el.parentElement ?? el;
      zone.addEventListener('pointermove', onMove);
      zone.addEventListener('pointerleave', onLeave);

      return () => {
        zone.removeEventListener('pointermove', onMove);
        zone.removeEventListener('pointerleave', onLeave);
      };
    },
    { scope: ref },
  );

  return (
    <a ref={ref} className={styles.email} href={href} data-cursor="hover">
      {children}
    </a>
  );
}

export function Surface() {
  const chapter = chapters[4];

  return (
    <Chapter id={chapter.id} title={chapter.title} caption={chapter.caption}>
      <div className={styles.cta}>
        <RevealText as="p" className={styles.prompt} mode="lines">
          Working on something that has to hold under load?
        </RevealText>

        <div className={styles.magnetZone}>
          <MagneticLink href={`mailto:${identity.email}`}>{identity.email}</MagneticLink>
        </div>
      </div>
    </Chapter>
  );
}
