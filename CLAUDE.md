# Cryo Archive — portfolio

Immersive software-engineer portfolio in the Igloo.inc / Hatom.com vein. Next.js 15
(App Router), React 19.2, React Three Fiber 9, GSAP 3 + ScrollTrigger + SplitText,
Lenis. One persistent WebGL canvas with five DOM chapters scrolling over it:
intro → experience → projects → stack → contact (components keep their old
world names: Hero, Thaw, Archive, Strata, Surface), then the socials stage.

All copy, projects, architecture graphs and links live in `src/config/content.ts`.
No component hardcodes content.

## Commands

- `npm run dev` — dev server on :3000
- `npm run build` then `npm run start -- --port 3100` — production preview
  (`portfolio-prod` in `.claude/launch.json`). Verify visual work here, not in dev:
  dev HMR has dropped the whole CSS chunk mid-session before.
- `npm run typecheck`
- `npm install` fails with EACCES on `~/.npm` on this machine. Pass
  `--cache <scratch dir>` instead of fixing permissions.
- React is pinned `~19.2.0` (and its types): `@react-three/fiber` 9.7 requires
  `<19.3`. Don't bump React without checking R3F's peer range first.

## Which guidance wins

Several design skills are installed (`impeccable`, `design-taste-frontend`,
`frontend-design`) plus the official GSAP and R3F skills. Where their defaults
disagree with this project, **this file and the established codebase win**:

- **Styling is CSS Modules on the token layer in `globals.css`.** Not Tailwind.
- **Motion is GSAP via `useGSAP`.** Not Motion/framer-motion, not `useMotionValue`.
- **Type is Sora (sans) + JetBrains Mono (data only)**, self-hosted with
  `next/font/google` in `layout.tsx` and exposed through `--font-sans` /
  `--font-mono`. Owner's call (Oct 2026), replacing the earlier system stack:
  "techy and soft". Don't add other faces.
