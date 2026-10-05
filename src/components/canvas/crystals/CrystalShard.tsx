'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

import { makeShardGeometry, shardCorners, buildNetwork } from './geometry';
import { CrystalCore } from './CrystalCore';
import { ModelCore } from './ModelCore';
import {
  BODY_VERTEX,
  BODY_FRAGMENT,
  LINE_VERTEX,
  LINE_FRAGMENT,
  NODE_VERTEX,
  NODE_FRAGMENT,
} from './crystal.glsl';
import { archiveState } from '@/lib/archiveState';
import { damp } from '@/lib/scrollState';
import type { Core } from '@/config/content';

/* ============================================================================
   CRYSTAL SHARD

   One project, one shard, drawn in a strict order that is the whole reason
   it reads as a solid object:

     0  back faces    interior facets, no depth write
     1  core          the artefact, writes depth
     2  front faces   the glass, writes depth
     3  network       overlay, depth test off so it is never occluded
    10  particles     depth tested, so the shard punches a hole in the field

   Before this ordering the field's 65k additive points were drawn over
   everything with depth testing disabled, which washed the glass out no
   matter how the material was tuned.
   ========================================================================= */

/* The synthetic environment is deliberately far brighter than the page it
   sits on. Glass has nothing of its own to show — it can only report what is
   around it, and an environment matched to this near-black scene produces a
   near-black crystal no matter how the material is tuned. */
const ENV = {
  low: new THREE.Color('#16273f'),
  high: new THREE.Color('#8fc4e0'),
  band: new THREE.Color('#cfeeff'),
  key: new THREE.Color('#ffffff'),
  rim: new THREE.Color('#7fd4ff'),
};

const GLASS = {
  tint: new THREE.Color('#5fa8d6'),
  ice: new THREE.Color('#7fd4ff'),
  line: new THREE.Color('#bfe2f7'),
  node: new THREE.Color('#e8f4ff'),
  /** Per-channel absorption. Red absorbs fastest, so depth goes cyan.
      Kept low: heavy absorption reads as murk, not as thickness. */
  absorb: new THREE.Vector3(0.42, 0.24, 0.13),
  ior: 1.34, // ice
  dispersion: 0.034,
  baseAlpha: 0.40,
};

/** Key light direction, shared by the glass and the core so they agree. */
const KEY_DIR = new THREE.Vector3(0.45, 0.72, 0.52).normalize();

/** Peak radial displacement on full hover, in object units. Subtle by design. */
const DISTORT_AMOUNT = 0.055;

type Props = {
  index: number;
  seed: number;
  core: Core;
  /** Index of the shard currently opened as a dossier, or -1. */
  focusIndex: number;
};

