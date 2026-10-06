'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { CORE_VERTEX, CORE_FRAGMENT } from './crystal.glsl';
import type { CoreKind } from '@/config/content';

/* ============================================================================
   CRYSTAL CORE

   The artefact suspended inside each shard.

   These are generated rather than downloaded, and each one is a picture of
   the system it belongs to: a two-sided quote ladder, an allocation graph,
   a drawn stroke. A downloaded mascot would look better in isolation and
   say nothing; this says what the project is before you open the dossier.

   Every kind merges down to one geometry and draws in a single call, so the
   cost of three of them on screen is three draws, not three hundred.

   To use a real model instead, set `core.model` on the project to a .glb
   path under /public and the loader below takes over.
   ========================================================================= */

const BOUND = 0.54; // keep every core comfortably inside the shard

/* mergeGeometries refuses to mix indexed and non-indexed inputs, and three's
   primitives disagree: Box, Cylinder and Tube are indexed, Icosahedron is
   not. Flattening every part first is what makes a merge across primitive
   types legal at all. */
function flatten(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.index) return geometry;
  const nonIndexed = geometry.toNonIndexed();
  geometry.dispose();
  return nonIndexed;
}

/** Merge, or fall back to a plain solid rather than returning null. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map(flatten), false);
  if (merged) return merged;

  console.error('[CrystalCore] geometry merge failed; using fallback solid');
  return new THREE.IcosahedronGeometry(BOUND * 0.5, 1);
}

/* --- 01 · Quote ladder ---------------------------------------------------
   Two stacks of resting orders either side of a spread. Bar width falls off
   with distance from the mid, the way real book depth does. */
function buildLadder(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const levels = 9;
  const step = (BOUND * 1.55) / levels;

  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;

    for (let i = 0; i < levels; i++) {
      // Depth thins as you walk away from the touch.
      const depth = Math.pow(1 - i / levels, 0.7);
      const w = 0.09 + depth * 0.40;
      const bar = new THREE.BoxGeometry(w, step * 0.52, 0.075);

      bar.translate(
        (w / 2 - 0.30) * sign,
        sign * (0.055 + i * step),
        Math.sin(i * 1.1 + side) * 0.03,
      );
      parts.push(bar);
    }
  }

  return merge(parts);
}

/* --- 02 · Allocation graph -----------------------------------------------
   Weighted holdings orbiting a centre, wired back to it. */
function buildGraph(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const hub = new THREE.IcosahedronGeometry(0.17, 1);
  parts.push(hub);

  const satellites = 7;
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < satellites; i++) {
    const angle = (i / satellites) * Math.PI * 2;
    const tilt = Math.sin(i * 2.3) * 0.34;
    const radius = 0.34 + (i % 3) * 0.075;

    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      tilt,
      Math.sin(angle) * radius,
    );

    // Node size carries the weight — an equal-weight cluster reads as noise.
    const size = 0.048 + ((i * 37) % 11) / 11 * 0.062;
    const node = new THREE.IcosahedronGeometry(size, 0);
    node.translate(position.x, position.y, position.z);
    parts.push(node);

    // Strut from hub to node, oriented by rotating +Y onto the direction.
    const length = position.length();
    const strut = new THREE.CylinderGeometry(0.006, 0.006, length, 5);
    strut.translate(0, length / 2, 0);

    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      up,
      position.clone().normalize(),
    );
    strut.applyQuaternion(quaternion);
    parts.push(strut);
  }

  return merge(parts);
}

/* --- 03 · Stroke ---------------------------------------------------------
   One drawn gesture, swept as a tube. */
function buildRibbon(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const turns = 2.4;
  const samples = 60;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = t * Math.PI * 2 * turns;
    const radius = 0.16 + t * 0.30;

    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        (t - 0.5) * 0.86,
        Math.sin(angle) * radius * 0.78,
      ),
    );
  }

  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 96, 0.032, 7, false);
}

const BUILDERS: Record<CoreKind, () => THREE.BufferGeometry> = {
  ladder: buildLadder,
  graph: buildGraph,
  ribbon: buildRibbon,
};

/* --- Palette per kind ---------------------------------------------------- */
const CORE_COLORS: Record<CoreKind, { base: THREE.Color; highlight: THREE.Color }> = {
  /* Dark artefacts under pale ice: the core is what the eye finds first. */
  ladder: { base: new THREE.Color('#323b49'), highlight: new THREE.Color('#eef3f8') },
  graph: { base: new THREE.Color('#1c5a80'), highlight: new THREE.Color('#e4f0f8') },
  ribbon: { base: new THREE.Color('#4a5466'), highlight: new THREE.Color('#f4f6f9') },
};

type Props = {
  kind: CoreKind;
  keyDir: THREE.Vector3;
  /** Damped hover, shared with the shard so both respond as one object. */
  hoverRef: React.RefObject<number>;
  opacityRef: React.RefObject<number>;
};

export function CrystalCore({ kind, keyDir, hoverRef, opacityRef }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = BUILDERS[kind]();
    geo.computeVertexNormals();
    geo.center();
    return geo;
  }, [kind]);

  const material = useMemo(() => {
    const palette = CORE_COLORS[kind];
    return new THREE.ShaderMaterial({
      vertexShader: CORE_VERTEX,
      fragmentShader: CORE_FRAGMENT,
      uniforms: {
        uBase: { value: palette.base },
        uHighlight: { value: palette.highlight },
        uKeyDir: { value: keyDir },
        uHover: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      // Writes depth so the front glass blends over it rather than through it.
      depthWrite: true,
      depthTest: true,
    });
  }, [kind, keyDir]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    material.uniforms.uHover.value = hoverRef.current ?? 0;
    material.uniforms.uOpacity.value = opacityRef.current ?? 0;

    /* Counter-rotates the shard slightly so the core does not look welded to
       the glass — it should read as suspended in it. */
    if (meshRef.current) {
      meshRef.current.rotation.y = -time * 0.09;
      meshRef.current.rotation.x = Math.sin(time * 0.24) * 0.10;
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={1} />;
}
