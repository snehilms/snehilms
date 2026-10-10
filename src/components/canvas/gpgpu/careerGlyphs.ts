/* ============================================================================
   CAREER GLYPHS

   The Experience chapter's formations: the work, as bead sculptures. They are
   built the way igloo.inc builds its particle objects: real 3D forms, beads
   spread over their surfaces by area, and every bead carrying the surface's
   normal so it is lit as part of a solid, not as a dot. Each must read at a
   glance to someone who has never seen this site, so each is a familiar
   object rather than a diagram.

     pipeline  two sources stream through a queue into a database stack
     book      an order book ladder: ask levels above, bid levels below, the
               spread between, sizes churning and the best levels traded away
     vault     a vault door that swings open and pays out to coin stacks

   Every glyph is built in its own canonical frame. The simulation poses it
   (a 3/4 view, turning a little) and animates its moving parts on the GPU:
   the book's sizes churn and its top levels trade away, the vault wheel
   turns and the door swings on its hinge. Each also answers the cursor
   (uHover, in field space): light gathers under it, the pipeline's data
   runs faster, the book's row under it lights and swells, the vault door
   swings wider and its wheel spins up.
   So each bead also carries a part TAG and a PARAM (its position along a
   pipe, or its row in time), and both sides share the constants below
   through GLYPH_GLSL.

   Two textures per glyph:
     position  xyz, w = 1
     attr      x = tag, y = param 0..1, zw = octahedral-encoded normal
   ========================================================================= */

type Vec3 = [number, number, number];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/* --- Part tags (shared with the shaders) --------------------------------- */

export const TAG = {
  PIPE_SOURCE: 1,
  PIPE_STREAM: 2,
  PIPE_QUEUE: 3,
  PIPE_STORE: 4,
  BOOK_ASK: 5,
  BOOK_BID: 6,
  BOOK_AXIS: 7,
  BOOK_TRADE: 8,
  BOOK_SPREAD: 9,
  VAULT_DOOR: 10,
  VAULT_BOLT: 11,
  VAULT_WHEEL: 12,
  VAULT_FRAME: 13,
  VAULT_PAYOUT: 14,
  VAULT_COIN: 15,
} as const;

/* --- Shared layout ------------------------------------------------------- */

export const BOOK = {
  rows: 8, // price levels per side
  anchorX: -1.25, // bars grow right from here
  firstY: 0.2, // first level's centre, from the spread
  pitch: 0.2,
  barH: 0.12,
  barD: 0.4,
  /** Resting size at each level, nearest the spread first. */
  asks: [0.55, 0.8, 1.05, 1.0, 1.45, 1.8, 2.2, 2.6],
  bids: [0.65, 0.75, 1.2, 1.4, 1.35, 1.9, 2.3, 2.7],
} as const;

export const VAULT = {
  /** Shifts the whole vault left so door and coins balance in the frame. */
  shift: -0.35,
  radius: 1.15,
  thickness: 0.28,
  wheelZ: 0.34,
  /** Fully open, the door swings this far on its hinge (radians). */
  open: -0.42,
} as const;

/** Each glyph's 3/4 pose: yaw, then pitch (radians). */
export const GLYPH_POSE = {
  pipeline: { yaw: -0.45, pitch: 0.3 },
  book: { yaw: -0.4, pitch: 0.16 },
  vault: { yaw: -0.2, pitch: 0.1 },
} as const;

