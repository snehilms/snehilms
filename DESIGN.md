---
name: Cryo Archive
description: A glacier laboratory seen through fog; a software engineer's portfolio built from frozen beads and ice in one pale, overhead-lit chamber.
colors:
  fog-hi: "#eceff3"
  ground: "#dde1e7"
  fog-lo: "#c9cfd8"
  floor: "#8e97a5"
  floor-deep: "#5d6676"
  ink: "#10151d"
  ink-2: "#1d2430"
  ink-3: "#323b49"
  text-dim: "#3b4452"
  text-faint: "#4d5665"
  text-ghost: "rgb(16 21 29 / 0.26)"
  accent: "#1c5a80"
  accent-2: "#24608a"
  accent-3: "#6f9fc2"
  accent-4: "#a9c6db"
  glint: "#ffffff"
  line: "rgb(16 21 29 / 0.12)"
  line-strong: "rgb(16 21 29 / 0.24)"
  glass: "rgb(244 246 249 / 0.48)"
  glass-hi: "rgb(248 250 252 / 0.72)"
typography:
  display:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(2.75rem, 1.2rem + 7.6vw, 8.5rem)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(2rem, 1.4rem + 3.0vw, 4rem)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(1.5rem, 1.25rem + 1.25vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  lead:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(1.125rem, 1.00rem + 0.62vw, 1.5rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(0.9375rem, 0.88rem + 0.28vw, 1.125rem)"
    fontWeight: 400
    lineHeight: 1.62
  small:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(0.8125rem, 0.78rem + 0.17vw, 0.9375rem)"
    fontWeight: 400
    lineHeight: 1.62
  cue:
    fontFamily: "Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(0.8125rem, 0.78rem + 0.17vw, 0.9375rem)"
    fontWeight: 500
    letterSpacing: "0.02em"
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "clamp(0.6875rem, 0.66rem + 0.14vw, 0.75rem)"
    fontWeight: 500
    letterSpacing: "0.18em"
rounded:
  sm: "8px"
  md: "16px"
  lg: "24px"
  full: "999px"
spacing:
  s-opt: "4px"
  s-1: "8px"
  s-2: "16px"
  s-3: "24px"
  s-4: "32px"
  s-5: "40px"
  s-6: "48px"
  s-8: "64px"
  s-10: "80px"
  s-12: "96px"
  s-16: "128px"
  s-20: "160px"
  s-24: "192px"
  s-32: "256px"
components:
  nav-link:
    textColor: "{colors.text-dim}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  nav-link-hover:
    textColor: "{colors.ink-2}"
  status-pill:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.text-faint}"
    typography: "{typography.cue}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  skill-chip:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.text-dim}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  skill-chip-hover:
    textColor: "{colors.ink}"
  stack-tag:
    textColor: "{colors.text-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  archive-card:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.lg}"
    padding: "24px"
  archive-card-hover:
    backgroundColor: "{colors.glass-hi}"
  dossier-panel:
    backgroundColor: "{colors.glass-hi}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "40px"
  dossier-close:
    textColor: "{colors.text-dim}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  social-selector-link:
    textColor: "{colors.text-faint}"
    typography: "{typography.lead}"
    padding: "8px 24px"
  social-selector-link-active:
    textColor: "{colors.ink}"
  social-handle:
    textColor: "{colors.accent}"
    typography: "{typography.small}"
  social-handle-unlinked:
    textColor: "{colors.text-faint}"
    typography: "{typography.small}"
  email-cta:
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
  email-cta-hover:
    textColor: "{colors.accent}"
---

# Design System: Cryo Archive

## Overview

**Creative North Star: "The Glacier Laboratory in Fog"**

The whole site happens inside one pale, cold chamber lit from overhead: brightest under the ceiling, a white horizon band where the light pools, then a slate floor falling away below. Every artefact in it is a solid. The particle field and the social marks are built from opaque, lit beads of rime; the archive crystals are frosted ice glass with dark slate cores and a frozen ink network. Nothing glows on black. Things read by value against fog, and distance folds them back into the fog colour.

The DOM is quiet instrumentation laid over that room. Type is the system sans, set large, uppercase only for the hero headline, and calm everywhere else; short interface cues (role line, availability, scroll and explore prompts, footer line) are a quiet medium-weight sans, and mono is reserved strictly for measurements, handles, codenames and readouts. Surfaces are transparent so the canvas stays the background at all times; legibility comes from more fog (a directional haze scrim), not from opaque panels. One glacial-ink accent means "act here". White is used as light (rings, rims, glints, the horizon), never as a text colour.

Motion is continuous, never cut: entrances rise out of line masks once, continuous elements scrub with scroll, and the signature socials stage pins, walks four marks with snap, and tears each mark apart and re-forms it into the next.

**Key Characteristics:**
- Pale fog ground (`ground`) ramping from bright haze to a slate floor; dark-first was replaced, not tinted.
- Opaque lit beads whose "opacity" is spent as density, never translucency.
- Frosted ice glass with slate cores and dark inner networks, normal blending only.
- One accent family (glacial ink blue), with white reserved for light.
- System sans, large and quiet; a medium-weight sans cue for interface prompts; mono only for data.
- Hard 8px spacing grid, CSS-module components on a `:root` token layer.

## Colors

A cold, low-chroma slate-and-fog palette with a single glacial-ink accent; the only pure white in the system is light.

### Primary
- **Glacial Ink** (accent): the one colour that means "act here". The accented second headline line, the email hover, the social handle, focus rings, selection, the caret, status pulse, node accents. Measured 5.7:1 on `ground`, so it is legal for text at every size.
- **Deep Current** (accent-2): a near sibling used for codenames, depth labels, dossier notes and stat rules. 5.1:1 on `ground`; text-legal.
- **Meltwater** (accent-3) and **Shelf Ice** (accent-4): fills only, never text (accent-3 measures 2.2:1). They end gradients on the chapter rail fill, the strata depth bars, feedback edges in diagrams, and tint fast-moving beads.

### Neutral
- **Overhead Haze** (fog-hi): the brightest fog under the ceiling; dossier node boxes, selection text, the scrim's haze colour.
- **Chamber Fog** (ground): the page background and the band all text contrast is measured against.
- **Low Fog** (fog-lo): the lit face of every bead and the pedestal stone.
- **Slate Floor** (floor) and **Deep Floor** (floor-deep): the floor below the horizon, pedestal grooves, the pedestal's ground shadow. Not text colours.
- **Slate Ink** (ink): headlines, active selector names, the selector bead. 14.0:1 on `ground`.
- **Text Slate** (ink-2, the semantic body text): 11.9:1 on `ground`.
- **Shade Slate** (ink-3): the shaded side of every bead and the crystals' inner network lines; 8.6:1 when used for small values.
- **Dim Text** (text-dim): secondary prose, taglines, blurbs. 7.5:1.
- **Faint Text** (text-faint): captions, cues, mono labels, inactive selector names, unlinked handles. 5.6:1; the quietest colour allowed to carry information.
- **Ghost** (text-ghost): 26% ink. Decorative only: separator dots, inactive ornaments.
- **Glint** (glint): light rings, dome wireframe, rims, horizon band, facet glints.
- **Hairlines** (line, line-strong): 12% and 24% ink rules and borders.
- **Frost** (glass, glass-hi): 48% and 72% pale glass fills for pills, chips, cards and the dossier.

### Named Rules
**The Light Is Not Ink Rule.** `glint` white is for rings, rims, glints, wireframes and the horizon. It never sets text; text on fog is always slate or accent.

**The One Accent Rule.** Glacial Ink and its siblings are the only hue. accent-3 and accent-4 are fills; if it is readable text, it is accent or accent-2.

**The Fog-Measured Rule.** Any text colour must clear 4.5:1 against `ground` (the measured mid band). `text-faint` is the floor; `text-ghost` never carries meaning.

## Typography

**Display Font:** Sora, self-hosted via next/font (system sans fallback)
**Body Font:** the same stack
**Label/Mono Font:** JetBrains Mono, self-hosted via next/font (system mono fallback)

**Character:** One family, set large and quiet. Weight 600 with tight negative tracking does the display work; the mono is small, tracked wide and only ever states facts. Sora (round open bowls on a strict geometric skeleton) is the owner's explicit choice for "techy and soft"; JetBrains Mono is the data face. No other faces.

### Hierarchy
- **Display** (600, fluid 44px to 136px, line-height 0.92, -0.035em, uppercase): the three-line hero headline only, second line in accent.
- **Headline** (600, fluid 32px to 64px, 0.92, -0.035em): the email CTA and stat values (tabular numerals).
- **Title** (600, fluid 24px to 36px, 1.12, -0.035em): dossier titles. The surface prompt uses this size at weight 400 with 1.24 leading and -0.015em; Experience company names use it at 600.
- **Lead** (500 to 600, fluid 18px to 24px, 1.12 to 1.45, -0.015em): archive slot titles, strata band labels, social selector names, the hero tagline (1.45).
- **Body** (400, fluid 15px to 18px, 1.62): prose, capped at 60 to 62ch.
- **Small** (400, fluid 13px to 15px): blurbs, chips, nav links, captions, colophon paragraphs (with bold run-in leads), the social handle (in mono at 0.04em).
- **Cue** (sans 500, fluid 13px to 15px, 0.02em, sentence case, `text-faint`): short interface prompts and status: the nav role line, the availability pill, "Scroll to thaw", "Click to explore", the footer line. Where a cue sits on the slate floor it steps up to `ink-3` (the scroll cue).
- **Label** (mono 500, fluid 11px to 12px, 0.18em, uppercase, `text-faint`): measurements, codenames, readouts, stat labels, depth values, dossier meta.

### Named Rules
**The Mono Is Data Rule.** Mono sets measurements, handles, codenames and readouts only. Status, prompts and calls to action are cues in sans; mono never sets prose, headings or labels that merely name a section.

**The Quiet Scale Rule.** Only the hero headline is uppercase. Everything else is sentence case carried by size and weight.

## Layout

Sections are transparent, full-viewport bands (`min-height: 100svh`, vertical padding clamped 96px to 160px) laid over the fixed canvas, each inside a shell capped at 1440px with a fluid gutter (`clamp(24px, 4vw, 80px)`). Reading measure is 62ch. Content blocks take pointer events; the section itself passes them through.

Spacing is a hard 8px ladder (`s-1` 8px through `s-32` 256px). `s-opt` (4px) exists for optical nudges, chip insets and label stacks only, never for layout.

Composition is asymmetric: reading content sits left, the field and marks occupy the right two-thirds, and a 98-degree fog scrim hazes the reading column while leaving the field clear. On desktop the scrim's bottom haze is only a thin lift (42% fog fading out by 18% of the height), so the slate floor stays visible below the horizon. Below 900px the scrim flattens to an even veil for text, the chapter rail hides, and the archive's sticky three-slot gallery becomes a stacked list of glass cards. Experience, on wide screens with motion, is a held chapter (420svh, the shell sticky for four screens): the stations take turns in one reading slot capped at 34rem, with the career timeline under them and the bead sculptures filling the right of the frame; elsewhere it is a stacked list, each station with a line drawing of its sculpture. Nav links hide below 1080px.

The archive runs 230svh so its sticky row holds centre; the socials stage is a pinned 100svh chamber.

## Elevation & Depth

Depth is atmospheric first and shadowed rarely. The canvas supplies it: a fog chamber whose bright horizon band sits a little over a third of the way up the frame (uv 0.37), with a real slate floor below it falling from `floor` to `floor-deep` over a short span (0.12 uv), beads that dissolve toward the fog colour with distance, and a vignette settling the corners a shade toward slate. In the DOM, depth is frost (20px backdrop blur with 120% saturation over a translucent pale fill) plus hairlines. Two soft shadows exist, both tinted from the palette, both blurred, never hard-offset.

### Shadow Vocabulary
- **Accent halo** (`box-shadow: 0 0 0 1px rgb(28 90 128 / 0.22), 0 8px 24px -8px rgb(28 90 128 / 0.32)`): hover state on the brand mark and the status pill only.
- **Soft lift** (`box-shadow: 0 16px 48px -16px rgb(29 36 48 / 0.34)`): the dossier panel, the one true overlay.

### Materials
- **Lit bead.** Each particle is an opaque sphere sprite shaded under a fixed overhead key: lit side `fog-lo`, shaded side `ink-3`, a small specular, a glacial tint (`accent-3`) when moving fast, an overhead falloff by world height (x0.78 at the bottom to x1.06 at the top), and up to 75% fold into `ground` with distance. Beads write depth and are discarded, not blended: a chapter at 0.3 opacity keeps 30% of the beads, each fully solid. The per-chapter art table drives density (signal 1.0, experience 0.97 because the career sculptures are its subject, archive 0.20 and pushed back in depth, strata 0.4, surface 0.95). On portrait screens the whole field is pushed back (z -3.2) and thinned (density x0.6) so it never sits under the text column.
- **Frosted ice glass.** Archive shards refract a procedural pale environment (slate low, haze high, white band and key, pale cyan rim) at IOR 1.34 with slight per-channel dispersion, absorb toward glacial blue with thickness (Beer-Lambert), and carry a dark `ink-3` inner network with `accent` nodes. Normal blending, layered back faces, core, front faces, network.
- **Light.** Bloom has a high threshold (0.86) so only light sources bloom: the horizon, facet glints, stage rings. No chromatic aberration: it split grey beads into blue/red fringes on scroll. Fast beads catch a frost sheen (`--c-fog-hi`), never a hue.

### Named Rules
**The No Additive Light Rule.** No additive blending anywhere. In a pale room additive light washes to white; every material uses normal blending or opaque, depth-written fragments.

**The Density Not Translucency Rule.** Beads fade by dropping out, never by going translucent. A thinner cloud is fewer solid beads.

**The Fog Is the Scrim Rule.** Legibility over the canvas comes from haze in the fog colour, not from opaque panels or dark overlays.

## Shapes

Gentle, consistent rounding: tags and focus rings 8px, cards and diagram frames 16px, the dossier and compact archive cards 24px, pills and chips fully round. Borders are 1px hairlines in `line` or `line-strong`. Recurring geometry is instrumental: horizontal rules drawn in with scaleX and fading to transparent, survey-style leader lines, plain hairline range marks, a single travelling bead under the active stage name, a 1px progress spine. On the canvas, forms are faceted (icosahedral shards, a triangulated half-dome) and round (beads, floor rings).

## Components

### Buttons and Links
- **Nav link:** small sans, `text-dim`, fully rounded, 8px by 16px; hover lifts to body text over a 5% ink wash.
- **Status pill:** frost fill, hairline border, fully round, a sans cue and an accent pulse dot; hover swaps the border to accent and adds the accent halo.
- **Dossier close:** hairline pill; hover goes to ink text, accent border and an 8% accent wash.
- **Email CTA:** headline-size ink text with a 1px accent underline that draws from 0 to 100% width on hover while the text turns accent; sits in a generous magnetic hit zone.
- **Focus:** a 2px accent outline with a 4px offset and 8px radius, everywhere.

### Chips
- **Skill chip (strata):** frost fill, hairline border, fully round, small sans in `text-dim`; hover goes to ink, accent border, and rises 2px.
- **Stack tag (archive, dossier):** no fill, hairline border, 8px radius, mono at 0.06em in `text-faint` or `ink-3`.

### Cards / Containers
- **Archive slot (desktop):** a transparent full-height frame over the 3D shard; the centre is deliberately empty because that void is the shard. Hover adds a hairline border and a 36% haze, extends the accent leader line, brightens the readout.
- **Archive card (compact):** frost fill, hairline border, 24px radius, 24px padding; hover goes to `glass-hi` with an accent border.
- **Dossier panel:** a glass panel (`glass-hi` to fog-hi gradient, 20px frost, `line-strong` border, 24px radius, soft lift) over a 62% fog backdrop blurred 18px, so the clicked shard still lights it from behind. Holds an architecture diagram with pale node boxes, kind-coded accent bars and a travelling ink packet.

### Navigation
- **Top nav:** fixed and transparent at the top; once condensed it takes frost and a hairline bottom border. The brand mark is a 40px hairline square in mono.
- **Chapter rail:** fixed right, a 1px spine whose accent fill is scrubbed by scroll, with ticks and mono labels revealed by opacity and transform on the active chapter. Hidden below 900px.

### Experience Signal Path
The career told as a signal path, oldest first: Yield3 · Propellyr Chaintech (2022–24), Flint Labs (2024–26), Scrypt (2026–). On arrival the hero's bead sphere unravels into a stream: seven fine strands bundled like fibre, pinched at both ends, rippling slowly, with one glacial-ink packet travelling along it. At each station the stream gathers into a bead sculpture of the work, lit as a solid (each bead blends its surface normal with its own roundness, after igloo.inc's particle objects), posed 3/4 and turning a little:
- **Pipeline (Yield3 · Propellyr):** two source spheres send streams through a short queue into a three-disc database stack; light pulses run down the pipes. Labels: On-chain, Off-chain, RabbitMQ, Iceberg.
- **Order book (Flint Labs):** a ladder of solid slabs, eight ask levels in slate above and eight bid levels in glacial ink below, a dashed spread and a last-trade knot on the price axis, and a mono price column (illustrative levels, not market data). Sizes churn on every level; the best ask and best bid take turns being traded away with a flash down the spread, then refill. Labels: Asks, Spread, Bids.
- **Vault (Scrypt):** a bolted vault door with dense rims and a sparse face, swinging open on its hinge as the station forms, its six-spoke wheel turning, payout streams flowing to three stacks of four coins. Labels: Custody, Payouts.

