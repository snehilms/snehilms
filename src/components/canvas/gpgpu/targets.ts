import * as THREE from 'three';

/* ============================================================================
   MORPH TARGETS

   Five point clouds, one per chapter, each packed into an RGBA float texture
   the simulation springs toward. Every generator returns exactly `count`
   points so any target can cross-fade into any other without reindexing.

   The narrative, in geometry:
     0  SIGNAL   sphere shell      — a frozen core, still transmitting
     1  THAW     initials          — a shape resolves out of the ice
     2  ARCHIVE  lattice of cells  — the storage grid, work preserved
     3  STRATA   horizontal bands  — a core sample, read top to bottom
     4  SURFACE  opening ring      — the shelf breaks, channel opens
   ========================================================================= */

export const FIELD = {
  radius: 2.7,
  width: 5.6,
  height: 3.1,
  depth: 1.5,
} as const;

type Cloud = Float32Array; // length = count * 4  → xyz = position, w = unused

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Deterministic PRNG — the same field every reload, so art-direction sticks. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- 00 · SIGNAL ------------------------------------------------------- */
/** Fibonacci sphere shell with radial noise — even coverage, no pole pinch. */
export function sphereShell(count: number, radius: number = FIELD.radius): Cloud {
  const rand = mulberry32(11);
  const out = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = GOLDEN * i;

    // Thicken the shell slightly so it reads as volume, not a soap bubble.
    const jitter = radius * (0.88 + rand() * 0.2);

    const o = i * 4;
    out[o + 0] = Math.cos(theta) * r * jitter;
    out[o + 1] = y * jitter;
    out[o + 2] = Math.sin(theta) * r * jitter;
    out[o + 3] = 1;
  }
  return out;
}

/* --- 01 · THAW --------------------------------------------------------- */
/** Rasterise text on a 2D canvas, then sample its opaque pixels as points. */
export function textCloud(
  text: string,
  count: number,
  opts: { worldWidth?: number; depth?: number; weight?: number } = {},
): Cloud {
  const worldWidth: number = opts.worldWidth ?? FIELD.width;
  const depth: number = opts.depth ?? 0.55;
  const weight: number = opts.weight ?? 800;
  const W = 1024;
  const H = 512;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // No 2D context (exotic browser, hardened privacy mode) — fall back to a
  // shape rather than rendering nothing.
  if (!ctx) return sphereShell(count, FIELD.radius * 0.8);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const stack = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`;

  // Fit the string to ~82% of the canvas width.
  let fontSize = 420;
  ctx.font = `${weight} ${fontSize}px ${stack}`;
  const measured = ctx.measureText(text).width;
  fontSize = Math.min(fontSize * ((W * 0.82) / measured), H * 0.74);

  ctx.font = `${weight} ${fontSize}px ${stack}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);

  const pixels = ctx.getImageData(0, 0, W, H).data;

  // Collect every lit pixel, then sample down to `count`.
  const candidates: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (pixels[i * 4] > 128) candidates.push(i);
  }
  if (candidates.length === 0) return sphereShell(count, FIELD.radius * 0.8);

  const rand = mulberry32(23);
  const worldHeight = worldWidth * (H / W);
  const out = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const p = candidates[(rand() * candidates.length) | 0];
    const px = p % W;
    const py = (p / W) | 0;

    // Sub-pixel jitter stops the cloud from looking like a screen door.
    const o = i * 4;
    out[o + 0] = ((px + rand()) / W - 0.5) * worldWidth;
    out[o + 1] = -((py + rand()) / H - 0.5) * worldHeight;
    out[o + 2] = (rand() - 0.5) * depth;
    out[o + 3] = 1;
  }
  return out;
}

/* --- 02 · ARCHIVE ------------------------------------------------------ */
/** A 3D grid of hollow cells. Particles sit on cell edges, not in centres,
    so the structure reads as architecture rather than as fog. */