/** The same constants as GLSL. */
export const GLYPH_GLSL = /* glsl */ `
  #define TAG_PIPE_STREAM ${TAG.PIPE_STREAM}.0
  #define TAG_BOOK_ASK ${TAG.BOOK_ASK}.0
  #define TAG_BOOK_BID ${TAG.BOOK_BID}.0
  #define TAG_BOOK_TRADE ${TAG.BOOK_TRADE}.0
  #define TAG_BOOK_SPREAD ${TAG.BOOK_SPREAD}.0
  #define TAG_VAULT_DOOR ${TAG.VAULT_DOOR}.0
  #define TAG_VAULT_BOLT ${TAG.VAULT_BOLT}.0
  #define TAG_VAULT_WHEEL ${TAG.VAULT_WHEEL}.0
  #define TAG_VAULT_PAYOUT ${TAG.VAULT_PAYOUT}.0
  const float BOOK_ANCHOR = ${BOOK.anchorX.toFixed(4)};
  const float BOOK_ROWS = ${BOOK.rows.toFixed(1)};
  const float VAULT_HINGE_X = ${(VAULT.shift - VAULT.radius).toFixed(4)};
  const vec2 VAULT_AXIS = vec2(${VAULT.shift.toFixed(4)}, 0.0);

  // Is this a part of the door (which swings), and is it the wheel (which turns)?
  bool isDoor(float tag) { return tag > TAG_VAULT_DOOR - 0.5 && tag < TAG_VAULT_WHEEL + 0.5; }
  bool isTag(float tag, float t) { return abs(tag - t) < 0.5; }

  // Octahedral normal decode.
  vec3 decodeNormal(vec2 e) {
    e = e * 2.0 - 1.0;
    vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return normalize(n);
  }

  vec3 rotY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }
  vec3 rotZ(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }

  // The wheel turns about the door's axis; then the whole door swings on
  // its hinge. Applied to points (pivoted) and normals (not).
  vec3 vaultPoint(vec3 p, float tag, float wheel, float open) {
    if (isTag(tag, TAG_VAULT_WHEEL)) p = vec3(VAULT_AXIS, 0.0) + rotZ(p - vec3(VAULT_AXIS, 0.0), wheel);
    if (isDoor(tag)) p = vec3(VAULT_HINGE_X, 0.0, 0.0) + rotY(p - vec3(VAULT_HINGE_X, 0.0, 0.0), open);
    return p;
  }
  vec3 vaultNormal(vec3 n, float tag, float wheel, float open) {
    if (isTag(tag, TAG_VAULT_WHEEL)) n = rotZ(n, wheel);
    if (isDoor(tag)) n = rotY(n, open);
    return n;
  }

  // One price level of the book at time t (an integrated phase, so the
  // book can quicken under the cursor without jumping).
  //   x: its size now, as a scale of its resting size: orders arriving and
  //      cancelling, each level on its own beat
  //   y: the best level being traded away, 0..1: it is eaten down, flashes,
  //      and refills, asks and bids taking turns
  //   z: how much the cursor is on this level (y is the level's height)
  vec3 bookRow(float tag, float param, float y, float t, vec3 hover, float hoverAmt) {
    float side = isTag(tag, TAG_BOOK_BID) ? 1.0 : 0.0;
    float r = param * (BOOK_ROWS - 1.0);
    float size = 1.0 + 0.14 * sin(t * 0.9 + r * 1.7 + side * 2.1) + 0.07 * sin(t * 2.1 + r * 3.1 + side);
    float cycle = fract(t * 0.15 + side * 0.5);
    float trade = r < 0.5 ? smoothstep(0.0, 0.1, cycle) * (1.0 - smoothstep(0.32, 0.6, cycle)) : 0.0;
    size *= 1.0 - 0.72 * trade;
    float h = hoverAmt * (1.0 - smoothstep(0.06, 0.13, abs(y - hover.y)));
    size *= 1.0 + 0.24 * h;
    return vec3(size, trade, h);
  }
  vec3 bookPoint(vec3 p, float tag, float param, float t, vec3 hover, float hoverAmt) {
    if (isTag(tag, TAG_BOOK_ASK) || isTag(tag, TAG_BOOK_BID)) {
      vec3 b = bookRow(tag, param, p.y, t, hover, hoverAmt);
      p.x = BOOK_ANCHOR + (p.x - BOOK_ANCHOR) * b.x;
    }
    return p;
  }
`;

/* --- Sampling ------------------------------------------------------------ */

