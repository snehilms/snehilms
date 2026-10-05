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

   The DOM half of the crystal gallery.

   Each project gets a slot on the same thirds the 3D shards are laid out on,
   and the slot — not the canvas — owns the interaction. That is deliberate:
   the shards are decoration that responds, while the hit target, the focus
   ring, the keyboard path and the accessible name all live in a real
   <button> the browser already knows how to handle. No raycasting, no
   pointer-events games over the canvas, and it still works with a keyboard.

   The slot row is sticky-centred inside a tall section, so a label always
   sits under the shard it names without measuring anything.
   ========================================================================= */

/** Below this width the 3D gallery is replaced by cards — three shards on a
    phone would each be the size of a thumbnail and read as noise. */
const GALLERY_MIN_WIDTH = 900;

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
        },
        /* onUpdate only fires while the trigger is active. Without these the
           last value written before the section left the viewport would
           stick, and the shards would follow us into the next chapter. */
        onLeave: () => {
          archiveState.presence = 0;
        },
        onLeaveBack: () => {
          archiveState.presence = 0;
        },
      });

      return () => {
        trigger.kill();
        archiveState.presence = 0;
      };
    },
    { dependencies: [compact, chapter.id] },
  );

  /* Slot entrance. Labels arrive after the shards have begun to form. */
  useGSAP(
    () => {
      if (compact) return;

      const tween = gsap.from(`.${styles.slotFrame}`, {
        opacity: 0,
        y: 28,
        duration: 1.1,
        stagger: 0.12,
        ease: 'expo.out',
        scrollTrigger: { trigger: ref.current, start: 'top 72%', once: true },
      });

      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    },
    { scope: ref, dependencies: [compact] },
  );

  return (
    <Chapter
      id={chapter.id}
      index={chapter.index}
      kicker={chapter.kicker}
      caption={chapter.caption}
      stretch={!compact}
      className={compact ? undefined : styles.tall}
    >
      <div ref={ref} className={compact ? styles.cards : styles.slots}>
        {projects.map((project, i) => (
          <button
            key={project.id}
            type="button"
            className={compact ? styles.card : styles.slot}
            onPointerEnter={() => {
              archiveState.hovered = i;
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
                <span className={styles.leader} aria-hidden="true" />
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
                  <span className="u-mono">Click to explore</span>
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
