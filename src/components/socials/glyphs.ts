import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

/* ============================================================================
   SOCIAL GLYPHS — geometry

   Each mark is an SVG path on a 24-unit grid, extruded into a solid slab and
   then thrown away: all that survives is a cloud of points sampled from its
   surface, each carrying the surface normal it was taken from. The normal
   is what lets a bead on the side wall shade darker than one on the face,
   so the cloud still reads as a lit solid rather than a flat stencil.

   GitHub, LinkedIn and X paths are from Simple Icons (CC0-1.0); LinkedIn is
   trimmed to its letterforms. The envelope
   is drawn here: a frame, and a flap that stops just short of it.
   ========================================================================= */

export type GlyphKey = 'github' | 'linkedin' | 'x' | 'email';

const PATHS: Record<GlyphKey, string> = {
  github:
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  /* The letterforms only. The rounded square around them is a solid slab
     with "in" cut out, and in particles a cut-out dissolves into noise. */
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z',
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  email:
    'M1.5 4.5H22.5V19.5H1.5Z M3.5 6.5V17.5H20.5V6.5Z M3.7 6.6L12 12.5L20.3 6.6L20.3 9.1L12 15L3.7 9.1Z',
};

/* A pillow, not a slab. igloo.inc's marks are puffy volumes that read as
   solid from every angle of a full turn, so the extrusion is shallow with a
   deep, many-segment bevel that rounds the faces into the walls. The bevel
   is offset inward by its own size so the silhouette stays exactly the
   logo's: thin features like the X's hollow stroke survive. */
const EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: 3.2,
  bevelEnabled: true,
  bevelThickness: 2.2,
  bevelSize: 0.6,
  bevelOffset: -0.6,
  bevelSegments: 6,
  curveSegments: 12,
};

export type GlyphCloud = {
  positions: Float32Array;
  normals: Float32Array;
  /** Four independent randoms per particle — delay, rate, phase, scatter. */
  seeds: Float32Array;
};

function buildSolid(key: GlyphKey) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${PATHS[key]}"/></svg>`;
  const { paths } = new SVGLoader().parse(svg);
  const shapes = paths.flatMap((p) => SVGLoader.createShapes(p));

  const geometry = new THREE.ExtrudeGeometry(shapes, EXTRUDE);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  /* Fit the larger face dimension to [-1, 1] so one group scale sizes every
     mark identically. Y is flipped because SVG runs downward. */
  const s = 2 / Math.max(size.x, size.y);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(s, -s, s);
  return geometry;
}

/** Samples `count` surface points from the extruded mark. Client-only. */
export function sampleGlyph(key: GlyphKey, count: number): GlyphCloud {
  const geometry = buildSolid(key);
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build();

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    sampler.sample(p, n);
    /* Most beads form the skin; about a third sit deeper in the volume.
       When the cursor tears the skin away, there are beads underneath
       instead of a hollow shell. The squared random keeps the skin dense. */
    const deep = Math.random() < 0.34;
    const r = Math.random();
    p.addScaledVector(n, -(deep ? 0.06 + r * r * 0.26 : r * 0.04));
    p.toArray(positions, i * 3);
    n.toArray(normals, i * 3);
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = Math.random();
  }

  geometry.dispose();
  return { positions, normals, seeds };
}
