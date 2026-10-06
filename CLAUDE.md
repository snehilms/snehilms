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
inherit the background canvas's dolly and art direction. It is transparent so the
shared fog shows through, and renders only while on screen. Don't add more canvases
without the same justification.

**Stage scroll triggers anchor to the pin, not to elements below it.** Anything
after the pinned stage is measured from `walk.scrollTrigger.end`; a trigger on the
footer can resolve before the pin spacer exists and fire while the stage is still on
screen.

**Rotation with a variable rate must be integrated.** `angle += rate * dt`, never
`angle = elapsed * rate` — changing the rate teleports the angle.

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
