/* ============================================================================
   CONTENT — the only file you need to edit to make this portfolio yours.
   Every string, project, architecture graph and link the site renders comes
   from here. Nothing below this file's export is hardcoded in a component.
   ========================================================================= */

/* --- Architecture graph model -------------------------------------------
   Nodes are placed on a lane/row grid, not in pixels. The dossier computes
   real coordinates from `col` and `row`, so adding a node never requires
   re-laying-out the diagram by hand.
   ---------------------------------------------------------------------- */

export type NodeKind = 'source' | 'core' | 'model' | 'store' | 'sink';

export type ArchNode = {
  id: string;
  label: string;
  sub?: string;
  kind: NodeKind;
  col: number;
  row: number;
};

export type ArchEdge = {
  from: string;
  to: string;
  label?: string;
  /** Feedback / async paths render dashed and flow in reverse. */
  feedback?: boolean;
};

export type Architecture = {
  lanes: string[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  notes: string[];
};

/* The artefact suspended inside a project's crystal.

   `kind` selects one of the generated cores in CrystalCore.tsx. Set `model`
   to a .glb path under /public to use a real model instead — see the note in
   that file for where to source one. */
export type CoreKind = 'ladder' | 'graph' | 'ribbon';

export type Core = {
  kind: CoreKind;
  model?: string;
  /** Uniform scale applied to a loaded model so it fits inside the shard. */
  modelScale?: number;
  /** A path-traced ice crystal (art/scripts/crystal_core.py), by base path:
      '/crystals/v8' loads v8.mp4, v8.webp and v8.json. Replaces the shard. */
  plate?: string;
};

export type Project = {
  id: string;
  index: string;
  title: string;
  codename: string;
  role: string;
  year: string;
  blurb: string;
  stack: string[];
  metric?: { value: string; label: string };
  /** Telemetry strip rendered beside the crystal, Igloo-style. */
  readout: { label: string; value: string }[];
  core: Core;
  architecture: Architecture;
  href?: string;
  repo?: string;
};

export type Stratum = {
  depth: string;
  label: string;
  items: string[];
};

export const identity = {
  name: 'SNEHIL S KUMAR',
  initials: 'SK',
  role: 'Software Engineer',
  /* Hero headline is split on \n — each line gets its own mask reveal. */
  headline: 'SNEHIL\nS KUMAR',
  tagline:
    'Software engineer working across low-latency systems, real-time data, and interfaces that have no right to feel this smooth.',
  /* Flipped one at a time under the name, like a split-flap clock. */
  roles: [
    'Fullstack Engineer',
    'Web3 Developer',
    'AI Engineer',
    'Finance Enthusiast',
    'Taekwondo Champion',
    'AWS Architect',
    'Swimmer',
  ],
  /* Hero subheading. Shown as `from`, then glitches word by word into `to`.
     Words are aligned by position: equal words ("of all trades,") hold still,
     only the ones that differ glitch. */
  motto: {
    from: 'Jack of all trades, master of none.',
    to: 'Master of all trades, grandmaster at some, enlightened at one.',
  },
  location: 'Remote · IST (UTC+5:30)',
  availability: 'Open to select work — 2026',
  email: 'snehilms@gmail.com',
} as const;

/* The narrative spine. Each chapter owns a slice of global scroll progress
   and a morph target for the particle field. Order here IS page order. */
export const chapters = [
  {
    id: 'intro',
    title: 'Intro',
    caption: 'Low-latency systems and the interfaces on top.',
  },
  {
    id: 'experience',
    title: 'Experience',
    caption: 'Exchanges, schedulers, realtime data: what I have built and scaled.',
  },
  {
    id: 'projects',
    title: 'Projects',
    caption: 'Three systems, end to end. Open one for its architecture.',
  },
  {
    id: 'stack',
    title: 'Stack',
    caption: 'The tools I reach for, from the interface down to the platform.',
  },
  {
    id: 'contact',
    title: 'Contact',
    caption: 'Email is fastest. Every other channel is just below.',
  },
] as const;

export type ChapterId = (typeof chapters)[number]['id'];

/* The socials stage follows the last chapter. It is a nav destination but not
   a chapter: chapter space drives the particle field, and the stage is its own
   room with its own canvas. */
export const socialsSection = { id: 'socials', title: 'Socials' } as const;

export const about = {
  lead: 'I build the unglamorous middle — the order books, the schedulers, the serialization — and then I make the surface feel effortless.',
  body: [
    'Most of what I do never gets seen. Feed handlers that do not drop a tick under burst. Schedulers that hold a fixed rate while the room fills up. Serialization that cuts bandwidth without costing tail latency.',
    'The other half is the part people touch. I care about the 16ms budget, about motion that carries meaning instead of decoration, and about interfaces that tell you where you are without a tooltip.',
    'Across trading engines, LLM tooling and realtime multiplayer, the lesson repeats: the systems that survive are the ones that were boring on purpose in exactly the right places.',
  ],
  /* From the resume (Flint Labs, 2024–26). Verified figures only — these are
     the first thing a reader checks. */
  stats: [
    { value: '$25B+', label: 'Volume through the perps exchange I scaled' },
    { value: '300K+', label: 'Traders on that exchange' },
    { value: '−80%', label: 'Matching-engine latency' },
  ],
} as const;

/* ============================================================================
   PROJECTS

   Each one is a crystal in the archive. `readout` drives the HUD strip beside
   the shard; `architecture` drives the dossier diagram behind it.
   ========================================================================= */

export const projects: Project[] = [
  {
    id: 'market-maker',
    index: '01',
    title: 'Market Making Engine',
    codename: 'ARCHIVE_CO_01',
    role: 'Systems Engineer',
    year: '2026',
    blurb:
      'A low-latency algorithmic trading and market making engine in Rust. Multiple strategies drive dynamic spread adjustment and inventory risk management across prediction and spot markets, quoting continuously off a lock-free order book.',
    stack: ['Rust', 'WebSocket', 'Lock-free', 'FIX', 'Tokio'],
    metric: { value: 'μs', label: 'Quote loop budget' },
    readout: [
      { label: 'LANG', value: 'RUST' },
      { label: 'VENUE', value: 'SPOT + PRED' },
      { label: 'D', value: '01.2026' },
    ],
    core: { kind: 'ladder', plate: '/crystals/v8' },
    architecture: {
      lanes: ['INGEST', 'BOOK', 'STRATEGY', 'EXECUTION'],
      nodes: [
        { id: 'ws', label: 'Venue Feed', sub: 'streaming L2', kind: 'source', col: 0, row: 0 },
        { id: 'snap', label: 'REST Snapshot', sub: 'resync on gap', kind: 'source', col: 0, row: 2 },
        { id: 'handler', label: 'Feed Handler', sub: 'zero-copy parse', kind: 'core', col: 1, row: 0 },
        { id: 'book', label: 'L2 Order Book', sub: 'lock-free', kind: 'store', col: 1, row: 2 },
        { id: 'signal', label: 'Signal Engine', sub: 'microprice · imbalance', kind: 'core', col: 2, row: 0 },
        { id: 'spread', label: 'Spread Model', sub: 'dynamic adjustment', kind: 'model', col: 2, row: 1 },
        { id: 'inv', label: 'Inventory Risk', sub: 'skew + hard limits', kind: 'model', col: 2, row: 2 },
        { id: 'quote', label: 'Quote Engine', sub: 'two-sided', kind: 'core', col: 3, row: 0 },
        { id: 'gw', label: 'Order Gateway', sub: 'ack + reconcile', kind: 'sink', col: 3, row: 1 },
        { id: 'pos', label: 'Position Store', sub: 'fills · exposure', kind: 'store', col: 3, row: 2 },
      ],
      edges: [
        { from: 'ws', to: 'handler' },
        { from: 'snap', to: 'handler' },
        { from: 'handler', to: 'book', label: 'apply' },
        { from: 'book', to: 'signal' },
        { from: 'book', to: 'spread' },
        { from: 'signal', to: 'quote' },
        { from: 'spread', to: 'quote' },
        { from: 'inv', to: 'quote', label: 'skew' },
        { from: 'quote', to: 'gw', label: 'place / cancel' },
        { from: 'gw', to: 'pos', label: 'fills' },
        { from: 'pos', to: 'inv', feedback: true, label: 'exposure' },
      ],
      notes: [
        'The quote loop never allocates. Book updates are applied in place and strategy reads a consistent snapshot without locking the writer.',
        'Inventory feeds back into quoting as a skew term, so the engine leans against its own position instead of accumulating it.',
      ],
    },
    href: '#',
    repo: '#',
  },
  {
    id: 'portfolio-ai',
    index: '02',
    title: 'AI Portfolio Manager',
    codename: 'ARCHIVE_CO_02',
    role: 'Full-stack Engineer',
    year: '2023',
    blurb:
      'An LLM-driven portfolio assistant that optimises stock and crypto allocations against CAPM and Efficient Frontier models, then explains itself. Recommendations are conditioned on the user’s risk appetite, diversification and stated financial goals.',
    stack: ['Python', 'LangChain', 'GPT-3.5', 'Streamlit', 'NumPy'],
    metric: { value: 'CAPM', label: 'Allocation basis' },
    readout: [
      { label: 'LANG', value: 'PYTHON' },
      { label: 'MODEL', value: 'GPT-3.5' },
      { label: 'D', value: '07.2023' },
    ],
    core: { kind: 'graph', plate: '/crystals/orrery' },
    architecture: {
      lanes: ['INTERFACE', 'ORCHESTRATION', 'REASONING', 'QUANT'],
      nodes: [
        { id: 'ui', label: 'Streamlit UI', sub: 'chat + charts', kind: 'source', col: 0, row: 0 },
        { id: 'profile', label: 'Risk Profiler', sub: 'appetite · horizon', kind: 'core', col: 0, row: 2 },
        { id: 'agent', label: 'LangChain Agent', sub: 'tool routing', kind: 'core', col: 1, row: 0 },
        { id: 'mem', label: 'Session Memory', sub: 'context window', kind: 'store', col: 1, row: 2 },
        { id: 'llm', label: 'GPT-3.5', sub: 'reasoning + narrative', kind: 'model', col: 2, row: 0 },
        { id: 'tools', label: 'Tool Registry', sub: 'typed signatures', kind: 'core', col: 2, row: 1 },
        { id: 'report', label: 'Allocation Report', sub: 'weights + rationale', kind: 'sink', col: 2, row: 2 },
        { id: 'md', label: 'Market Data', sub: 'prices · returns', kind: 'store', col: 3, row: 0 },
        { id: 'capm', label: 'CAPM Allocator', sub: 'beta · expected return', kind: 'model', col: 3, row: 1 },
        { id: 'ef', label: 'Efficient Frontier', sub: 'mean-variance', kind: 'model', col: 3, row: 2 },
      ],
      edges: [
        { from: 'ui', to: 'agent' },
        { from: 'profile', to: 'agent', label: 'constraints' },
        { from: 'agent', to: 'llm' },
        { from: 'agent', to: 'tools' },
        { from: 'tools', to: 'md' },
        { from: 'tools', to: 'capm' },
        { from: 'tools', to: 'ef' },
        { from: 'capm', to: 'report' },
        { from: 'ef', to: 'report' },
        { from: 'llm', to: 'report', label: 'rationale' },
        { from: 'mem', to: 'agent', feedback: true },
      ],
      notes: [
        'The model never invents a number. Every weight in the report comes from the quant tools; the LLM is restricted to routing, interpretation and explanation.',
        'Risk profile enters as a hard constraint on the optimiser, not as a prompt suggestion.',
      ],
    },
    href: '#',
    repo: '#',
  },
  {
    id: 'scribl',
    index: '03',
    title: 'Realtime Scribl',
    codename: 'ARCHIVE_CO_03',
    role: 'Full-stack Engineer',
    year: '2023',
    blurb:
      'A multiplayer drawing game streaming the host’s strokes to every player in the room over WebSockets. Serialization, batching and tick scheduling were tuned together to cut bandwidth without pushing out the tail latency that players actually feel.',
    stack: ['Node.js', 'React', 'Express', 'WebSockets', 'Canvas'],
    metric: { value: 'tick', label: 'Fixed-rate flush' },
    readout: [
      { label: 'LANG', value: 'NODE / TS' },
      { label: 'TRANSPORT', value: 'WEBSOCKET' },
      { label: 'D', value: '02.2023' },
    ],
    core: { kind: 'ribbon', plate: '/crystals/pencil' },
    architecture: {
      lanes: ['CLIENT', 'GATEWAY', 'ROOM', 'TRANSPORT'],
      nodes: [
        { id: 'canvas', label: 'React Canvas', sub: 'pointer capture', kind: 'source', col: 0, row: 0 },
        { id: 'echo', label: 'Local Echo', sub: 'draw before ack', kind: 'core', col: 0, row: 2 },
        { id: 'ws', label: 'WS Gateway', sub: 'Express + ws', kind: 'core', col: 1, row: 0 },
        { id: 'join', label: 'Room Join', sub: 'handshake', kind: 'core', col: 1, row: 2 },
        { id: 'room', label: 'Room Manager', sub: 'host authority', kind: 'core', col: 2, row: 0 },
        { id: 'state', label: 'Stroke State', sub: 'append-only', kind: 'store', col: 2, row: 2 },
        { id: 'tick', label: 'Tick Scheduler', sub: 'fixed-rate flush', kind: 'core', col: 3, row: 0 },
        { id: 'ser', label: 'Delta Serializer', sub: 'binary batching', kind: 'core', col: 3, row: 1 },
        { id: 'fan', label: 'Broadcast Fanout', sub: 'per-room', kind: 'sink', col: 3, row: 2 },
      ],
      edges: [
        { from: 'canvas', to: 'echo', label: 'optimistic' },
        { from: 'canvas', to: 'ws', label: 'strokes' },
        { from: 'join', to: 'ws' },
        { from: 'ws', to: 'room' },
        { from: 'room', to: 'state' },
        { from: 'state', to: 'tick' },
        { from: 'tick', to: 'ser' },
        { from: 'ser', to: 'fan' },
        { from: 'fan', to: 'canvas', feedback: true, label: 'replicate' },
      ],
      notes: [
        'Strokes render locally the moment they are drawn and reconcile on the next tick, so the host never waits on the network to see their own line.',
        'Batching is bounded by the tick, not by buffer size — bandwidth drops without letting any single frame arrive late.',
      ],
    },
    href: '#',
    repo: '#',
  },
];

export const strata: Stratum[] = [
  {
    depth: '0—40m',
    label: 'Surface / Interface',
    items: ['TypeScript', 'React', 'Next.js', 'GSAP', 'Three.js / R3F', 'GLSL', 'HTML / CSS'],
  },
  {
    depth: '40—120m',
    label: 'Transit / Services',
    items: ['Node.js', 'Express', 'WebSockets', 'REST', 'LangChain', 'Streamlit'],
  },
  {
    depth: '120—300m',
    label: 'Core / Systems',
    items: ['Rust', 'C', 'C++', 'Java', 'Python', 'Concurrency', 'Lock-free structures'],
  },
  {
    depth: '300m+',
    label: 'Bedrock / Platform',
    items: ['SQL', 'Jenkins', 'CI/CD', 'Simulation clusters', 'Profiling', 'Observability'],
  },
];

/* The socials stage. `handle` is what the stage prints under the selector.
   An entry without `href` renders as a mark on the stage but links nowhere —
   X stays that way until there is a real handle (add href + handle). */
export type Social = {
  label: string;
  handle: string;
  glyph: 'github' | 'linkedin' | 'x' | 'email';
  href?: string;
};

export const socials: readonly Social[] = [
  { label: 'GitHub', href: 'https://github.com/snehilms', handle: 'snehilms', glyph: 'github' },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/snehil-s-kumar',
    handle: 'snehil-s-kumar',
    glyph: 'linkedin',
  },
  { label: 'X', handle: 'handle to come', glyph: 'x' },
  { label: 'Email', href: `mailto:${identity.email}`, handle: identity.email, glyph: 'email' },
];

export const meta = {
  title: `${identity.name} — ${identity.role}`,
  description: identity.tagline,
  url: 'https://example.com',
} as const;