type Sample = { p: Vec3; n: Vec3; param: number };
type Part = { weight: number; tag: number; sample: (rand: () => number) => Sample };

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Cylinder side about the y axis. */
function cylSide(c: Vec3, r: number, h: number, tag: number, ink = 1): Part {
  return {
    weight: TAU * r * h * ink,
    tag,
    sample: (rand) => {
      const a = rand() * TAU;
      return {
        p: [c[0] + Math.cos(a) * r, c[1] + (rand() - 0.5) * h, c[2] + Math.sin(a) * r],
        n: [Math.cos(a), 0, Math.sin(a)],
        param: 0,
      };
    },
  };
}

/** Disk (or annulus) facing +y or -y. */
function capY(c: Vec3, r: number, up: number, tag: number, ink = 1): Part {
  return {
    weight: Math.PI * r * r * ink,
    tag,
    sample: (rand) => {
      const a = rand() * TAU;
      const rr = Math.sqrt(rand()) * r;
      return { p: [c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr], n: [0, up, 0], param: 0 };
    },
  };
}

/** Disk (or annulus) facing +z or -z. */
function capZ(c: Vec3, r: number, front: number, tag: number, inner = 0, ink = 1): Part {
  return {
    weight: Math.PI * (r * r - inner * inner) * ink,
    tag,
    sample: (rand) => {
      const a = rand() * TAU;
      const rr = Math.sqrt(inner * inner + rand() * (r * r - inner * inner));
      return { p: [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2]], n: [0, 0, front], param: 0 };
    },
  };
}

/** Cylinder side about the z axis (a door's edge, a coin's rim). */
function rimZ(c: Vec3, r: number, depth: number, tag: number, ink = 1): Part {
  return {
    weight: TAU * r * depth * ink,
    tag,
    sample: (rand) => {
      const a = rand() * TAU;
      return {
        p: [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + (rand() - 0.5) * depth],
        n: [Math.cos(a), Math.sin(a), 0],
        param: 0,
      };
    },
  };
}

function sphere(c: Vec3, r: number, tag: number, ink = 1): Part {
  return {
    weight: 4 * Math.PI * r * r * ink,
    tag,
    sample: (rand) => {
      const z = rand() * 2 - 1;
      const a = rand() * TAU;
      const s = Math.sqrt(1 - z * z);
      const n: Vec3 = [Math.cos(a) * s, Math.sin(a) * s, z];
      return { p: [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n, param: 0 };
    },
  };
}

function box(c: Vec3, s: Vec3, tag: number, ink = 1): Part {
  const areas = [s[1] * s[2], s[1] * s[2], s[0] * s[2], s[0] * s[2], s[0] * s[1], s[0] * s[1]];
  const total = areas.reduce((a, b) => a + b, 0);
  return {
    weight: total * ink,
    tag,
    sample: (rand) => {
      let r = rand() * total;
      let f = 0;
      while (f < 5 && r > areas[f]) r -= areas[f++];
      const axis = f >> 1;
      const sign = f % 2 === 0 ? 1 : -1;
      const p: Vec3 = [(rand() - 0.5) * s[0], (rand() - 0.5) * s[1], (rand() - 0.5) * s[2]];
      p[axis] = (sign * s[axis]) / 2;
      const n: Vec3 = [0, 0, 0];
      n[axis] = sign;
      return { p: [c[0] + p[0], c[1] + p[1], c[2] + p[2]], n, param: 0 };
    },
  };
}

/** A tube along any path, sampled evenly by arc length; param runs 0..1
    along it, remapped to [p0, p1] so connected tubes share one param. */
function tube(path: (t: number) => Vec3, r: number, tag: number, p0 = 0, p1 = 1, ink = 1): Part {
  const N = 128;
  const pts: Vec3[] = [];
  const cum = [0];
  for (let i = 0; i <= N; i++) pts.push(path(i / N));
  for (let i = 1; i <= N; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  }
  const length = cum[N];
  return {
    weight: TAU * r * length * ink,
    tag,
    sample: (rand) => {
      const target = rand() * length;
      let lo = 0;
      let hi = N;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid;
        else hi = mid;
      }
      const f = (target - cum[lo]) / (cum[hi] - cum[lo] || 1);
      const a = pts[lo];
      const b = pts[hi];
      const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const ref: Vec3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
      const s = norm(cross(d, ref));
      const u = cross(s, d);
      const ang = rand() * TAU;
      const n: Vec3 = [
        s[0] * Math.cos(ang) + u[0] * Math.sin(ang),
        s[1] * Math.cos(ang) + u[1] * Math.sin(ang),
        s[2] * Math.cos(ang) + u[2] * Math.sin(ang),
      ];
      return {
        p: [
          a[0] + (b[0] - a[0]) * f + n[0] * r,
          a[1] + (b[1] - a[1]) * f + n[1] * r,
          a[2] + (b[2] - a[2]) * f + n[2] * r,
        ],
        n,
        param: p0 + (p1 - p0) * ((lo + f) / N),
      };
    },
  };
}