Each sculpture answers the cursor: light gathers under it; the pipeline's pulses run faster; the order book's level under it lights and swells; the vault door swings wider and its wheel spins up. Under reduced motion their ambient motion runs at half speed.

The reading side: the company name at title size, a roster row per employer (role in sans, period in mono), one figure at headline size that counts up with the scroll, and two or three facts under drawn hairlines, each tagged in mono accent with its employer where a station spans two. Labels pinned to the sculptures are mono, `ink-3`, with an accent ring and a breath of fog behind the letters. Under the stations a career timeline: a hairline rail filled in Meltwater-to-Glacial-Ink, the three stations as small rings with their years, an ink bead travelling in step with the stream; rings are buttons that jump to their station. Scroll snaps to the stations. Under reduced motion and below 900px there is no hold: a stacked list, each station with a 48-unit line drawing of its sculpture (ink-3 stroke, live part in accent).

### Socials Stage (signature)
A pinned full-viewport chamber holding one bead mark (sized at a quarter of the viewport height, capped by width) floating clear above the far rim of a pale stone pedestal with `floor` grooves, white light rings spreading across the floor, a soft `floor-deep` ground shadow and the back half of a white triangulated wireframe dome (22% opacity). The DOM adds only two range marks (plain 1px `ink-3` rules at half opacity, no returns) at the mark's centre line, a selector row of four names near the bottom (body size, faint, ink when active) with a single 6px ink bead under the active or focused name that glides there by transform, and the handle beneath in `ink-3` mono with a diagonal SVG arrow, underlining on hover. A name with no destination (currently X) is a select-only button and its handle is plain `text-faint` mono, never styled as a link. The selector stands on the slate floor, so a soft radial veil of `fog-hi` (0.88 at centre, fading out) sits behind the band; it lifts the floor under the inactive names to at least 4.78:1 against `text-faint` (measured), keeping the faint/ink hierarchy instead of darkening every name.

