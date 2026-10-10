'use client';

import { useRef, type CSSProperties } from 'react';
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap';
import { Chapter } from './Chapter';
import { scrollTo } from './SmoothScroll';
import { chapters, experience, type ExperienceGlyph, type ExperienceStation } from '@/config/content';
import { experienceState, STATION_CENTRES } from '@/lib/experienceState';
import styles from './Thaw.module.css';

/* ============================================================================
   THAW — EXPERIENCE

   The career as a signal path. On a wide screen with motion on, the chapter
   holds the viewport for about four screens while a stream of beads runs
   through it and gathers, station by station, into a sculpture of the work
   (the field does that: ParticleField, careerGlyphs.ts). This component owns
   the reading side: each station's text rises in as its sculpture forms and
   leaves as it unwinds, the headline figure counts up with the scroll, a
   timeline under the stations carries a bead in step with the stream, and
   small labels are pinned to each sculpture.

   Scroll snaps to the stations. It holds on every wide screen, reduced
   motion included (owner's call: the owner's Mac has Reduce Motion on, and
   the held view is the one wanted): everything in it is driven by the
   reader's own scroll,
   and under reduced motion the station text only fades, never slides. On
   phones it is simply a list, oldest first, each station with a line
   drawing of its sculpture: no hold, no scrub.
   ========================================================================= */

const HOLD = '(min-width: 900px)';
const LIST = '(max-width: 899px)';

const formatCount = (v: number) => String(Math.round(v));

/* Labels follow their sculpture: ParticleField projects each anchor every
   frame; this moves the label there. Transform and opacity only. */
function followMarks(root: HTMLElement) {
  const marks = gsap.utils.toArray<HTMLElement>('[data-anchor]', root);
  const place = () => {
    for (const el of marks) {
      const m = experienceState.marks[el.dataset.anchor ?? ''];
      if (!m) continue;
      el.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
      el.style.opacity = m.o.toFixed(3);
    }
  };
  gsap.ticker.add(place);
  return () => {
    gsap.ticker.remove(place);
    gsap.set(marks, { clearProps: 'all' });
  };
}

/* The order book's price column: levels outward from the best ask and bid. */
function ladderMarks(station: ExperienceStation) {
  const l = station.ladder;
  if (!l) return [];
  const fmt = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: l.decimals, maximumFractionDigits: l.decimals });
  return Array.from({ length: 8 }, (_, k) => [
    { anchor: `book-a${k}`, text: fmt(l.bestAsk + k * l.tick) },
    { anchor: `book-b${k}`, text: fmt(l.bestBid - k * l.tick) },
  ]).flat();
}

