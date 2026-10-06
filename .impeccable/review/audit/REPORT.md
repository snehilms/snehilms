# UI audit — consolidated (Oct 2026)

Sources: three parallel read-only reviews against the same evidence in this
folder (30 captures at 390 / 1024 / 1440 / 2560, Lighthouse, a scroll trace):
Impeccable `critique`, `design-taste-frontend` + `frontend-design` craft review,
and a GSAP/R3F scaling-and-scroll engineering review. The fourth (Impeccable
technical `audit`) hit a rate limit and did not report. Duplicates merged;
file references point at the code as of this audit.

Measured: 60 fps through a full scroll at 1440 (median 16.7 ms, p99 17.7 ms);
Lighthouse a11y 98 / best practices 100 / SEO 100.

## P0 — broken

1. **Reveal-gated content can stay invisible.** Thaw prose and stats, strata
   labels, the surface prompt, the colophon, dossier nodes and the chapter rail
   were blank in every full-motion capture at every width, but present in
   reduced motion. Every reveal is `gsap.from(opacity 0 / yPercent)` on a
   `once` trigger, so content exists only if the tween runs. *Verify with
   natural scrolling first*, then make reveals fail-open regardless: completed
   state as the CSS default, `onRefresh` completing already-passed triggers.
   (Chapter.tsx, RevealText.tsx, Strata.tsx, Thaw.tsx, Dossier.tsx)
2. **Archive shards don't sit under their labels except at 1440.** Shards are
   spaced across the full viewport while slots live in the 1440 column (and
   R3F's `viewport` is a stale ruler under the dollying camera). At 2560 the
   outer shards are ~350 px outside their slots; at 1024 they clip.
   Fix: measure slot rects, place shards from them using the live camera.
   (CrystalGallery.tsx)
3. **Type, column and spacing stop growing at ~1540 px** — the "not scalable"
   complaint. 1440 px island with ~560 px dead margins at 2560.
   Fix: second fluid segment to 2560 for each `--t-*`, `--max-w` fluid to
   ~2048, gutter and section padding fluid but `round()`-ed to the 8 px grid.
   (globals.css)
4. **Hero field drifts against the DOM** at every size but 1440×900 (covers
   the caption at 2560, collides with THAT HOLD at 1024, half off-screen in
   portrait). ART offsets are world units; the DOM is capped px.
   Fix: express ART in column units via a measured layout bridge.
5. **Dossier is unusable on phones**: an 860 px-min SVG in a hidden horizontal
   scroller shows one lane. Fix: lanes as a vertical list below 900 px.

## P1 — clearly visible defects

- No navigation below 1080 px (links hidden, rail hidden below 900): add a menu
  sheet or bottom chapter bar.
- Nav status pill on phones is a bare dot with no accessible name.
- Stage pin causes CLS 1.0 (fixed↔static flip; real jump on touch). Replace the
  pin with a CSS-sticky track and Lenis-driven snap.
- Resize listener force-refreshes ScrollTrigger on every event (and defeats
  `ignoreMobileResize`); background canvas resizes with the mobile toolbar.
- Dossier: wheel scrolls the page behind it (Lenis not stopped, no
  `data-lenis-prevent`); no focus trap or focus return.
- Nav loses its frost at max scroll, so stage beads cross the nav links.
- Archive readouts at opacity 0.55 ≈ 2.3:1 contrast; archive button
  accessible names don't start with the visible text (WCAG 2.5.3).
- Heading order: h1 → h3 (Lighthouse); chapters have no real headings.
- Content / IA: the strongest proof (Flint Labs perps exchange, $25B+, 300K+,
  −80%) has no dossier; employers, education and résumé appear nowhere; nav
  labels (Signal/Thaw/Strata) hide Work/About/Stack/Contact.
- Deferred layout items confirmed as failures: chapter kickers "00 — SIGNAL",
  nav numbers, the Thaw stats row, "ARCHIVE_CO_0x" codenames, mono used for
  prose and controls.
- Sharing: `meta.url` is example.com and there is no OG image (the stage frame
  would make a strong one).
- Device tier: 2560@2× renders a 13.6 MP backbuffer in two contexts with no
  pixel budget; tier detected four times; Safari/Firefox misclassified as mid.

## P2 — polish

Ghost texture top-left at 2560 (UV-space grain + banding — move grain to
screen space); horizon band lands under small text; scrim tied to viewport not
column; HUD anchoring inconsistent; colophon double rule; archive dust is a
hard rectangle; Thaw formation reads as a placeholder; strata bands don't
register with the DOM rows; 26 equal-weight chips; dossier edge labels crossed
by their own strokes; "CLOSE ✕" mono + unicode icon; duplicated status and
location; two contact endings (Surface then stage); "handle to come" visible;
fixed 2.35 s preloader on every visit; rail ticks animate `width` and use
ghost text; bead size not scaled with viewport height; SplitText reveals
break on live resize; stage brackets stale after resize; glass `backdrop-filter`
on 26 chips over a live canvas.

## P3 — nits

Dead `metric`/`#` fields in content, invented-sounding role line, chip
treatment inconsistent, hero hint hover no-op, archive leader stub at rest,
off-grid literals (2 px, 1.5 px, SVG px sizes), focus ring changes element
radius, em dashes in depth ranges.

## Highest-leverage moves (agreed across reviewers)

1. One layout model at every width: fluid type/column to 2560, HUD anchored to
   viewport corners, plus a DOM→WebGL layout bridge so the field, shards and
   stage follow the measured DOM.
2. A memorable first viewport: replace the grey bead sphere with a lit,
   sculpted bead mark built with the stage's craft.
3. Make the archive the proof (flagship exchange work, fixed dossier), and end
   once, in the chamber.
