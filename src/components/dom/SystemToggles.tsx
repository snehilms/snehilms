'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { sound } from '@/lib/sound';
import { motionIsReduced, setMotionChoice } from '@/lib/motionPref';
import styles from './SystemToggles.module.css';

/* ============================================================================
   SYSTEM TOGGLES

   Bottom-left, as on igloo.inc: Sound and Motion. Both are the visitor's
   choice and both are remembered.

   Sound starts off — browsers refuse audio before a gesture — and turning
   it on is that gesture. If it was on last visit, it resumes on the
   visitor's first click or key press.

   Motion shows what the site is actually doing (after the OS setting and
   any earlier choice) and flips it; see lib/motionPref.ts for why that
   reloads the page.
   ========================================================================= */

function SoundBars({ on }: { on: boolean }) {
  return (
    <svg className={styles.bars} data-on={on} viewBox="0 0 16 16" aria-hidden="true">
      {[3, 7, 11].map((x, i) => (
        <rect key={x} x={x} y="3" width="2" height="10" rx="1" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
    </svg>
  );
}

export function SystemToggles() {
  const soundOn = useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
    () => false,
  );
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    setReduced(motionIsReduced());
    if (!sound.wanted()) return;
    // Resume on the first gesture — the only moment a browser allows it.
    const resume = () => {
      sound.enable();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  const soundLabel = `Sound: ${soundOn ? 'On' : 'Off'}`;
  const motionLabel = `Motion: ${reduced ? 'Reduced' : 'Full'}`;

  /* Compact icon buttons in the left gutter, mirroring the progress rail in
     the right one: pinned over the content column they covered text in every
     chapter. The state is in the icon (bars move when sound is on, the dot
     fills when motion is full); the words surface as a tag on hover/focus. */
  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={soundOn}
        aria-label={soundLabel}
        onClick={() => (soundOn ? sound.disable() : sound.enable())}
        data-cursor="hover"
      >
        <SoundBars on={soundOn} />
        <span className={styles.tag} aria-hidden="true">
          {soundLabel}
        </span>
      </button>

      {reduced !== null && (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={!reduced}
          aria-label={`${motionLabel}. ${reduced ? 'Turn on full motion' : 'Reduce motion'} (reloads)`}
          onClick={() => setMotionChoice(reduced ? 'full' : 'reduced')}
          data-cursor="hover"
        >
          <span className={styles.dot} data-on={!reduced} aria-hidden="true" />
          <span className={styles.tag} aria-hidden="true">
            {motionLabel}
          </span>
        </button>
      )}
    </div>
  );
}