export function CrystalShard({ index, seed, core, focusIndex }: Props) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const groupRef = useRef<THREE.Group>(null);
  const shardRef = useRef<THREE.Group>(null);
  const hoverRef = useRef(0);
  const revealRef = useRef(0);
  const opacityRef = useRef(0);
  const spinRef = useRef(0);

  // Scratch vector — reused every frame so the loop never allocates.
  const camObj = useRef(new THREE.Vector3());

  /* --- Geometry ------------------------------------------------------- */
  const { shard, network, radius } = useMemo(() => {
    const geo = makeShardGeometry(seed);
    const corners = shardCorners(geo);
    return {
      shard: geo,
      network: buildNetwork(corners, seed),
      radius: geo.boundingSphere?.radius ?? 1.4,
    };
  }, [seed]);

  /* --- Materials ------------------------------------------------------ */
  const materials = useMemo(() => {
    const shared = {
      uTint: { value: GLASS.tint },
      uAbsorb: { value: GLASS.absorb },
      uIce: { value: GLASS.ice },
      uHover: { value: 0 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uDistort: { value: 0 },
      uRadius: { value: radius },
      uIor: { value: GLASS.ior },
      uDispersion: { value: GLASS.dispersion },
      uBaseAlpha: { value: GLASS.baseAlpha },
      uCamObj: { value: camObj.current },
      uEnvLow: { value: ENV.low },
      uEnvHigh: { value: ENV.high },
      uEnvBand: { value: ENV.band },
      uKeyColor: { value: ENV.key },
      uRimColor: { value: ENV.rim },
      uKeyDir: { value: KEY_DIR },
    };

    /* Front and back share uniform OBJECTS, so hover, opacity and the
       object-space camera only have to be written once per frame. */
    const front = new THREE.ShaderMaterial({
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      uniforms: { ...shared, uFacing: { value: 1 } },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    const back = new THREE.ShaderMaterial({
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      uniforms: { ...shared, uFacing: { value: -1 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    });

    const lines = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: {
        uColor: { value: GLASS.line },
        uTime: { value: 0 },
        uDistort: { value: 0 },
        uHover: { value: 0 },
        uOpacity: { value: 0 },
        uReveal: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const nodes = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX,
      fragmentShader: NODE_FRAGMENT,
      uniforms: {
        uColor: { value: GLASS.node },
        uSize: { value: 6.6 },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uDistort: { value: 0 },
        uHover: { value: 0 },
        uOpacity: { value: 0 },
        uReveal: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    return { front, back, lines, nodes, shared };
  }, [radius]);

  useEffect(() => {
    materials.nodes.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2);
  }, [gl, materials]);

  useEffect(() => {
    return () => {
      shard.dispose();
      network.lines.dispose();
      network.nodes.dispose();
      materials.front.dispose();
      materials.back.dispose();
      materials.lines.dispose();
      materials.nodes.dispose();
    };
  }, [shard, network, materials]);

  /* --- Frame ---------------------------------------------------------- */
  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const time = state.clock.elapsedTime;

    const group = groupRef.current;
    const inner = shardRef.current;
    if (!group || !inner) return;

    const presence = archiveState.presenceSmooth;
    const isOpen = focusIndex === index;
    const someoneOpen = focusIndex !== -1;

    const hoverTarget = archiveState.hovered === index || isOpen ? 1 : 0;
    hoverRef.current = damp(hoverRef.current, hoverTarget, 9, dt);
    revealRef.current = damp(revealRef.current, presence, 3.4, dt);

    const h = hoverRef.current;

    /* While a dossier is open the other shards recede rather than vanish. */
    const crowdFade = someoneOpen && !isOpen ? 0.18 : 1;
    const opacity = presence * crowdFade;
    opacityRef.current = opacity;

    /* A faded shard must stop writing depth, or it keeps punching a hole in
       the particle field long after it has visually gone. */
    materials.front.depthWrite = opacity > 0.55;

    /* Hover is expressed as a surface swell, not as motion. Amplitude is
       deliberately tiny — at this scale it reads as the shard flexing under
       attention rather than as a wobble. */
    const distort = h * DISTORT_AMOUNT;

    materials.shared.uHover.value = h;
    materials.shared.uOpacity.value = opacity;
    materials.shared.uTime.value = time;
    materials.shared.uDistort.value = distort;

    materials.lines.uniforms.uHover.value = h;
    materials.lines.uniforms.uOpacity.value = opacity;
    materials.lines.uniforms.uTime.value = time;
    materials.lines.uniforms.uDistort.value = distort;
    materials.lines.uniforms.uReveal.value = revealRef.current;

    materials.nodes.uniforms.uHover.value = h;
    materials.nodes.uniforms.uOpacity.value = opacity;
    materials.nodes.uniforms.uTime.value = time;
    materials.nodes.uniforms.uDistort.value = distort;
    materials.nodes.uniforms.uReveal.value = revealRef.current;

    /* Idle drift. Every shard runs on its own phase so the row never pulses
       in lockstep.

       The spin is ACCUMULATED, never written as `elapsed * rate`. With a
       rate that changes on hover, `elapsed * rate` does not speed the shard
       up — it teleports it. A minute into the page, nudging the rate from
       0.13 to 0.33 moves the angle from 7.8 to 19.8 radians between one
       frame and the next, which is what made hover look like a lurch.
       Integrating the rate instead keeps the angle continuous. */
    const phase = index * 2.1;

    spinRef.current += (0.11 + h * 0.03) * dt;

    inner.rotation.y = spinRef.current + phase;
    inner.rotation.x = Math.sin(time * 0.31 + phase) * 0.12;
    inner.rotation.z = Math.cos(time * 0.24 + phase) * 0.06;

    // Hover barely changes the size; the swell carries the feedback instead.
    const scale = (0.98 + h * 0.03) * (0.55 + presence * 0.45);
    inner.scale.setScalar(damp(inner.scale.x, scale, 6, dt));

    group.position.y = damp(group.position.y, -0.55 + presence * 0.55, 3, dt);
    group.visible = presence > 0.01;

    /* Refraction is traced in object space, so the camera has to be moved
       into it. Doing this on the CPU once per shard avoids a matrix inverse
       per fragment — and GLSL ES 1.0 has no inverse() to call anyway. */
    camObj.current.copy(camera.position);
    inner.worldToLocal(camObj.current);
  });

  /* Built once so the model path and the fallback path render the very same
     element, rather than two instances competing for the same slot. */
  const generatedCore = (
    <CrystalCore kind={core.kind} keyDir={KEY_DIR} hoverRef={hoverRef} opacityRef={opacityRef} />
  );

  return (
    <group ref={groupRef}>
      <group ref={shardRef}>
        <mesh geometry={shard} material={materials.back} renderOrder={0} />

        {core.model ? (
          <ModelCore
            url={core.model}
            scale={core.modelScale ?? 0.8}
            opacityRef={opacityRef}
            fallback={generatedCore}
          />
        ) : (
          generatedCore
        )}

        <mesh geometry={shard} material={materials.front} renderOrder={2} />

        <lineSegments geometry={network.lines} material={materials.lines} renderOrder={3} />
        <points geometry={network.nodes} material={materials.nodes} renderOrder={4} />
      </group>
    </group>
  );
}
