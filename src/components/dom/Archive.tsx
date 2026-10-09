'use client';

import { useRef, useState, useEffect } from 'react';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { projects, chapters } from '@/config/content';
import { archiveState, dossier } from '@/lib/archiveState';
import { smoothstep } from '@/lib/scrollState';
import styles from './Archive.module.css';

/* ============================================================================
   ARCHIVE — 02 / PROJECTS

   The DOM half of the crystal gallery. On desktop every project is a
   full-height stage: the crystal rises into the middle of the screen as you
   scroll, rolls past and the next comes up behind it, with its survey
   labels placed around it (after igloo.inc's portfolio). Below 900px the
   same buttons are cards.

   The slot — not the canvas — owns the interaction. That is deliberate: the
   crystal is decoration that responds, while the hit target, the focus ring,
   the keyboard path and the accessible name all live in a real <button> the
   browser already knows how to handle. It still works with a keyboard.

   CrystalGallery measures each slot every frame and puts its crystal behind
   it, so the crystals scroll with their stages without any layout maths.
   ========================================================================= */

/** Below this width the 3D gallery is replaced by cards — three shards on a
    phone would each be the size of a thumbnail and read as noise. */
const GALLERY_MIN_WIDTH = 900;

/** How far the legibility scrim thins while the gallery is up. The crystals
    are finished renders; the scrim's haze over the left column washed the
    first one flat. Headings stay legible on the pale fog without it. */
const SCRIM_CLEAR = 1;

function setScrim(presence: number) {
  document.documentElement.style.setProperty('--scrim', String(1 - SCRIM_CLEAR * presence));
}

export function Archive() {
  const ref = useRef<HTMLDivElement>(null);
  const chapter = chapters[2];
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${GALLERY_MIN_WIDTH - 1}px)`);
    const sync = () => {
      setCompact(mq.matches);
      if (mq.matches) archiveState.presence = 0;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /* Presence: a trapezoid over the section's own progress. It ramps in,
     holds flat while the sticky row is centred, then ramps out. The shards
     read this every frame; React never sees it change. */
  useGSAP(
    () => {
      if (compact) return;

      const section = document.getElementById(chapter.id);
      if (!section) return;

      const trigger = ScrollTrigger.create({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: (self) => {
          const p = self.progress;
          /* Full presence across the flat middle of the section, where the
             sticky row is centred. Narrow ramps at each end: the shards
             should already be there when the labels arrive. */
          archiveState.presence = smoothstep(0.02, 0.16, p) * (1 - smoothstep(0.84, 0.98, p));
          setScrim(archiveState.presence);
        },
        /* onUpdate only fires while the trigger is active. Without these the
           last value written before the section left the viewport would
           stick, and the shards would follow us into the next chapter. */
        onLeave: () => {
          archiveState.presence = 0;
          setScrim(0);
        },
        onLeaveBack: () => {
          archiveState.presence = 0;
          setScrim(0);
        },
      });

      return () => {
        trigger.kill();
        archiveState.presence = 0;
        setScrim(0);
      };
    },
    { dependencies: [compact, chapter.id] },
  );

  /* Each stage's labels arrive as its crystal rises into view and leave
     again if it scrolls back down: the survey readout is written onto the
     crystal while it is in front of you, never before. */
  useGSAP(
    () => {
      if (compact) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>(`.${styles.slot}`).forEach((slot) => {
          const parts = slot.querySelectorAll(
            `.${styles.slotHead}, .${styles.readout}, .${styles.explore}`,
          );
          const lines = slot.querySelectorAll(`.${styles.leader}, .${styles.leaderDrop}, .${styles.exploreRule}`);
          gsap
            .timeline({
              scrollTrigger: { trigger: slot, start: 'top 62%', toggleActions: 'play none none reverse' },
            })
            .fromTo(parts, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1, stagger: 0.1, ease: 'expo.out' })
            .fromTo(lines, { scaleX: 0 }, { scaleX: 1, duration: 0.9, stagger: 0.08, ease: 'expo.inOut' }, 0.15);
        });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [compact] },
  );

  return (
    <Chapter
      id={chapter.id}
      title={chapter.title}
      caption={chapter.caption}
    >
      <div ref={ref} className={compact ? styles.cards : styles.slots}>
        {projects.map((project, i) => (
          <button
            key={project.id}
            ref={(el) => {
              archiveState.slots[i] = el;
            }}
            type="button"
            className={compact ? styles.card : styles.slot}
            data-cursor={compact || !project.core.plate ? undefined : 'inspect'}
            onPointerEnter={(e) => {
              archiveState.hovered = i;
              archiveState.pointer.x = e.clientX;
              archiveState.pointer.y = e.clientY;
            }}
            onPointerMove={(e) => {
              archiveState.pointer.x = e.clientX;
              archiveState.pointer.y = e.clientY;
            }}
            onPointerLeave={() => {
              if (archiveState.hovered === i) archiveState.hovered = -1;
            }}
            onFocus={() => {
              archiveState.hovered = i;
            }}
            onBlur={() => {
              if (archiveState.hovered === i) archiveState.hovered = -1;
            }}
            onClick={() => dossier.open(project.id)}
            aria-label={`Open architecture dossier for ${project.title}`}
          >
            <span className={styles.slotFrame}>
              <span className={styles.slotHead}>
                <span className={`u-mono ${styles.codename}`}>{project.codename}</span>
                <span className={styles.title}>{project.title}</span>
                <span className={styles.leader} aria-hidden="true">
                  <span className={styles.leaderDrop} />
                </span>
              </span>

              <span className={styles.slotFoot}>
                <span className={styles.readout}>
                  {project.readout.map((row) => (
                    <span key={row.label} className={styles.readoutRow}>
                      <span className="u-mono">{row.label}</span>
                      <span className={`u-mono ${styles.readoutValue}`}>{row.value}</span>
                    </span>
                  ))}
                </span>

                <span className={styles.explore}>
                  <span className="u-cue">Open the architecture</span>
                  <span className={styles.exploreRule} aria-hidden="true" />
                </span>
              </span>

              {/* Compact mode needs the prose the shard would otherwise carry. */}
              {compact && (
                <span className={styles.cardBody}>
                  <span className={styles.cardBlurb}>{project.blurb}</span>
                  <span className={styles.stack}>
                    {project.stack.map((tech) => (
                      <span key={tech} className={styles.chip}>
                        {tech}
                      </span>
                    ))}
                  </span>
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Chapter>
  );
}
