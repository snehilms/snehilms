# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The creative and developer community — Awwwards-style peers, creative
technologists and engineers who browse immersive sites to see what is possible.
They arrive curious, explore at their own pace, and judge the craft of the site
itself as much as the work it describes.

## Product Purpose

A personal portfolio for Snehil Kumar, software engineer. The site is itself the
showcase: success is a visitor remembering it and sharing it. Reputation is the
goal; contact and profile links are available but are not the primary
conversion.

## Positioning

A systems engineer's portfolio built as an immersive real-time experience. The
work it presents — low-latency trading infrastructure, LLM tooling, realtime
multiplayer — is the same discipline the site demonstrates: a GPU particle
simulation, refractive glass and scroll choreography held to a frame budget.
The claim a neighbouring portfolio cannot copy is that the medium and the
subject are the same skill.

## Operating Context

Desktop-first exploration with scroll as the primary input, plus pointer hover
and click; must still work by touch and keyboard. Visitors often arrive from
showcase galleries or social shares and compare it against studio sites such as
igloo.inc.

## Capabilities and Constraints

- Next.js 15 App Router, React Three Fiber, GSAP ScrollTrigger, Lenis. One
  persistent WebGL canvas behind DOM chapters; see CLAUDE.md for invariants.
- All copy, projects, architecture graphs and links live in
  `src/config/content.ts`.
- Four chapters: Intro, Experience, Projects (three), Stack; then
  the Socials stage.
- Socials: GitHub, LinkedIn, X, email.

## Brand Commitments

- Name: SNEHIL KUMAR, Software Engineer. Initials SK.
- Narrative: a core sample through an ice shelf — "Cryo Archive".
- Binding visual direction from the owner: a mix of the existing crystal
  world and igloo.inc's aura. Igloo's social section — one large particle
  glyph on stage, switched by a social selector and revealed on scroll — is
  the explicit reference for the socials.
- Type is Sora + JetBrains Mono (owner's explicit call; see CLAUDE.md).

## Evidence on Hand

- Source of truth: `~/Documents/Resume_Snehil.pdf` and `~/Documents/CV_Snehil.pdf`
  (owner-supplied, Oct 2026). Where they differ, the resume is newer.
- Contact: snehilms@gmail.com · linkedin.com/in/snehil-s-kumar.
- Experience: Scrypt (Fullstack Engineer, Aug 2026 – present); Flint Labs
  (Fullstack Developer, Jan 2024 – Jul 2026); Yield3 (2023–24); Propellyr
  Chaintech (2022 intern); KPIT Technologies (2021 intern).
- Verified metrics: on-chain perpetuals exchange scaled to $25B+ cumulative
  volume and 300K+ users; AMM order book and matching engine cut latency 80%
  and DB load 30%; AWS redesign saved $150K, annual infra cost −50%; sub-100ms
  WebSocket pipelines; ETL ingestion +200%; OLAP query latency −75%; payout
  errors −20% (Scrypt).
- Projects: Algorithmic Trading & Market Making Engine (Rust, 2026), AI
  Portfolio Manager (2023), Realtime Scribl (2023).
- Credentials: BITS Pilani B.E. Electrical & Electronics (2019–24); AWS
  Developer Associate; CodeChef 1825 (4★); IMO (SOF) institute-level golds
  2014–16.
- GitHub: github.com/snehilms — confirmed by the owner (Oct 2026 socials round).
- Still missing, must not be invented: X handle (X ships as a mark with no
  link until one exists), live demo or repo links.

## Product Principles

1. The site is the proof. Every effect must be something a systems engineer
   would be proud to explain, and must hold its frame budget.
2. Exploration over conversion. Reward curiosity; never push.
3. Real or absent. No invented metrics, clients or claims.
4. Continuous, never cut. The experience reads as one descent, not slides.