- **The world is a pale, lit fog chamber (owner's call, Oct 2026)**: igloo.inc's
  aura mixed with the crystal archive. Slate ink on fog, bead-built solids, frosted
  ice glass. Not dark mode. Frost panels are a deliberate material, not decoration.
  The visual direction contract lives in `.impeccable/surfaces/`; product truth in
  `PRODUCT.md`.
- **The owner has macOS Reduce Motion on.** The bottom-left "Motion" toggle lets
  any visitor choose full or reduced motion, overriding the OS (lib/motionPref.ts:
  an inline <head> script patches `matchMedia` and sets html[data-motion] before
  hydration; CSS reduced-motion rules are guarded by data-motion). To test motion
  in a browser, use that toggle (it reloads) or an init-script override matching
  on `no-preference` — "prefers-reduced-motion" itself contains "reduce".
- **Sound** is synthesised Web Audio (lib/sound.ts): drone + gust-driven air and
  ice glints, modelled on measured spectra of the igloo.inc reference, not
  sampled. Off until the visitor turns it on; resumes on first gesture next visit.

Use the GSAP and R3F skills for API correctness — they are the authority on those
libraries. Use Context7 for anything version-specific (Three.js breaks APIs between
releases).

## Design system — non-negotiable

- Every colour, space, radius, duration and easing is a token on `:root`. No literals.
- Hard 8px spacing grid (`--s-1` … `--s-32`). `--s-opt` (4px) is for optical
  nudges only, never layout.
- Animate `transform` and `opacity` only. Declare `will-change` on anything GSAP moves.
- Import `gsap`, `ScrollTrigger`, `SplitText`, `useGSAP` from `@/lib/gsap`, never
  from `gsap` directly — that module owns plugin registration.

## Architecture invariants

These each cost a debugging session to learn. Keep them.

**Per-frame state lives outside React.** Scroll, pointer and hover values go in
the mutable singletons `scrollState` (`lib/scrollState.ts`) and `archiveState`
(`lib/archiveState.ts`), written by ScrollTrigger and read in `useFrame`. Never
`useState` for anything that changes per frame. React state is for things that
change a handful of times (active chapter, open dossier via `useDossier()`).

**Formations follow chapter space, not page progress.** Sections have very
different heights (the archive is 230svh), so the particle field and camera read
`scrollState.chapterSmooth` — measured against section centres in `SmoothScroll.tsx`
— where 2.0 means chapter 2 is centred. Raw `progress` only drives the atmosphere.

**The canvas never unmounts** and has `pointer-events: none`. Interaction belongs to
DOM elements: the archive shards are driven by real `<button>` slots, not raycasting.

**The one second canvas is `StageCanvas`** (the socials stage: a GPU-simulated
bead volume on a pedestal, modelled frame-by-frame on igloo.inc's social marks).
Beads have velocity and a soft spring home; the cursor is a gust along its own
velocity; per-bead heat (velocity.w) loosens, swirls and whitens beads and cools
from the base up; switching mark kicks heat so the old shape smokes apart. The
turn rate varies (slow front-on), so the yaw is integrated. It is a separate room with its own fixed camera, so it must not
inherit the background canvas's dolly and art direction. It renders only while on
screen.

**The stage's world is a pre-rendered plate, not live 3D.** `art/scripts/stage_world.py`
builds each social's world in Blender (Cycles; CC0 Poly Haven sky and snow in the
git-ignored `art/src/`) from the stage's exact camera, and publishes
`public/stage/<glyph>.webp`. `Backdrop` draws it on a plane locked to the camera
at the same vertical fov, so the rendered ice plinth registers with the live mark
at any aspect. The plate is drawn in the OPAQUE pass (custom premultiplied
blending, renderOrder first): as a transparent object three would draw it after,
and over, the beads. Moving the mark's layout means re-rendering (PEDESTAL_TOP).

**Project crystals with `core.plate` are path traced, not shaded live.**
`art/scripts/crystal_core.py` builds the object frozen in ice in Cycles (chipped
hull, hammered bump, frost volume, trapped bubbles, dark-field flags) and renders
one yaw sweep; `--pack` plays it there and back into `public/crystals/<core>.mp4`
with colour stacked over alpha (H.264 has none), plus a straight-alpha `.webp`
poster and a `.json` with the Blender camera, each frame's pivot matrix and the
ice block's evenly re-triangulated surface (the hover mesh covers the whole
crystal, not just the core: owner's call). The ice is glacial blue-slate with
dense melt ripples on every face, matched to the owner's igloo.inc reference
(Oct 2026); the core reads softened but legible through it. `IceCrystal` plays it on a camera-facing
plate (premultiplied blending, linearised in the shader) and draws the hover
mesh by pushing the envelope through that camera and the pose of the frame on
screen (requestVideoFrameCallback), so it registers with the picture. The
gallery sizes the plate from the slot's pixel height. The look is a product
shot: a near-black studio world with gradient softbox cards (invisible to the
camera) and a pale backdrop straight behind; a smooth grey world reads dull.
Shadow rays pass through the ice so lights reach the core directly. Render on
the Metal GPU only and untiled: CPU+GPU, or 512 px tiles, split the frame into
slices that come out a shade apart, and the seams read as level lines across
the ice. The V8 is modelled in the script (`core_v8_built`); a Sketchfab glTF
dropped at `art/src/v8/scene.gltf` takes over if present. A world's Generated
coordinate is -1..1, not 0..1. The build shrinks each core until no sampled
vertex is outside the ice (`CORE OUTSIDE ICE: 0/…` in the log); metal or a
hose breaking the surface is the first thing that reads as fake. On the page
the gallery renders in `IceOverlay`, after the composer, so bloom on the pale
page cannot haze the renders; and Archive thins the fixed legibility `Scrim`
(`--scrim`) while the gallery is up. That scrim veiled the left crystal at
60–82% and was the real reason the first one looked washed out: when a
finished render looks flat on the page, measure what is drawn over it before
retuning the render.

**The background canvas pauses while the stage covers it.** The plate is opaque,
so at `scrollState.stage >= 0.995` `PauseUnderStage` (Scene.tsx) sets R3F's
frameloop to `never`, watched from GSAP's ticker (R3F's own loop is off then).
Rendering both full-screen canvases dropped frames there, which is what made the
cursor lag. The stage canvas is capped at 1.5× DPR for the same reason. Don't add more canvases
without the same justification.

**Stage scroll triggers anchor to the pin, not to elements below it.** Anything
after the pinned stage is measured from `walk.scrollTrigger.end`; a trigger on the
footer can resolve before the pin spacer exists and fire while the stage is still on
screen.

**Rotation with a variable rate must be integrated.** `angle += rate * dt`, never
`angle = elapsed * rate` — changing the rate teleports the angle.

