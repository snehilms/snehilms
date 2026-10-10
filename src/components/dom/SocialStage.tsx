'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { scrollState } from '@/lib/scrollState';
import { socialState } from '@/lib/socialState';
import { identity, socials, socialsSection } from '@/config/content';
import { scrollTo } from './SmoothScroll';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import styles from './SocialStage.module.css';

const StageCanvas = dynamic(
  () => import('../socials/StageCanvas').then((m) => m.StageCanvas),
  { ssr: false },
);

/* ============================================================================
   SOCIAL STAGE

   The descent ends in a lit chamber. One mark built from beads stands on a
   pedestal; scrolling steps it through GitHub, LinkedIn, X and Email, each
   change tearing the mark apart and re-forming it.

   The selector, by input:
   - pointer: hover previews a mark; click opens it (hover already made it
     the active one).
   - keyboard: focus previews; Enter opens.
   - touch: there is no hover, so the first tap jumps the stage to that mark
     and a second tap opens it.
   A name with no href (X, until there is a handle) only ever selects.

   Choreography, all on scroll:
   - entrance (scrubbed): the background field thins out, the beads condense
     into the first mark, the selector rises in.
   - pinned (scrubbed, snapping): the stage holds the viewport while scroll
     walks the marks; snap settles it on a whole mark, never between two.
   - exit (scrubbed): as the footer arrives, the background field returns.

   Every value the canvas reads is written by a tween on a plain object, not
   by an onUpdate callback, so a scrub reversing past either end leaves the
   right value behind instead of the last one it happened to write.
   ========================================================================= */

const GLYPHS = socials.map((s) => s.glyph);

function ArrowIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SocialStage() {
  const root = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const row = useRef<HTMLUListElement>(null);
  const bead = useRef<HTMLSpanElement>(null);
  const footer = useRef<HTMLElement>(null);

  /* The selector's active item changes a handful of times per visit, so it
     is real React state; the canvas reads the same fact from socialState. */
  const { simSize } = useDeviceTier();
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const show = (i: number) => {
    if (activeRef.current === i) return;
    activeRef.current = i;
    setActive(i);
  };

  /* Set by the pinned walk once it exists; the selector jumps through it. */
  const pinned = useRef<ScrollTrigger | null>(null);
  /* Last pointer type, so a touch tap's synthetic focus is not mistaken for
     a keyboard preview (which would make the first tap navigate). */
  const touch = useRef(false);

  const focusOn = (i: number) => {
    socialState.focus = i;
    show(i);
  };

  const jump = (i: number) => {
    socialState.focus = -1;
    show(i);
    const st = pinned.current;
    if (st) {
      const steps = socials.length - 1;
      scrollTo(st.start + (i / steps) * (st.end - st.start));
    } else {
      // Reduced motion: no pin, so the mark is selected directly.
      socialState.scrollIndex = i;
    }
  };

  const onSelect = (e: React.MouseEvent, i: number) => {
    if (i === activeRef.current && socials[i].href) return; // open it
    e.preventDefault();
    jump(i);
  };
  const release = (i: number) => {
    if (socialState.focus !== i) return;
    socialState.focus = -1;
    show(Math.round(socialState.scrollIndex));
  };

  /* One bead — a single particle off the stage — marks the active name and
     glides under the next one. Moved by transform, centred on the name. */
  useLayoutEffect(() => {
    const list = row.current;
    const item = list?.children[active] as HTMLElement | undefined;
    const dot = bead.current;
    if (!list || !item || !dot) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const x = item.offsetLeft + item.offsetWidth / 2 - dot.offsetWidth / 2;
    gsap.to(dot, { x, duration: reduce ? 0 : 0.7, ease: 'expo.out', overwrite: true });
  }, [active]);

  useGSAP(
    () => {
      const stage = section.current;
      const foot = footer.current;
      if (!stage || !foot) return;
      const steps = socials.length - 1;
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const entrance = gsap.timeline({
          scrollTrigger: { trigger: stage, start: 'top bottom', end: 'top top', scrub: true },
        });
        entrance
          .fromTo(scrollState, { stage: 0 }, { stage: 1, ease: 'none' }, 0)
          .fromTo(socialState, { assemble: 0 }, { assemble: 1, ease: 'power1.out' }, 0)
          .fromTo(
            `.${styles.selector}`,
            { opacity: 0, y: 40 },
            { opacity: 1, y: 0, ease: 'power2.out', duration: 0.45 },
            0.55,
          );

        const walk = gsap.fromTo(
          socialState,
          { scrollIndex: 0 },
          {
            scrollIndex: steps,
            ease: 'none',
            onUpdate: () => {
              if (socialState.focus < 0) show(Math.round(socialState.scrollIndex));
            },
            scrollTrigger: {
              trigger: stage,
              start: 'top top',
              end: `+=${steps * 75}%`,
              pin: true,
              scrub: 0.6,
              snap: {
                snapTo: 1 / steps,
                duration: { min: 0.25, max: 0.7 },
                delay: 0.05,
                ease: 'power2.inOut',
              },
            },
          },
        );

        /* Anchored to the pin's own end, not to the footer: measured from the
           footer, the trigger can resolve before the pin spacer exists and
           bring the field back while the stage is still on screen. */
        const walkTrigger = walk.scrollTrigger!;
        pinned.current = walkTrigger;
        const exit = gsap.timeline({
          scrollTrigger: {
            start: () => walkTrigger.end,
            end: () => walkTrigger.end + foot.offsetHeight,
            scrub: true,
          },
        });
        exit
          .fromTo(scrollState, { stage: 1, outro: 0 }, { stage: 0, outro: 1, ease: 'none', immediateRender: false }, 0)
          // The selector's fog veil only exists to lift it off the chamber
          // floor; leaving, it would be clipped by the section's edge.
          .fromTo(`.${styles.selector}`, { '--veil': 1 }, { '--veil': 0, ease: 'none', immediateRender: false }, 0);

        const colophon = gsap.from(`.${styles.colophonItem}`, {
          opacity: 0,
          y: 24,
          duration: 0.8,
          stagger: 0.06,
          ease: 'power3.out',
          scrollTrigger: { start: () => walkTrigger.end + window.innerHeight * 0.1, once: true },
        });

        return () => {
          pinned.current = null;
          [entrance, walk, exit, colophon].forEach((t) => {
            t.scrollTrigger?.kill();
            t.kill();
          });
        };
      });

      /* Reduced motion: no pin, no scrub. The mark is simply there, and the
         selector alone moves between socials. */
      mm.add('(prefers-reduced-motion: reduce)', () => {
        socialState.assemble = 1;
        const presence = gsap.timeline({
          scrollTrigger: {
            trigger: stage,
            start: 'top 60%',
            end: 'bottom 40%',
            onToggle: (self) => {
              scrollState.stage = self.isActive ? 1 : 0;
            },
          },
        });
        return () => {
          presence.scrollTrigger?.kill();
          presence.kill();
          scrollState.stage = 0;
        };
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  const current = socials[active];

  return (
    <div ref={root}>
      <section ref={section} id={socialsSection.id} className={styles.stage} aria-labelledby="socials-title">
        <StageCanvas glyphs={GLYPHS} />

        <h2 id="socials-title" className="u-sr">
          {socialsSection.title}
        </h2>

        <div className={styles.selector}>
          <div className={styles.rowWrap}>
            <span ref={bead} className={styles.bead} aria-hidden="true" />
            <ul ref={row} className={styles.row}>
              {socials.map((social, i) => {
                const handlers = {
                  'aria-current': i === active ? ('true' as const) : undefined,
                  onPointerDown: (e: React.PointerEvent) => {
                    touch.current = e.pointerType === 'touch';
                  },
                  onPointerEnter: (e: React.PointerEvent) => {
                    if (e.pointerType !== 'touch') focusOn(i);
                  },
                  onPointerLeave: () => release(i),
                  onFocus: () => {
                    if (!touch.current) focusOn(i);
                  },
                  onBlur: () => release(i),
                  onClick: (e: React.MouseEvent) => onSelect(e, i),
                };
                return (
                  <li key={social.label}>
                    {social.href ? (
                      <a
                        className={styles.link}
                        href={social.href}
                        target={social.href.startsWith('mailto:') ? undefined : '_blank'}
                        rel="noreferrer"
                        {...handlers}
                      >
                        {social.label}
                        <span className="u-sr">, {social.handle}</span>
                      </a>
                    ) : (
                      <button type="button" className={styles.link} {...handlers}>
                        {social.label}
                        <span className="u-sr">, {social.handle}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {current.href ? (
            <a
              className={styles.handle}
              href={current.href}
              target={current.href.startsWith('mailto:') ? undefined : '_blank'}
              rel="noreferrer"
              tabIndex={-1}
              aria-hidden="true"
            >
              <span>{current.handle}</span>
              <ArrowIcon />
            </a>
          ) : (
            <span className={styles.handle} aria-hidden="true">
              {current.handle}
            </span>
          )}
        </div>
      </section>

      {/* The design story, stated plainly rather than left implied. */}
      <footer ref={footer} className={styles.colophon}>
        <div className={styles.colophonGrid}>
          <p className={styles.colophonItem}>
            <strong>Concept.</strong> A core sample taken through an ice shelf. Five chapters,
            five particle formations, one continuous descent, ending in a lit chamber.
          </p>

          <p className={styles.colophonItem}>
            <strong>Built with</strong> Next.js, React Three Fiber, GSAP ScrollTrigger, a GPGPU
            particle simulation and custom GLSL.
          </p>

          <p className={styles.colophonItem}>
            <strong>{(simSize * simSize).toLocaleString('en-US')} particles</strong> on this
            device, simulated on the GPU across two ping-ponged float textures and drawn as lit
            beads in a single call.
          </p>

          <div className={styles.colophonLine}>
            <span className="u-cue">
              © {new Date().getFullYear()} {identity.name}
            </span>
            <span className="u-cue">{identity.location}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