export function latticeCloud(count: number, cols = 9, rows = 5, layers = 3): Cloud {
  const rand = mulberry32(37);
  const out = new Float32Array(count * 4);

  const cellW = FIELD.width / cols;
  const cellH = FIELD.height / rows;
  const cellD = FIELD.depth / layers;

  for (let i = 0; i < count; i++) {
    const cx = (rand() * cols) | 0;
    const cy = (rand() * rows) | 0;
    const cz = (rand() * layers) | 0;

    const baseX = (cx / (cols - 1) - 0.5) * FIELD.width;
    const baseY = (cy / (rows - 1) - 0.5) * FIELD.height;
    const baseZ = (cz / Math.max(layers - 1, 1) - 0.5) * FIELD.depth;

    // Push each point onto one face of its cell — this is what creates edges.
    const axis = (rand() * 3) | 0;
    const sign = rand() > 0.5 ? 0.5 : -0.5;

    const o = i * 4;
    out[o + 0] = baseX + (axis === 0 ? sign * cellW : (rand() - 0.5) * cellW * 0.92);
    out[o + 1] = baseY + (axis === 1 ? sign * cellH : (rand() - 0.5) * cellH * 0.92);
    out[o + 2] = baseZ + (axis === 2 ? sign * cellD : (rand() - 0.5) * cellD * 0.92);
    out[o + 3] = 1;
  }
  return out;
}

/* --- 03 · STRATA ------------------------------------------------------- */
/** Horizontal sediment bands of varying density — an ice core, in section. */
export function strataCloud(count: number, bands = 4): Cloud {
  const rand = mulberry32(53);
  const out = new Float32Array(count * 4);

  // Uneven band thickness and density is what sells it as a real core sample.
  const density = [0.34, 0.24, 0.26, 0.16];
  const thickness = [0.34, 0.2, 0.26, 0.16];

  const cumulative: number[] = [];
  let acc = 0;
  for (let b = 0; b < bands; b++) {
    acc += density[b % density.length];
    cumulative.push(acc);
  }

  for (let i = 0; i < count; i++) {
    const r = rand() * acc;
    let band = 0;
    while (band < bands - 1 && r > cumulative[band]) band++;

    const bandCentre = (band / (bands - 1) - 0.5) * FIELD.height;
    const bandThickness = thickness[band % thickness.length] * FIELD.height * 0.5;

    const o = i * 4;
    out[o + 0] = (rand() - 0.5) * FIELD.width * 1.12;
    out[o + 1] = bandCentre + (rand() - 0.5) * bandThickness;
    out[o + 2] = (rand() - 0.5) * FIELD.depth * 1.3;
    out[o + 3] = 1;
  }
  return out;
}

/* --- 04 · SURFACE ------------------------------------------------------ */
/** An open annulus, tilted toward the camera. The shelf breaking apart. */
export function ringCloud(count: number, inner = 2.5, outer = 4.5): Cloud {
  const rand = mulberry32(71);
  const out = new Float32Array(count * 4);
  const tilt = -Math.PI * 0.22;

  for (let i = 0; i < count; i++) {
    const angle = rand() * TAU;
    // sqrt keeps the radial distribution uniform by area, not by radius.
    const t = Math.sqrt(rand());
    const radius = inner + t * (outer - inner);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (rand() - 0.5) * 0.36 + Math.sin(angle * 3) * 0.14;

    const o = i * 4;
    out[o + 0] = x;
    out[o + 1] = y * Math.cos(tilt) - z * Math.sin(tilt);
    out[o + 2] = y * Math.sin(tilt) + z * Math.cos(tilt);
    out[o + 3] = 1;
  }
  return out;
}

/* --- Initial state ----------------------------------------------------- */
/** Far, sparse, and slow — so the intro is a gathering, not a reveal.
    `w` carries a stable per-particle seed the simulation reads every frame. */
export function initialPositions(count: number): Cloud {
  const rand = mulberry32(97);
  const out = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const theta = rand() * TAU;
    const phi = Math.acos(2 * rand() - 1);
    // Close enough that the gather completes while the preloader is still
    // covering the screen — the visitor never sees the unformed state.
    const radius = 6 + rand() * 4;

    const o = i * 4;
    out[o + 0] = Math.sin(phi) * Math.cos(theta) * radius;
    out[o + 1] = Math.sin(phi) * Math.sin(theta) * radius * 0.6;
    out[o + 2] = Math.cos(phi) * radius;
    out[o + 3] = rand(); // seed
  }
  return out;
}

/* --- Packing ----------------------------------------------------------- */
export function cloudToTexture(cloud: Cloud, size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(cloud, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

/** Builds every target for a given simulation resolution, in chapter order. */
export function buildTargets(size: number, initials: string): THREE.DataTexture[] {
  const count = size * size;
  return [
    sphereShell(count),
    textCloud(initials, count),
    latticeCloud(count),
    strataCloud(count),
    ringCloud(count),
  ].map((cloud) => cloudToTexture(cloud, size));
}