function cubic(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3) {
  return (t: number): Vec3 => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
    ];
  };
}

const lerp3 = (a: Vec3, b: Vec3) => (t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Octahedral encode a unit normal into two 0..1 floats. */
function encodeNormal(n: Vec3): [number, number] {
  const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1;
  let x = n[0] / l;
  let y = n[1] / l;
  if (n[2] < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  return [x * 0.5 + 0.5, y * 0.5 + 0.5];
}

export type GlyphCloud = { position: Float32Array; attr: Float32Array };

/** Deal `count` beads across the parts by weight. A part may also add a
    custom weight via `ink` where its surface would otherwise starve. */
function build(parts: Part[], count: number, seed: number, offset: Vec3 = [0, 0, 0]): GlyphCloud {
  const rand = mulberry32(seed);
  const position = new Float32Array(count * 4);
  const attr = new Float32Array(count * 4);
  const cum: number[] = [];
  let total = 0;
  for (const part of parts) {
    total += part.weight;
    cum.push(total);
  }
  for (let i = 0; i < count; i++) {
    const r = rand() * total;
    let lo = 0;
    let hi = parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const part = parts[lo];
    const s = part.sample(rand);
    const o = i * 4;
    position[o + 0] = s.p[0] + offset[0];
    position[o + 1] = s.p[1] + offset[1];
    position[o + 2] = s.p[2] + offset[2];
    position[o + 3] = 1;
    const [ex, ey] = encodeNormal(norm(s.n));
    attr[o + 0] = part.tag;
    attr[o + 1] = s.param;
    attr[o + 2] = ex;
    attr[o + 3] = ey;
  }
  return { position, attr };
}

/* --- Pipeline: Yield3 · Propellyr --------------------------------------- */

const PIPE_OFFSET: Vec3 = [0.2, 0, 0];

export function pipelineCloud(count: number): GlyphCloud {
  const parts: Part[] = [];
  // The store: three stacked discs, as every database icon draws it.
  const cx = 1.15;
  const r = 0.78;
  const h = 0.42;
  for (const yc of [0.62, 0, -0.62]) {
    parts.push(cylSide([cx, yc, 0], r, h, TAG.PIPE_STORE));
    parts.push(capY([cx, yc + h / 2, 0], r, 1, TAG.PIPE_STORE, 0.75));
    parts.push(capY([cx, yc - h / 2, 0], r, -1, TAG.PIPE_STORE, 0.3));
  }
  // Two sources, on-chain above and off-chain below, each a sphere sending
  // its stream in like a tributary. The params join up through the queue,
  // so a pulse runs unbroken from source to store.
  for (const sy of [1.05, -1.05]) {
    const src: Vec3 = [-2.15, sy, -0.25];
    parts.push(sphere(src, 0.2, TAG.PIPE_SOURCE));
    parts.push(tube(cubic(src, [-1.2, sy, -0.2], [-0.9, 0, 0.2], [-0.45, 0, 0.2]), 0.06, TAG.PIPE_STREAM, 0, 0.7, 1.4));
  }
  parts.push(tube(lerp3([-0.45, 0, 0.2], [cx - r + 0.02, 0, 0.2]), 0.06, TAG.PIPE_STREAM, 0.7, 1, 1.4));
  // The queue: four message blocks riding the trunk.
  for (let k = 0; k < 4; k++) parts.push(box([-0.33 + k * 0.21, 0, 0.2], [0.15, 0.15, 0.15], TAG.PIPE_QUEUE, 1.3));
  return build(parts, count, 211, PIPE_OFFSET);
}

/* --- Order book: Flint Labs --------------------------------------------- */

export function bookCloud(count: number): GlyphCloud {
  const B = BOOK;
  const parts: Part[] = [];
  const zd = B.barD;
  for (let k = 0; k < B.rows; k++) {
    const y = B.firstY + k * B.pitch;
    const param = k / (B.rows - 1);
    for (const [side, len, tag] of [
      [1, B.asks[k], TAG.BOOK_ASK],
      [-1, B.bids[k], TAG.BOOK_BID],
    ] as const) {
      // Each level is a solid slab: its size is its length.
      const bar = box([B.anchorX + len / 2, side * y, 0], [len, B.barH, zd], tag, 1);
      parts.push({ ...bar, sample: (rand) => ({ ...bar.sample(rand), param }) });
    }
    // A tick on the price axis for each level.
    for (const side of [1, -1]) {
      parts.push(tube(lerp3([B.anchorX - 0.2, side * y, zd / 2], [B.anchorX - 0.08, side * y, zd / 2]), 0.012, TAG.BOOK_AXIS, 0, 1, 2));
    }
  }
  // The price axis.
  const top = B.firstY + B.pitch * (B.rows - 1) + 0.12;
  parts.push(tube(lerp3([B.anchorX - 0.08, -top, zd / 2], [B.anchorX - 0.08, top, zd / 2]), 0.016, TAG.BOOK_AXIS, 0, 1, 2));
  // The spread: a dashed seam where the two sides meet, and the last trade
  // as a bright knot on the axis.
  for (let x = B.anchorX; x < B.anchorX + 2.4; x += 0.16) {
    parts.push(tube(lerp3([x, 0, zd / 2], [x + 0.08, 0, zd / 2]), 0.014, TAG.BOOK_SPREAD, 0, 1, 2));
  }
  parts.push(sphere([B.anchorX - 0.08, 0, zd / 2], 0.06, TAG.BOOK_TRADE, 2));
  return build(parts, count, 223);
}

/* --- Vault: Scrypt ------------------------------------------------------- */

export function vaultCloud(count: number): GlyphCloud {
  const R = VAULT.radius;
  const th = VAULT.thickness;
  const parts: Part[] = [];
  // The door, closed, in its own frame: a heavy front ring, a recessed face,
  // its edge, a ring of bolts, and the wheel (rim, three bars, hub).
  // The face is kept sparse and the edges dense: a door reads by its rims,
  // bolts and wheel, and an evenly filled face was only noise.
  parts.push(capZ([0, 0, th / 2], R, 1, TAG.VAULT_DOOR, R - 0.2, 1.4));
  parts.push(capZ([0, 0, th / 2 - 0.03], R - 0.2, 1, TAG.VAULT_DOOR, 0, 0.12));
  parts.push(capZ([0, 0, th / 2 - 0.02], R - 0.42, 1, TAG.VAULT_DOOR, R - 0.48, 1.6));
  parts.push(rimZ([0, 0, 0], R, th, TAG.VAULT_DOOR, 1.2));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    parts.push(sphere([Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), th / 2 + 0.03], 0.065, TAG.VAULT_BOLT, 2.4));
  }
  parts.push({
    weight: TAU * 0.5 * TAU * 0.045 * 1.4,
    tag: TAG.VAULT_WHEEL,
    sample: (rand) => {
      const u = rand() * TAU;
      const v = rand() * TAU;
      const n: Vec3 = [Math.cos(u) * Math.cos(v), Math.sin(u) * Math.cos(v), Math.sin(v)];
      return {
        p: [Math.cos(u) * 0.5 + n[0] * 0.045, Math.sin(u) * 0.5 + n[1] * 0.045, VAULT.wheelZ + n[2] * 0.045],
        n,
        param: 0,
      };
    },
  });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const d: Vec3 = [Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0];
    parts.push(tube(lerp3([-d[0], -d[1], VAULT.wheelZ], [d[0], d[1], VAULT.wheelZ]), 0.035, TAG.VAULT_WHEEL, 0, 1, 1.4));
  }
  parts.push(sphere([0, 0, VAULT.wheelZ], 0.12, TAG.VAULT_WHEEL, 1.2));
  // A spindle from the face to the hub, so the wheel is mounted, not floating.
  parts.push(tube(lerp3([0, 0, th / 2], [0, 0, VAULT.wheelZ]), 0.05, TAG.VAULT_WHEEL));

  // The frame the door closes into.
  parts.push(capZ([0, 0, -0.02], R + 0.2, 1, TAG.VAULT_FRAME, R + 0.04, 0.6));

  // Payouts: streams leave the open vault for three coin stacks.
  const accounts: [number, number][] = [
    [2.1, 0.85],
    [2.35, 0],
    [2.1, -0.85],
  ];
  for (const [ax, ay] of accounts) {
    // Four coins with a hair of air between them, so they read as coins.
    for (let j = 0; j < 4; j++) {
      const yc = ay - 0.2 + j * 0.095;
      parts.push(cylSide([ax, yc, 0.1], 0.24, 0.06, TAG.VAULT_COIN, 1.6));
      parts.push(capY([ax, yc + 0.03, 0.1], 0.24, 1, TAG.VAULT_COIN, j === 3 ? 1.6 : 0.5));
    }
    parts.push(tube(cubic([0.2, 0, 0.1], [0.9, ay * 0.2, 0.2], [1.3, ay, 0.2], [ax - 0.25, ay, 0.1]), 0.03, TAG.VAULT_PAYOUT, 0, 1, 1.6));
  }
  return build(parts, count, 227, [VAULT.shift, 0, 0]);
}

