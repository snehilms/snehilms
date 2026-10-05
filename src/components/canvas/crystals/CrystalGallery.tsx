'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

import { CrystalShard } from './CrystalShard';
import { projects } from '@/config/content';
import { archiveState, useDossier } from '@/lib/archiveState';
import { damp } from '@/lib/scrollState';

/* ============================================================================
   CRYSTAL GALLERY

   Lays the shards across the viewport on the same thirds the DOM slots use,
   so a label in the document always sits under the shard it names without
   any projection maths or measurement.

   Spacing is derived from `viewport.width` — world units, not pixels — which
   means the row reflows correctly at every aspect ratio and the shards never
   collide on a narrow screen.
   ========================================================================= */

/* Distinct seeds give three visibly different shards from one generator. */
const SEEDS = [7, 23, 61];

export function CrystalGallery() {
  const viewport = useThree((s) => s.viewport);
  const groupRef = useRef<THREE.Group>(null);

  const openId = useDossier();
  const focusIndex = useMemo(
    () => (openId ? projects.findIndex((p) => p.id === openId) : -1),
    [openId],
  );

  const columns = projects.length;
  const spacing = viewport.width / (columns + 0.18);
  /* Sized against the gap, not the viewport: the outer cage of one shard
     must never reach the cage of its neighbour. */
  const scale = Math.min(spacing * 0.27, 0.92);

  const xFor = (i: number) => (i - (columns - 1) / 2) * spacing;

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const group = groupRef.current;

    // One damped presence value, computed once, read by every shard.
    archiveState.presenceSmooth = damp(
      archiveState.presenceSmooth,
      archiveState.presence,
      4,
      dt,
    );

    if (!group) return;

    /* Opening a dossier slides the chosen shard to centre frame, where the
       panel's backdrop-blur turns it into the panel's own light source. */
    const targetX = focusIndex === -1 ? 0 : -xFor(focusIndex);
    group.position.x = damp(group.position.x, targetX, 3.2, dt);

    const targetZ = focusIndex === -1 ? 0 : 1.1;
    group.position.z = damp(group.position.z, targetZ, 3.2, dt);
  });

  return (
    <group ref={groupRef}>
      {projects.map((project, i) => (
        <group key={project.id} position={[xFor(i), 0, 0]} scale={scale}>
          <CrystalShard
            index={i}
            seed={SEEDS[i % SEEDS.length]}
            core={project.core}
            focusIndex={focusIndex}
          />
        </group>
      ))}
    </group>
  );
}
