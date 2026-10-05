'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { RevealText } from './RevealText';
import { identity, socials, chapters } from '@/config/content';
import styles from './Surface.module.css';

/* ============================================================================
   SURFACE — 04 / CONTACT

   The ascent. The particle ring opens behind this section while the DOM
   resolves to a single action.

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
  const ref = useRef<HTMLDivElement>(null);
  const chapter = chapters[4];

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const links = gsap.from(`.${styles.social}`, {
          yPercent: 80,
          opacity: 0,
          duration: 0.9,
          stagger: 0.06,
          ease: 'expo.out',
          scrollTrigger: { trigger: `.${styles.socials}`, start: 'top 88%', once: true },
        });

        const colophon = gsap.from(`.${styles.colophonItem}`, {
          opacity: 0,
          y: 20,
          duration: 0.8,
          stagger: 0.05,
          ease: 'power3.out',
          scrollTrigger: { trigger: `.${styles.colophon}`, start: 'top 90%', once: true },
        });

        return () => {
          [links, colophon].forEach((t) => {
            t.scrollTrigger?.kill();
            t.kill();
          });
        };
      });

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Chapter id={chapter.id} index={chapter.index} kicker={chapter.kicker} caption={chapter.caption}>
      <div ref={ref} className={styles.root}>
        <div className={styles.cta}>
          <RevealText as="p" className={styles.prompt} mode="lines">
            Working on something that has to hold under load?
          </RevealText>

          <div className={styles.magnetZone}>
            <MagneticLink href={`mailto:${identity.email}`}>{identity.email}</MagneticLink>
          </div>
        </div>

        <ul className={styles.socials}>
          {socials.map((social) => (
            <li key={social.label}>
              <a
                className={styles.social}
                href={social.href}
                target={social.href.startsWith('mailto:') ? undefined : '_blank'}
                rel="noreferrer"
              >
                <span>{social.label}</span>
                <span className={styles.socialArrow} aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>

        {/* The design story, stated plainly rather than left implied. */}
        <footer className={styles.colophon}>
          <div className={styles.colophonItem}>
            <span className="u-mono">Concept</span>
            <p>
              A core sample taken through an ice shelf. Five chapters, five formations, one
              continuous descent — signal, thaw, archive, strata, surface.
            </p>
          </div>

          <div className={styles.colophonItem}>
            <span className="u-mono">Built with</span>
            <p>
              Next.js · React Three Fiber · GSAP ScrollTrigger · GPGPU particle simulation ·
              custom GLSL
            </p>
          </div>

          <div className={styles.colophonItem}>
            <span className="u-mono">Field</span>
            <p>
              65,536 particles, simulated entirely on the GPU across two ping-ponged float
              textures, rendered in a single draw call.
            </p>
          </div>

          <div className={styles.colophonLine}>
            <span className="u-mono">© {new Date().getFullYear()} {identity.name}</span>
            <span className="u-mono">{identity.location}</span>
          </div>
        </footer>
      </div>
    </Chapter>
  );
}