/* --- Label anchors --------------------------------------------------------
   Points in each glyph's canonical frame that the DOM pins its labels to
   (content.ts `marks`). On static parts only, so the pose alone places them. */

export type GlyphName = 'pipeline' | 'book' | 'vault';

const bookLevelY = (k: number) => BOOK.firstY + k * BOOK.pitch;

export const GLYPH_ANCHORS: Record<string, { glyph: GlyphName; p: Vec3 }> = {
  onchain: { glyph: 'pipeline', p: [-2.15 + PIPE_OFFSET[0], 1.05 + 0.34, -0.25] },
  offchain: { glyph: 'pipeline', p: [-2.15 + PIPE_OFFSET[0], -1.05 - 0.34, -0.25] },
  queue: { glyph: 'pipeline', p: [-0.2 + PIPE_OFFSET[0], 0.42, 0.2] },
  store: { glyph: 'pipeline', p: [1.15 + PIPE_OFFSET[0], 0.62 + 0.21 + 0.3, 0] },
  asks: { glyph: 'book', p: [BOOK.anchorX + BOOK.asks[7] + 0.25, bookLevelY(7), 0] },
  spread: { glyph: 'book', p: [BOOK.anchorX + 2.55, 0, BOOK.barD / 2] },
  bids: { glyph: 'book', p: [BOOK.anchorX + BOOK.bids[7] + 0.25, -bookLevelY(7), 0] },
  custody: { glyph: 'vault', p: [VAULT.shift, VAULT.radius + 0.36, 0] },
  payouts: { glyph: 'vault', p: [2.1 + VAULT.shift, 0.85 + 0.36, 0.1] },
  // The price column, just left of the axis: one per level, each side.
  ...Object.fromEntries(
    Array.from({ length: BOOK.rows }, (_, k) => [
      [`book-a${k}`, { glyph: 'book' as const, p: [BOOK.anchorX - 0.26, bookLevelY(k), BOOK.barD / 2] as Vec3 }],
      [`book-b${k}`, { glyph: 'book' as const, p: [BOOK.anchorX - 0.26, -bookLevelY(k), BOOK.barD / 2] as Vec3 }],
    ]).flat(),
  ),
};
