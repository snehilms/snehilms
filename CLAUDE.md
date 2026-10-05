# Cryo Archive — portfolio

Immersive software-engineer portfolio in the Igloo.inc / Hatom.com vein. Next.js 15
(App Router), React 19.2, React Three Fiber 9, GSAP 3 + ScrollTrigger + SplitText,
Lenis. One persistent WebGL canvas with five DOM chapters scrolling over it:
signal → thaw → archive → strata → surface.

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
- **Type is the system font stack** in `--font-sans` / `--font-mono`. Not `next/font`
  webfonts. This was the owner's explicit call.
- **Dark-first, deep gradients and glass layers are the brief**, not a template
  default. Impeccable's hook will flag glassmorphism and dark gradients; weigh its
  findings against the brief rather than "fixing" intended choices. Its other
  findings (contrast, spacing, hierarchy, a11y) are fair game.

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

**Rotation with a variable rate must be integrated.** `angle += rate * dt`, never
`angle = elapsed * rate` — changing the rate teleports the angle.

**Displace shard vertices radially, never along the facet normal.**
`PolyhedronGeometry` is non-indexed: a corner exists once per face with a different
normal per copy, so normal displacement tears the mesh open. Same reason the base
displacement is keyed on position, not vertex index.

**Depth order is load-bearing.** Particles: `depthTest: true`, `depthWrite: false`,
`renderOrder 10`. Shards: back faces 0 (no depth write) → core 1 → front faces 2
(writes depth while opacity > 0.55) → network 3–4 (depth test off). With particle
depth testing off, the field paints over the glass and no material tuning helps.

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