Selection: hover or focus previews a mark; clicking the active name opens it. On touch the first tap jumps the pinned scroll to that mark and a second tap opens it.

Motion grammar: on entry (scrubbed) the background field thins and the mark condenses out of scattered beads; while pinned, scroll walks GitHub, LinkedIn, X and Email with snap to whole marks; each change is a tear and re-form (beads leave on a per-bead delay, are thrown outward, settle on the next mark, so a change is a migration, never a crossfade); a slow erosion front always sheds one edge; the cursor pushes beads aside in the plane. Selecting a name jumps the pin directly to its mark. On exit (scrubbed) the field returns. Under reduced motion there is no pin and no scrub: the mark is simply there and selection changes are instant.

### Motion grammar (all components)
- Text enters once, rising out of a line mask (SplitText, `expo.out`, 118% travel), triggered on scroll and never replayed.
- Anything continuous scrubs with scroll: the hero's exit, the Experience stations and timeline, strata depth bars, the rail fill, the stage.
- Durations are 0.24s, 0.48s and 0.96s with `cubic-bezier(0.16, 1, 0.3, 1)` for state changes and `cubic-bezier(0.76, 0, 0.24, 1)` for loops.
- Reduced motion: CSS transitions and animations collapse to 0.01ms, reveal and scrub timelines are skipped, smooth scrolling is off and diagram packets stop.