export function Thaw() {
  const ref = useRef<HTMLDivElement>(null);
  const chapter = chapters[1];

  useGSAP(
    () => {
      const root = ref.current;
      // The section belongs to Chapter, outside this scope: resolve it by id.
      const section = document.getElementById(chapter.id);
      if (!root || !section) return;

      const mm = gsap.matchMedia();

      /* Either way the chapter is "on" for its whole length, so the field
         holds its own formations through it (SmoothScroll reads data-span). */
      section.dataset.span = 'whole';

      /* The list: the field still shows the station being read. The
         viewport's centre, passing each station's middle, picks the station
         nearest it, so each sculpture is there beside its text. */
      mm.add(LIST, () => {
        const stations = gsap.utils.toArray<HTMLElement>('[data-station]', root);
        let keys: [number, number][] = [];
        const measure = () => {
          const at = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
          const top = at(section);
          keys = [
            [top, 0],
            ...stations.map((el, i): [number, number] => [at(el) + el.offsetHeight / 2, STATION_CENTRES[i]]),
            [top + section.offsetHeight, 1],
          ];
        };
        const update = () => {
          const focus = window.scrollY + window.innerHeight / 2;
          let p = focus <= keys[0][0] ? 0 : 1;
          for (let i = 0; i < keys.length - 1; i++) {
            const [a, pa] = keys[i];
            const [b, pb] = keys[i + 1];
            if (focus >= a && focus <= b) {
              p = pa + ((focus - a) / (b - a || 1)) * (pb - pa);
              break;
            }
          }
          /* Settle on a station, never between two: the field's damping
             then plays the morph through in about a second. Following the
             scroll continuously parked the field on a half-and-half blend
             of two sculptures whenever the reader stopped between them. */
          experienceState.progress =
            p < 0.1 ? 0 : p > 0.9 ? 1 : STATION_CENTRES.reduce((a, c) => (Math.abs(p - c) < Math.abs(p - a) ? c : a));
        };
        measure();
        const st = ScrollTrigger.create({
          trigger: section,
          start: 'top bottom',
          end: 'bottom top',
          onUpdate: update,
          onRefresh: () => {
            measure();
            update();
          },
          onLeave: () => (experienceState.progress = 1),
          onLeaveBack: () => (experienceState.progress = 0),
        });
        update();
        // Labels on the sculptures too, where there is room beside the list.
        const unfollow = window.matchMedia('(min-width: 900px)').matches ? followMarks(root) : () => {};
        return () => {
          st.kill();
          unfollow();
          experienceState.progress = 0;
        };
      });

      mm.add(HOLD, () => {
        section.dataset.layout = 'pinned';
        // Under reduced motion the station text fades in place.
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const rise = still ? 0 : 28;
        const sink = still ? 0 : -18;

        const stations = gsap.utils.toArray<HTMLElement>('[data-station]', root);
        const nodes = gsap.utils.toArray<HTMLButtonElement>('[data-node]', root);
        const track = root.querySelector<HTMLElement>('[data-track]');
        const fill = root.querySelector<HTMLElement>('[data-fill]');
        const bead = root.querySelector<HTMLElement>('[data-bead]');
        const counts = stations.map((el) => el.querySelector<HTMLElement>('[data-count]'));
        counts.forEach((el) => el && (el.textContent = '0'));

        let active = -1;
        const setActive = (p: number) => {
          let best = 0;
          STATION_CENTRES.forEach((c, i) => {
            if (Math.abs(p - c) < Math.abs(p - STATION_CENTRES[best])) best = i;
          });
          if (best === active) return;
          active = best;
          nodes.forEach((n, i) => n.toggleAttribute('aria-current', i === best));
        };

        const st = ScrollTrigger.create({
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: (self) => {
            experienceState.progress = self.progress;
            setActive(self.progress);
          },
          // onUpdate stops when the trigger is inactive: pin the ends.
          onLeave: () => (experienceState.progress = 1),
          onLeaveBack: () => (experienceState.progress = 0),
          snap: {
            snapTo: [0, ...STATION_CENTRES, 1],
            duration: { min: 0.3, max: 0.8 },
            delay: 0.08,
            ease: 'power2.inOut',
          },
        });

        /* The reading side, scrubbed against the same span. Positions are in
           progress units: the timeline is exactly 1 long. */
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: section,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });
        tl.set({}, {}, 1);
        if (fill) tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);
        if (bead && track) tl.fromTo(bead, { x: 0 }, { x: () => track.offsetWidth, duration: 1 }, 0);
        // The timeline leaves with the last station, before the shell lets go.
        const timeline = root.querySelector<HTMLElement>('[data-timeline]');
        if (timeline) tl.fromTo(timeline, { opacity: 1 }, { opacity: 0, duration: 0.05, immediateRender: false }, 0.95);

        stations.forEach((el, i) => {
          const c = STATION_CENTRES[i];
          const station = experience[i];
          const parts = el.querySelectorAll('[data-part]');
          const rules = el.querySelectorAll('[data-rule]');
          /* Hidden up front, explicitly: a staggered fromTo inside a
             timeline only renders its first element's start immediately,
             and the other stations' text sat on top of the first. */
          gsap.set(parts, { opacity: 0, y: rise });
          gsap.set(rules, { scaleX: 0 });
          tl.to(parts, { opacity: 1, y: 0, duration: 0.07, stagger: 0.01, ease: 'power2.out' }, c - 0.12);
          tl.to(rules, { scaleX: 1, duration: 0.08, stagger: 0.012, ease: 'power2.inOut' }, c - 0.09);
          tl.to(parts, { opacity: 0, y: sink, duration: 0.05, stagger: 0.006, ease: 'power1.in' }, c + 0.075);
          tl.to(rules, { scaleX: 0, duration: 0.05, ease: 'power1.in' }, c + 0.08);
        });

        const unfollow = followMarks(root);

        /* The figures count up as their station arrives, read straight
           from the scroll each frame, so they can never stick part-way. */
        const shown = counts.map(() => -1);
        const place = () => {
          const p = experienceState.progress;
          counts.forEach((el, i) => {
            if (!el) return;
            const t = Math.min(Math.max((p - (STATION_CENTRES[i] - 0.11)) / 0.09, 0), 1);
            const v = Math.round(experience[i].metric.value * (1 - Math.pow(1 - t, 3)));
            if (v !== shown[i]) {
              shown[i] = v;
              el.textContent = formatCount(v);
            }
          });
        };
        gsap.ticker.add(place);

        const jumps = nodes.map((node, i) => {
          const go = () => scrollTo(st.start + STATION_CENTRES[i] * (st.end - st.start));
          node.addEventListener('click', go);
          return () => node.removeEventListener('click', go);
        });

        // The section just grew four screens tall: re-measure everything below.
        const raf = requestAnimationFrame(() => ScrollTrigger.refresh());

        return () => {
          cancelAnimationFrame(raf);
          gsap.ticker.remove(place);
          unfollow();
          jumps.forEach((off) => off());
          st.kill();
          tl.scrollTrigger?.kill();
          tl.kill();
          delete section.dataset.layout;
          experienceState.progress = 0;
          counts.forEach((el, i) => el && (el.textContent = formatCount(experience[i].metric.value)));
          gsap.set([...stations.flatMap((s) => Array.from(s.querySelectorAll('[data-part], [data-rule]'))), fill, bead, timeline], {
            clearProps: 'all',
          });
          nodes.forEach((n) => n.removeAttribute('aria-current'));
          requestAnimationFrame(() => ScrollTrigger.refresh());
        };
      });

      return () => {
        mm.revert();
        delete section.dataset.span;
      };
    },
    { scope: ref },
  );

  return (
    <Chapter id={chapter.id} title={chapter.title} caption={chapter.caption} className={styles.chapter}>
      <div ref={ref} className={styles.stage}>
        <ol className={styles.stations}>
          {experience.map((station, i) => (
            <li key={station.id} className={styles.station} data-station={i}>
              <Station station={station} />
            </li>
          ))}
        </ol>

        <nav className={styles.timeline} aria-label="Career timeline" data-timeline>
          <div className={styles.track} data-track>
            <span className={styles.trackFill} data-fill aria-hidden="true" />
            <span className={styles.bead} data-bead aria-hidden="true" />
            {experience.map((station, i) => (
              <button
                key={station.id}
                type="button"
                className={styles.node}
                data-node
                style={{ '--at': STATION_CENTRES[i] } as CSSProperties}
                aria-label={`${station.companies.map((c) => c.name).join(' and ')}, ${station.years}`}
              >
                <span className={styles.nodeDot} aria-hidden="true" />
                <span className={styles.nodeYears}>{station.years}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className={styles.marks} aria-hidden="true">
          {experience.flatMap((station) =>
            station.marks.map((mark) => (
              <span key={mark.anchor} className={styles.mark} data-anchor={mark.anchor}>
                <span className={styles.markDot} />
                {mark.text}
              </span>
            )),
          )}
          {experience.flatMap((station) =>
            ladderMarks(station).map((mark) => (
              <span key={mark.anchor} className={styles.price} data-anchor={mark.anchor}>
                <span className={styles.priceText}>{mark.text}</span>
              </span>
            )),
          )}
        </div>
      </div>
    </Chapter>
  );
}

function Station({ station }: { station: ExperienceStation }) {
  const { metric } = station;
  const several = station.companies.length > 1;
  return (
    <article className={styles.card}>
      <div className={styles.icon} aria-hidden="true">
        <GlyphIcon glyph={station.glyph} />
      </div>

      <h3 className={styles.company} data-part>
        {station.companies.map((c, i) => (
          <span key={c.name}>
            {i > 0 && <span className={styles.joiner}> · </span>}
            {c.name}
          </span>
        ))}
      </h3>

      <ul className={styles.roster} data-part>
        {station.companies.map((c) => (
          <li key={c.name} className={styles.rosterRow}>
            <span>
              {c.role}
              {several && <span className={styles.rosterAt}>, {c.name}</span>}
            </span>
            <span className={styles.period}>{c.period}</span>
          </li>
        ))}
      </ul>

      <p className={styles.metric} data-part>
        <span className={styles.metricValue}>
          {metric.prefix}
          <span data-count>{metric.value}</span>
          {metric.suffix}
        </span>
        <span className={styles.metricLabel}>{metric.label}</span>
      </p>

      <ul className={styles.facts}>
        {station.facts.map((fact) => (
          <li key={fact.text} className={styles.fact}>
            <span className={styles.factRule} data-rule aria-hidden="true" />
            <span className={styles.factText} data-part>
              {fact.from && <span className={styles.from}>{fact.from}</span>}
              {fact.text}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/* Line drawings of the three sculptures, for the list layout. Drawn on a
   48-unit grid in one stroke weight; the live part of each in the accent. */
function GlyphIcon({ glyph }: { glyph: ExperienceGlyph }) {
  if (glyph === 'pipeline') {
    return (
      <svg viewBox="0 0 48 48" className={styles.iconSvg}>
        <circle cx="7" cy="11" r="3" />
        <circle cx="7" cy="37" r="3" />
        <path className={styles.iconLive} d="M10 11c7 0 7 13 13 13M10 37c7 0 7-13 13-13h7" />
        <ellipse cx="38" cy="13" rx="7" ry="2.5" />
        <path d="M31 13v22c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V13M31 20.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5M31 28c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
      </svg>
    );
  }
  if (glyph === 'book') {
    return (
      <svg viewBox="0 0 48 48" className={styles.iconSvg}>
        <path d="M6 4v40" />
        <path d="M10 7h32M10 12h26M10 17h20" />
        <path d="M10 24h30" strokeDasharray="2 3" />
        <path className={styles.iconLive} d="M10 31h22M10 36h28M10 41h34" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className={styles.iconSvg}>
      <circle cx="18" cy="24" r="14" />
      <circle cx="18" cy="24" r="10.5" />
      <circle cx="18" cy="24" r="5" />
      <path d="M18 19v-3M18 29v3M13 24h-3M23 24h3" />
      <path className={styles.iconLive} d="M32 24c4 0 5-9 9-9M32 24h9M32 24c4 0 5 9 9 9" />
      <ellipse cx="44" cy="15" rx="2.5" ry="1" />
      <ellipse cx="44" cy="24" rx="2.5" ry="1" />
      <ellipse cx="44" cy="33" rx="2.5" ry="1" />
    </svg>
  );
}
