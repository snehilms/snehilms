import * as THREE from 'three';

/* ============================================================================
   CRYSTAL GEOMETRY + MESH NETWORK

   Two artefacts are built from one seed:

   1. A faceted shard — an icosahedron whose vertices are pushed out by a
      position-keyed hash. Keying the displacement on POSITION rather than on
      vertex index matters: PolyhedronGeometry is non-indexed, so the same
      corner appears once per touching face. A per-index random would move
      those copies apart and tear the mesh open.

   2. A mesh network — nodes sitting just outside the shard's corners, wired
      to their nearest neighbours, plus a sparse outer cage whose long spans
      reach past the silhouette. That cage is what reads as survey equipment
      rather than as decoration.
   ========================================================================= */

const KEY_PRECISION = 1e4;

function hash3(x: number, y: number, z: number, seed: number) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 43.3) * 43758.5453;
  h -= Math.floor(h);
  return h;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (x: number, y: number, z: number) =>
  `${Math.round(x * KEY_PRECISION)},${Math.round(y * KEY_PRECISION)},${Math.round(z * KEY_PRECISION)}`;

/* --- Shard --------------------------------------------------------------- */

export function makeShardGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    // Deterministic per-corner displacement — identical for every duplicate
    // of the same corner, so facets stay welded.
    /* Wider displacement range than looks sensible on paper. Refraction
       reads facet ANGLE, not facet size, so near-uniform corners produce a
       sphere that happens to have edges. The contrast is what throws light. */
    const n = hash3(v.x, v.y, v.z, seed);
    const radial = 0.70 + n * 0.62;

    v.multiplyScalar(radial);

    // Stretch vertically and taper toward both tips: a shard, not a rock.
    v.y *= 1.42;
    const taper = 1 - Math.min(Math.abs(v.y) / 1.42, 1) * 0.26;
    v.x *= taper;
    v.z *= taper;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  // Flat facets. Smooth normals would read as a blob and lose every edge.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  return geo;
}

/** The unique corners of a shard, in order, deduplicated across faces. */
export function shardCorners(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const seen = new Set<string>();
  const out: THREE.Vector3[] = [];
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = key(v.x, v.y, v.z);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.clone());
  }

  return out;
}

/* --- Network ------------------------------------------------------------- */

export type Network = {
  /** LineSegments geometry: pairs of vertices, one pair per edge. */
  lines: THREE.BufferGeometry;
  /** Points geometry for the node markers. */
  nodes: THREE.BufferGeometry;
  edgeCount: number;
};

type Edge = [THREE.Vector3, THREE.Vector3];

function nearestNeighbours(points: THREE.Vector3[], k: number): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  points.forEach((a, i) => {
    const ranked = points
      .map((b, j) => ({ j, d: a.distanceToSquared(b) }))
      .filter((r) => r.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, k);

    ranked.forEach(({ j }) => {
      const id = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(id)) return;
      seen.add(id);
      edges.push([a, points[j]]);
    });
  });

  return edges;
}

export function buildNetwork(
  corners: THREE.Vector3[],
  seed: number,
  opts: { inflate?: number; neighbours?: number; cageNodes?: number; cageRadius?: number } = {},
): Network {
  const inflate = opts.inflate ?? 1.06;
  const neighbours = opts.neighbours ?? 3;
  const cageNodes = opts.cageNodes ?? 10;
  const cageRadius = opts.cageRadius ?? 1.52;

  const rand = mulberry32(seed + 17);

  // Inner network: the shard's own corners, floated just off the surface.
  const inner = corners.map((c) => c.clone().multiplyScalar(inflate));

  // Outer cage: sparse, far, and deliberately not on the shard — these are
  // the long spans that break the silhouette.
  const cage: THREE.Vector3[] = [];
  for (let i = 0; i < cageNodes; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const r = cageRadius * (0.82 + rand() * 0.42);
    cage.push(
      new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * r,
        Math.cos(phi) * r * 1.15,
        Math.sin(phi) * Math.sin(theta) * r,
      ),
    );
  }

  const edges: Edge[] = [
    ...nearestNeighbours(inner, neighbours),
    ...nearestNeighbours(cage, 2),
  ];

  // Tie each cage node back to its closest corner so the two layers read as
  // one instrument rather than two unrelated wireframes.
  cage.forEach((c) => {
    let best = inner[0];
    let bestD = Infinity;
    inner.forEach((p) => {
      const d = c.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    edges.push([c, best]);
  });

  /* Pack line segments. `aT` runs 0 → 1 along each segment so the fragment
     shader can send a pulse down it; `aSeed` desynchronises those pulses. */
  const linePositions = new Float32Array(edges.length * 2 * 3);
  const lineT = new Float32Array(edges.length * 2);
  const lineSeed = new Float32Array(edges.length * 2);

  edges.forEach(([a, b], i) => {
    const o = i * 6;
    linePositions[o + 0] = a.x;
    linePositions[o + 1] = a.y;
    linePositions[o + 2] = a.z;
    linePositions[o + 3] = b.x;
    linePositions[o + 4] = b.y;
    linePositions[o + 5] = b.z;

    lineT[i * 2 + 0] = 0;
    lineT[i * 2 + 1] = 1;

    const s = rand();
    lineSeed[i * 2 + 0] = s;
    lineSeed[i * 2 + 1] = s;
  });

  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lines.setAttribute('aT', new THREE.BufferAttribute(lineT, 1));
  lines.setAttribute('aSeed', new THREE.BufferAttribute(lineSeed, 1));

  /* Node markers. Cage nodes are drawn smaller than shard corners so the
     eye still reads which layer is the subject. */
  const all = [...inner, ...cage];
  const nodePositions = new Float32Array(all.length * 3);
  const nodeScale = new Float32Array(all.length);
  const nodeSeed = new Float32Array(all.length);

  all.forEach((p, i) => {
    nodePositions[i * 3 + 0] = p.x;
    nodePositions[i * 3 + 1] = p.y;
    nodePositions[i * 3 + 2] = p.z;
    nodeScale[i] = i < inner.length ? 1 : 0.62;
    nodeSeed[i] = rand();
  });

  const nodes = new THREE.BufferGeometry();
  nodes.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
  nodes.setAttribute('aScale', new THREE.BufferAttribute(nodeScale, 1));
  nodes.setAttribute('aSeed', new THREE.BufferAttribute(nodeSeed, 1));

  return { lines, nodes, edgeCount: edges.length };
}
