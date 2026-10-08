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

   Puts each shard exactly behind its DOM slot. Every frame the slot's centre
   on screen is cast as a ray from the live camera onto the z = 0 plane, so
   the shard follows the slot through the chapter's entry, hold and exit, at
   any aspect and under the camera's dolly. (Laying the shards out on fixed
   thirds of the viewport left them hanging on screen while their labels
   scrolled away, and misaligned off a 1440 column.)

   The spacing fallback below is only used before the slots have mounted.
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

  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const shardRefs = useRef<(THREE.Group | null)[]>([]);
  const placed = useRef(projects.map((_, i) => new THREE.Vector3(xFor(i), 0, 0)));
  const tmp = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      ndc: new THREE.Vector2(),
      hit: new THREE.Vector3(),
    }),
    [],
  );

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

    /* --- Registration: shard i behind slot i ---------------------------- */
    let measured = 0;
    projects.forEach((_, i) => {
      const el = archiveState.slots[i];
      if (!el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      tmp.ndc.set(((r.left + r.width / 2) / size.width) * 2 - 1, -(((r.top + r.height / 2) / size.height) * 2 - 1));
      tmp.ray.setFromCamera(tmp.ndc, camera);
      if (tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) {
        placed.current[i].copy(tmp.hit).setZ(0);
        measured++;
      }
    });
    const pitch =
      measured === columns && columns > 1
        ? placed.current[0].distanceTo(placed.current[1])
        : spacing;
    const shardScale = Math.min(pitch * 0.27, 0.92);
    shardRefs.current.forEach((g, i) => {
      if (!g) return;
      if (measured !== columns) placed.current[i].set(xFor(i), 0, 0);
      g.position.copy(placed.current[i]);
      g.scale.setScalar(shardScale);
    });

    /* Opening a dossier slides the chosen shard to centre frame, where the
       panel's backdrop-blur turns it into the panel's own light source. */
    const targetX = focusIndex === -1 ? 0 : -placed.current[focusIndex].x;
    group.position.x = damp(group.position.x, targetX, 3.2, dt);

    const targetZ = focusIndex === -1 ? 0 : 1.1;
    group.position.z = damp(group.position.z, targetZ, 3.2, dt);
  });

  return (
    <group ref={groupRef}>
      {projects.map((project, i) => (
        <group
          key={project.id}
          ref={(g) => {
            shardRefs.current[i] = g;
          }}
          position={[xFor(i), 0, 0]}
          scale={scale}
        >
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