## Do's and Don'ts

### Do:
- **Do** resolve every colour, space, radius, duration and easing to a `:root` token; canvas materials read them through `cssColor('--c-…')`.
- **Do** measure text contrast against `ground`: ink 14.0:1, body text 11.9:1, dim 7.5:1, faint 5.6:1, accent 5.7:1.
- **Do** spend bead opacity as density: discard beads, keep the survivors fully solid and depth-written.
- **Do** use white only as light: rings, rims, glints, the dome wireframe, the horizon band.
- **Do** keep sections transparent and earn legibility with fog-coloured haze over the reading column.
- **Do** animate transform and opacity only, and declare `will-change` on anything GSAP moves.
- **Do** make every mark change on the stage a tear and re-form of the same beads.
- **Do** give reduced-motion users the final state: no pin, no scrub, instant changes.

### Don't:
- **Don't** use additive blending anywhere, on beads, glass, rings or post.
- **Don't** fade beads by translucency; translucent beads read as smudges.
- **Don't** set text in `glint` white, `accent-3`, `accent-4`, `floor` or `text-ghost`.
- **Don't** return to dark-mode neon: no glow-on-black, no neon gradients on type. A colour shift reads as emphasis in fog; a gradient on text reads as a rendering fault.
- **Don't** add webfonts; the system stack is the owner's call.
- **Don't** use `s-opt` (4px) for layout spacing.
- **Don't** use hard offset shadows; the only shadows are the two soft, tinted ones above.
- **Don't** set status, prompts or calls to action in mono; they are sans cues.
- **Don't** style a destination-less handle as a link.
- **Don't** let the canvas take pointer events; interaction belongs to real DOM elements.
