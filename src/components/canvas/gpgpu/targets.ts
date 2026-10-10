import * as THREE from 'three';

/* ============================================================================
   MORPH TARGETS

   Four point clouds, one per chapter, each packed into an RGBA float texture
   the simulation springs toward. Every generator returns exactly `count`
   points so any target can cross-fade into any other without reindexing.

   The narrative, in geometry:
     0  SIGNAL   sphere shell      — a frozen core, still transmitting
     1  THAW     the stream        — procedural (simulation.glsl.ts), and a
                                   chain of career glyphs (careerGlyphs.ts)
     2  ARCHIVE  lattice of cells  — the storage grid, work preserved
     3  STRATA   horizontal bands  — a core sample, read top to bottom
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

/* --- Initial state ----------------------------------------------------- */
/** The field starts already formed as the opening sphere, bead for bead the
    same positions as its target, so a reload shows the sphere at once rather
    than beads gathering in from across the screen (owner's call).
    `w` carries a stable per-particle seed the simulation reads every frame. */
export function initialPositions(count: number): Cloud {
  const out = sphereShell(count);
  const rand = mulberry32(97);
  for (let i = 0; i < count; i++) out[i * 4 + 3] = rand();
  return out;
}

/* --- Packing ----------------------------------------------------------- */
export function cloudToTexture(cloud: Cloud, size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(cloud, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

/** Builds every chapter target for a given simulation resolution, in
    chapter order. Chapter 1 is the stream, which the simulation computes
    itself, so its slot holds the sphere as a placeholder it never samples. */
export function buildTargets(size: number): THREE.DataTexture[] {
  const count = size * size;
  const sphere = cloudToTexture(sphereShell(count), size);
  return [
    sphere,
    sphere,
    cloudToTexture(latticeCloud(count), size),
    cloudToTexture(strataCloud(count), size),
  ];
}