**Shards sit behind their DOM slots by measurement, never by layout maths.**
`Archive` registers its slot buttons in `archiveState.slots`; `CrystalGallery` casts
a ray from the live camera through each slot's on-screen centre onto z = 0 every
frame. Projects is a vertical stack of full-height stages, one per project (owner's
call, after igloo.inc's portfolio): the crystal is centred in its stage and rises
through the screen as you scroll, rolling a little (`ROLL`) and cross-dissolving
with the next from a third of a screen out; scrolling spins its sway up via video
playbackRate. Labels sit around it (title upper left with a leader that drops into
the ice, readout right, call to action lower right, both inset clear of the rail).
While the gallery is up the bead field steps back (×0.1) as the scrim does: the
section is tall, so the Experience formation otherwise hung beside the first crystal.
`Chapter hold` is no longer used here.

**The hover mesh is one directional, organic wave.** Owner's calls, in order:
no glow at rest, no disc "punched" along the path, no stacked radiations, but
the surrounding mesh must glow naturally, and small movements count too (a
fixed distance threshold read as a dead zone). Any movement past a few pixels
starts a single wave, its strength scaled by the net distance moved since the
last wave (a nudge is faint, a sweep full; net, so a trembling hand cancels out), as a pinpoint where the pointer is, easing outward (to 0.3 plate heights over 1.5 s) along its recent
heading (smoothed, so a jittery nudge cannot point it backwards). The mesh it passes over glows: brightest along a soft leading edge,
fading behind it, with its reach warped by fbm noise and its brightness mottled,
so it spreads like light through ice and never reads as a disc or a circle with
a radius (owner's call after a thin-front-only version looked dead). The next
waits until it is half spent (two uniform slots, never more). Each wave plays one
`sound.sparkle()` chime (E-major pentatonic bell partials, panned, rate-limited),
silent unless Sound is on.

**Text on the left, the bead field on the right.** Chapter headings are real h2s
with the caption beneath them (no numbered eyebrow labels, no numbers in nav or
rail — owner's call); every `ART` formation sits right of the reading column.
A right-aligned caption or a centred formation lands text on beads.

**HUD lives in the gutters.** Progress rail right, Sound/Motion icon buttons left
(top bar on phones). Anything fixed over the content column covers text in every
chapter.

**Every section boundary must dissolve.** The stage plate feathers its leading
edge while the section moves in or out, the mark arrives/leaves by bead density
with `scrollState.stage`, the selector veil fades out (`--veil`), and the field
returns thinned for the footer (`scrollState.outro`). A full-width hairline or a
clipped gradient at a hand-off reads as a hard cut.

**Displace shard vertices radially, never along the facet normal.**
`PolyhedronGeometry` is non-indexed: a corner exists once per face with a different
normal per copy, so normal displacement tears the mesh open. Same reason the base
displacement is keyed on position, not vertex index.

**Depth order is load-bearing.** Particles are opaque lit beads in the opaque pass
(`depthWrite: true`), so three draws them before any transparent object and the glass
composites over correctly sorted beads. Shards: back faces 0 (no depth write) → core
1 → front faces 2 → network 3–4 (depth test off, normal blending). Nothing on this
page may use additive blending: additive light vanishes against fog.

**Beads fade by density, not alpha.** Field "opacity" discards whole beads by seed;
stage beads dither out whole. Translucent beads read as smudges on a pale ground.

**Global utility classes inside CSS Modules need `:global(...)`.** A bare `.u-mono`
in a module is renamed and silently never matches.

**A CSS Module class that only JS uses must still be declared in the CSS.**
An undeclared `styles.foo` is `undefined`: the element gets the literal class
"undefined" and `querySelector('.undefined')` matches the first such element,
so two hooks silently resolve to the same node (an old flip-card component's halves did).

**`<shaderMaterial uniforms={…}>` copies the uniforms.** Mutating the memo'd
object afterwards updates a dead copy. Write per-frame values through
`materialRef.current.uniforms` (Atmosphere was frozen for months this way), or
build the material with `new THREE.ShaderMaterial` and hold that instance.

**No shader may output NaN: bloom turns one NaN pixel into a black block.**
The mipmap blur carries it down to the coarsest levels and upsamples it over
a third of the screen (seen as sporadic black flicker). On Macs `pow()` of a
negative base is NaN, so clamp every `pow` base (`1.0 - NdotV` can be a hair
below zero), never `normalize` a vector that can be zero, keep final colours
`>= 0`, and keep the `isnan`/`isinf` reset in every GPGPU pass. To catch it,
read the default framebuffer in a microtask after each frame's draw and count
near-black samples.

**Intro tweens use `fromTo` with every property pinned, including `y`.** A plain
`from` re-read a stale pixel offset and left the hero headline parked under its
mask.

**`useGSAP` scopes selector strings to its `scope`.** Elements outside the scope
(e.g. a section from the rail) must be resolved with `getElementById` first, or the
trigger silently matches nothing.

**ScrollTrigger `onUpdate` only fires while active.** Anything it writes must be
reset in `onLeave` / `onLeaveBack`, or the last value sticks.

**SVG gradient strokes use `gradientUnits="userSpaceOnUse"`.** The default bounding
box is zero-width on vertical lines and the stroke paints nothing.

**`mergeGeometries` needs consistent indexing.** Box, Cylinder and Tube are indexed;
Icosahedron isn't. Flatten with `toNonIndexed()` before merging (see `CrystalCore`).

## Verifying visual work

The built-in browser pane suspends `requestAnimationFrame` when hidden: the
simulation freezes, the preloader never finishes, and screenshots come back black.
If `document.visibilityState` is `"hidden"`, the capture is stale, not the app.
Reopen the pane with `preview_start` before judging anything visual.
