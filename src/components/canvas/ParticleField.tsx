'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

import { VELOCITY_SHADER, POSITION_SHADER, POINTS_VERTEX, POINTS_FRAGMENT } from './gpgpu/simulation.glsl';
import { buildTargets, initialPositions, cloudToTexture } from './gpgpu/targets';
import {
  pipelineCloud,
  bookCloud,
  vaultCloud,
  GLYPH_POSE,
  GLYPH_ANCHORS,
  VAULT,
} from './gpgpu/careerGlyphs';
import { scrollState, damp, clamp01, smoothstep } from '@/lib/scrollState';
import { archiveState } from '@/lib/archiveState';
import { experienceState, chainCoord } from '@/lib/experienceState';
import { cssColor } from './Atmosphere';

/* ============================================================================
   PARTICLE FIELD

   The entire hero, the entire scroll journey, one draw call.

   Simulation runs on the GPU in two fragment passes; the render pass reads
   positions straight out of the simulation texture. Scroll position selects
   which pair of morph targets the field springs toward, and how far between
   them it currently sits. Nothing here re-renders React — every frame is a
   uniform write.
   ========================================================================= */


/* ----------------------------------------------------------------------
   ART DIRECTION, per chapter.

   The field is not a constant. In the text-heavy chapters it steps aside:
   it drifts off the reading column, drops opacity, and shrinks. In the
   opening and closing chapters — where the DOM is sparse on purpose — it
   takes the frame back.

   This table is the single place that balance is tuned.
   -------------------------------------------------------------------- */
const ART = [
  // yaw is the AMPLITUDE of a bounded oscillation, in radians — never a rate.
  // Chapter 01 is the career glyphs, which pose and turn themselves (see
  // careerGlyphs.ts), so the chapter adds no yaw of its own.
  // Lifted clear of the meta row at the hero's foot: solid beads under small
  // type fail contrast where soft glow never did.
  // Back 2.6 into the fog and right: the shell sits beside the name, clear of
  // the headline and the meta row.
  { offsetX: 2.95, offsetY: 0.0, offsetZ: -2.6, opacity: 1.0, size: 2.7, yaw: 0.34 }, // 00 intro
  // The career glyphs are the subject here: dense, forward and right of the
  // station text. No yaw of its own: each glyph turns a little in its pose.
  { offsetX: 2.75, offsetY: -0.2, offsetZ: -2.4, opacity: 0.97, size: 2.7, yaw: 0.0 }, // 01 experience
  // The archive belongs to the shards. The field retreats in depth as well
  // as in opacity — pushing it back lets the depth fog finish the job, so it
  // reads as weather behind the crystals instead of a veil over them.
  // Parked right and far back, on the same line as 01 and 03, so moving
  // between chapters it never sweeps across a heading or a card.
  { offsetX: 3.4, offsetY: -0.6, offsetZ: -4.2, opacity: 0.06, size: 1.8, yaw: 0.16 }, // 02 projects
  { offsetX: 2.9, offsetY: 0.0, offsetZ: -1.8, opacity: 0.2, size: 2.0, yaw: 0.1 }, // 03 stack
  // The prompt and address take the left half; the ring takes the right,
  // as the sphere does in the hero, so the two ends of the page rhyme.
  { offsetX: 2.7, offsetY: -0.6, offsetZ: -1.4, opacity: 0.9, size: 2.1, yaw: 0.28 }, // 04 contact
] as const;

/* The Experience chain, by slot kind: 1 stream, 2 pipeline, 3 book,
   4 vault (see experienceState.ts for where each one holds). */
const CHAIN = [1, 2, 3, 4, 1] as const;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type Props = {
  simSize: number;
  reducedMotion: boolean;
};

export function ParticleField({ simSize, reducedMotion }: Props) {
  const gl = useThree((s) => s.gl);
  const viewport = useThree((s) => s.viewport);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const groupRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  const pointerWorld = useRef(new THREE.Vector3(0, 0, 0));
  const dispersionRef = useRef(0);
  const stageRef = useRef(0);
  const outroRef = useRef(0);
  const doorRef = useRef(0);
  const wheelRef = useRef(0);
  const scratch = useMemo(
    () => ({
      m4: new THREE.Matrix4(),
      euler: new THREE.Euler(0, 0, 0, 'XYZ'),
      v: new THREE.Vector3(),
      ndc: new THREE.Vector2(),
      ray: new THREE.Raycaster(),
      plane: new THREE.Plane(),
      normal: new THREE.Vector3(),
      hit: new THREE.Vector3(),
    }),
    [],
  );

  /* --- Build the simulation once ------------------------------------- */
  const sim = useMemo(() => {
    const count = simSize * simSize;
    const compute = new GPUComputationRenderer(simSize, simSize, gl);

    // Half-float where full-float render targets are unavailable (some
    // mobile GL stacks). Positions stay well inside half-float range.
    const ctx = gl.getContext();
    const hasFloat = !!(ctx as WebGL2RenderingContext).getExtension?.('EXT_color_buffer_float');
    compute.setDataType(hasFloat ? THREE.FloatType : THREE.HalfFloatType);

    const seeded = initialPositions(count);
    const positionTexture = cloudToTexture(seeded, simSize);
    const velocityTexture = cloudToTexture(new Float32Array(count * 4), simSize);

    const positionVar: Variable = compute.addVariable('texturePosition', POSITION_SHADER, positionTexture);
    const velocityVar: Variable = compute.addVariable('textureVelocity', VELOCITY_SHADER, velocityTexture);

    compute.setVariableDependencies(positionVar, [positionVar, velocityVar]);
    compute.setVariableDependencies(velocityVar, [positionVar, velocityVar]);

    const targets = buildTargets(simSize);

    /* The career glyphs, each a position texture and an attr texture (part
       tag, param, normal). Plain clouds read a shared empty attr. */
    const glyph = (cloud: { position: Float32Array; attr: Float32Array }) => ({
      position: cloudToTexture(cloud.position, simSize),
      attr: cloudToTexture(cloud.attr, simSize),
    });
    const glyphs = {
      pipeline: glyph(pipelineCloud(count)),
      book: glyph(bookCloud(count)),
      vault: glyph(vaultCloud(count)),
    };
    const noAttr = cloudToTexture(new Float32Array(count * 4), simSize);

    /* Shared by the simulation and the render pass: the same slots and
       poses decide where a bead goes and how it is lit. */
    const slots = {
      uTargetA: { value: targets[0] },
      uTargetB: { value: targets[1] },
      uTargetC: { value: targets[1] },
      uAttrA: { value: noAttr },
      uAttrB: { value: noAttr },
      uAttrC: { value: noAttr },
      uWeights: { value: new THREE.Vector3(1, 0, 0) },
      uKinds: { value: new THREE.Vector3(0, 0, 0) },
      uPosePipe: { value: new THREE.Matrix3() },
      uPoseBook: { value: new THREE.Matrix3() },
      uPoseVault: { value: new THREE.Matrix3() },
      uWheel: { value: 0 },
      uDoorOpen: { value: 0 },
      uHover: { value: new THREE.Vector3() },
      uHoverAmt: { value: 0 },
      uBook: { value: 0 },
    };

    Object.assign(velocityVar.material.uniforms, {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      ...slots,
      uStiffness: { value: 4.4 },
      uDamping: { value: 0.93 },
      uTurbulence: { value: 0.46 },
      uNoiseScale: { value: 0.34 },
      uDispersion: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 0) },
      uPointerRadius: { value: 1.7 },
      uPointerStrength: { value: 0 },
    });

    Object.assign(positionVar.material.uniforms, {
      uDelta: { value: 0 },
    });

    const error = compute.init();
    if (error) console.error('[ParticleField] GPGPU init failed:', error);

    return { compute, positionVar, velocityVar, targets, glyphs, noAttr, slots, count };
  }, [gl, simSize]);

  /* --- Geometry: one vertex per simulation texel ---------------------- */
  const geometry = useMemo(() => {
    const { count } = sim;
    const geo = new THREE.BufferGeometry();

    const refs = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      refs[i * 2 + 0] = ((i % simSize) + 0.5) / simSize;
      refs[i * 2 + 1] = (Math.floor(i / simSize) + 0.5) / simSize;

      seeds[i] = Math.random();
      // A short tail: beads vary, but none grows into a marble.
      scales[i] = 0.75 + Math.pow(Math.random(), 3.2) * 0.9;
    }

    // Positions are read from the simulation texture, but three still needs
    // a position attribute to derive draw count and bounds.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    // Manual bounds — the GPU moves the points, so three can never infer them.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 20);

    return geo;
  }, [sim, simSize]);

  /* --- Render material ------------------------------------------------ */
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERTEX,
        fragmentShader: POINTS_FRAGMENT,
        uniforms: {
          uPositions: { value: null },
          uVelocities: { value: null },
          // The simulation's own slot uniforms, shared by reference.
          ...sim.slots,
          uPacketX: { value: 0 },
          uFlow: { value: 0 },
          uPay: { value: 0 },
          uSize: { value: 2.6 },
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uReveal: { value: 0 },
          uOpacity: { value: 0.92 },
          /* Size falls off as 10/distance, so a particle that drifts near
             the camera explodes into a screen-filling disc — and additive
             blending plus bloom turns that into a white flare. Both of these
             exist to bound that.

             The ceiling clips only the extreme tail of the size
             distribution. The fade covers everything within 5.2 units of the
             camera, which is exactly where the intro cloud starts and
             nowhere the settled formations ever reach: the hero sphere's
             nearest point sits around 6.7 units out. */
          uMaxSize: { value: 9 },
          uNearFade: { value: 5.2 },
          uColorLit: { value: cssColor('--c-fog-lo', '#c9cfd8') },
          uColorShade: { value: cssColor('--c-ink-3', '#323b49') },
          uColorHot: { value: cssColor('--c-fog-hi', '#eceff3') }, // frost, not blue: stays in the grey world
          uColorSignal: { value: cssColor('--c-accent', '#1c5a80') },
          uFogColor: { value: cssColor('--c-ground', '#dde1e7') },
          uFogNear: { value: 8 },
          uFogFar: { value: 24 },
        },
        /* Opaque beads in the opaque pass, depth written. Three draws the
           opaque list before any transparent object, so the glass shards are
           composited over beads that are already correctly depth-sorted. */
        transparent: false,
        depthWrite: true,
        depthTest: true,
      }),
    [sim],
  );

  useEffect(() => {
    material.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2);
  }, [gl, material, viewport.dpr]);

  /* --- Intro: the field gathers in from the dark ---------------------- */
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = reducedMotion ? 400 : 2600;

    const tick = () => {
      const t = clamp01((performance.now() - start) / duration);
      // expo.out — matches EASE.expo so DOM and WebGL intros share a curve.
      revealRef.current = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  /* --- Teardown ------------------------------------------------------- */
  useEffect(() => {
    const { compute, targets, glyphs, noAttr } = sim;
    return () => {
      targets.forEach((t) => t.dispose());
      Object.values(glyphs).forEach((g) => {
        g.position.dispose();
        g.attr.dispose();
      });
      noAttr.dispose();
      compute.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, [sim, geometry, material]);

  /* --- Frame loop ------------------------------------------------------ */
  useFrame((state, rawDelta) => {
    // Clamp: a backgrounded tab returns a delta measured in seconds, which
    // would launch every particle to infinity on the first frame back.
    const dt = Math.min(rawDelta, 1 / 30);
    const time = state.clock.elapsedTime;

    const { compute, positionVar, velocityVar, targets } = sim;
    const vu = velocityVar.material.uniforms;
    const pu = positionVar.material.uniforms;

    /* Two smoothed values, for two different jobs. `smooth` tracks raw page
       progress and drives the atmosphere; `chapterSmooth` tracks chapter
       space and drives everything that has to agree with the DOM. */
    scrollState.smooth = damp(scrollState.smooth, scrollState.progress, 3.2, dt);
    scrollState.chapterSmooth = damp(scrollState.chapterSmooth, scrollState.chapterT, 3.2, dt);

    /* Chapter position → slots. Chapters blend two clouds; chapter 1 is
       itself a chain (stream → pipeline → book → vault → stream) walked by the held chapter's own progress, so where it meets
       a neighbour three clouds are in play at once. */
    const segments = targets.length - 1;
    const scaled = Math.min(Math.max(scrollState.chapterSmooth, 0), segments);
    const index = Math.min(Math.floor(scaled), segments - 1);
    const raw = scaled - index;
    // Smoothstep the crossfade so targets settle instead of arriving linearly.
    const mix = raw * raw * (3 - 2 * raw);

    experienceState.smooth = damp(experienceState.smooth, experienceState.progress, 3.2, dt);
    const chain = chainCoord(experienceState.smooth);
    const link = Math.min(Math.floor(chain), CHAIN.length - 2);
    const linkRaw = chain - link;
    const linkMix = linkRaw * linkRaw * (3 - 2 * linkRaw);
    const s1 = CHAIN[link];
    const s2 = CHAIN[link + 1];

    const u = sim.slots;
    const plain = (i: number) => ({ tex: targets[i], attr: sim.noAttr, kind: 0 });
    const linked = (kind: number) => {
      const g = kind === 2 ? sim.glyphs.pipeline : kind === 3 ? sim.glyphs.book : kind === 4 ? sim.glyphs.vault : null;
      return { tex: g ? g.position : targets[1], attr: g ? g.attr : sim.noAttr, kind };
    };
    let slotA = plain(index);
    let slotB = plain(index + 1);
    let slotC = plain(index + 1);
    let w = [1 - mix, mix, 0];
    if (index === 0) {
      slotB = linked(s1);
      slotC = linked(s2);
      w = [1 - mix, mix * (1 - linkMix), mix * linkMix];
    } else if (index === 1) {
      slotA = linked(s1);
      slotB = linked(s2);
      slotC = plain(2);
      w = [(1 - mix) * (1 - linkMix), (1 - mix) * linkMix, mix];
    }
    u.uTargetA.value = slotA.tex;
    u.uTargetB.value = slotB.tex;
    u.uTargetC.value = slotC.tex;
    u.uAttrA.value = slotA.attr;
    u.uAttrB.value = slotB.attr;
    u.uAttrC.value = slotC.attr;
    u.uKinds.value.set(slotA.kind, slotB.kind, slotC.kind);
    u.uWeights.value.set(w[0], w[1], w[2]);

    /* How present each glyph is, for its pose, the door and the labels. */
    const presence = (kind: number) =>
      (slotA.kind === kind ? w[0] : 0) + (slotB.kind === kind ? w[1] : 0) + (slotC.kind === kind ? w[2] : 0);
    const glyphWeight = presence(2) + presence(3) + presence(4);
    // The stream and the glyphs are drawn shapes: noise must not smear them.
    const drawn = Math.min(glyphWeight + presence(1), 1);

    /* Each glyph holds a 3/4 pose and turns a little about it, like a piece
       on a slow turntable: never far enough to go edge-on. */
    const still = reducedMotion ? 0 : 1;
    const pose = (m: THREE.Matrix3, p: { yaw: number; pitch: number }, phase: number) => {
      scratch.euler.set(p.pitch, p.yaw + Math.sin(time * 0.22 + phase) * 0.16 * still, 0);
      scratch.m4.makeRotationFromEuler(scratch.euler);
      m.setFromMatrix4(scratch.m4);
    };
    pose(u.uPosePipe.value, GLYPH_POSE.pipeline, 0);
    pose(u.uPoseBook.value, GLYPH_POSE.book, 1.7);
    pose(u.uPoseVault.value, GLYPH_POSE.vault, 3.1);

    /* The cursor on a glyph: where it meets the glyph's plane (the field's
       local z = 0, as it last stood), in field space. Each glyph answers it
       in the shaders; here only how much it is on one, and the clocks it
       quickens. Clocks are integrated, so quickening never jumps them. */
    if (groupRef.current) {
      const g = groupRef.current;
      scratch.ndc.set(scrollState.pointer.x, scrollState.pointer.y);
      scratch.ray.setFromCamera(scratch.ndc, camera);
      scratch.normal.set(0, 0, 1).applyQuaternion(g.quaternion);
      scratch.plane.setFromNormalAndCoplanarPoint(scratch.normal, g.position);
      let over = 0;
      if (scratch.ray.ray.intersectPlane(scratch.plane, scratch.hit)) {
        g.worldToLocal(scratch.hit);
        over = Math.abs(scratch.hit.x) < 2.7 && Math.abs(scratch.hit.y) < 1.9 ? 1 : 0;
        u.uHover.value.lerp(scratch.hit, 1 - Math.exp(-dt * 12));
      }
      u.uHoverAmt.value = damp(u.uHoverAmt.value, over * Math.min(glyphWeight, 1), 4, dt);
    }
    const hover = u.uHoverAmt.value;
    /* The glyphs' own small motions (sizes churning, pulses, the wheel) are
       ambient, not travel: under reduced motion they run at half speed
       rather than freezing, and the cursor still wakes them. */
    const live = reducedMotion ? 0.5 : 1;

    // The vault door swings open as the vault forms, and wider for the
    // cursor; its wheel always turns, faster for the cursor.
    doorRef.current = damp(doorRef.current, smoothstep(0.55, 1, presence(4)) * (1 + 0.9 * hover * presence(4)), 2.4, dt);
    u.uDoorOpen.value = VAULT.open * doorRef.current;
    wheelRef.current += dt * (0.35 + 1.6 * hover) * live;
    u.uWheel.value = wheelRef.current;
    u.uBook.value += dt * (1 + 1.2 * hover) * live;
    material.uniforms.uFlow.value += dt * (1 + 2.2 * hover) * live;
    material.uniforms.uPay.value += dt * (1 + 2.0 * hover) * live;
    material.uniforms.uPacketX.value = -2.8 + 5.6 * ((time / 3.6) % 1);

    /* Blend the art-direction table across the same segment the morph uses,
       so the field's presence and its shape always change together. */
    const a = ART[index];
    const b = ART[index + 1];
    const artOffsetX = lerp(a.offsetX, b.offsetX, mix);
    const artOffsetY = lerp(a.offsetY, b.offsetY, mix);
    /* Portrait screens: text spans the full width, so the field moves back
       into the fog and thins out rather than sitting solid under type. */
    const portrait = viewport.width < viewport.height;
    const artOffsetZ = lerp(a.offsetZ, b.offsetZ, mix) + (portrait ? -3.2 : 0);
    const artYaw = lerp(a.yaw, b.yaw, mix);

    // The socials stage is its own room: the field leaves it entirely.
    stageRef.current = damp(stageRef.current, scrollState.stage, 3, dt);
    outroRef.current = damp(outroRef.current, scrollState.outro, 3, dt);
    /* The Projects gallery belongs to the crystals: while it is up the field
       steps back almost entirely. The section is tall, so without this the
       blend from the Experience formation hung beside the first crystal. */
    const gallery = archiveState.presenceSmooth;
    material.uniforms.uOpacity.value =
      lerp(a.opacity, b.opacity, mix) *
      (1 - stageRef.current) *
      (1 - 0.93 * outroRef.current) *
      (1 - 0.9 * gallery) *
      (portrait ? 0.6 : 1);
    material.uniforms.uSize.value = lerp(a.size, b.size, mix);

    /* Mid-transition, loosen the springs and raise turbulence. The form has
       to come apart before it can credibly reassemble as something else. */
    const transitionHeat = Math.max(Math.sin(raw * Math.PI), index <= 1 ? Math.sin(linkRaw * Math.PI) * (1 - Math.abs(scaled - 1)) : 0);
    dispersionRef.current = damp(dispersionRef.current, transitionHeat, 6, dt);

    // Enough scatter to sell the reform, not so much that the field
    // sprays across the reading column mid-transition.
    vu.uDispersion.value = dispersionRef.current * 0.30;
    // Drawn shapes hold tighter, so fine strands and edges stay crisp.
    vu.uStiffness.value = 4.4 + 2.6 * drawn - dispersionRef.current * 1.9;
    // Calmer over a held glyph, so its silhouette stays crisp.
    vu.uTurbulence.value = (0.46 + Math.abs(scrollState.velocity) * 0.5) * (1 - 0.85 * drawn);

    /* Pointer → world space on the z=0 plane. */
    scrollState.pointerSmooth.x = damp(scrollState.pointerSmooth.x, scrollState.pointer.x, 6, dt);
    scrollState.pointerSmooth.y = damp(scrollState.pointerSmooth.y, scrollState.pointer.y, 6, dt);

    pointerWorld.current.set(
      (scrollState.pointerSmooth.x * viewport.width) / 2,
      (scrollState.pointerSmooth.y * viewport.height) / 2,
      0,
    );
    /* The simulation works in the field's own space, which the group moves
       about the frame (2.75 units right in the Experience chapter): carry
       the pointer into it, or the well sits that far from the cursor. */
    vu.uPointer.value.copy(pointerWorld.current);
    if (groupRef.current) groupRef.current.worldToLocal(vu.uPointer.value);
    // Gentler over the career glyphs: they must stay legible under the cursor.
    vu.uPointerStrength.value = reducedMotion ? 0 : 5.5 * revealRef.current * (1 - 0.75 * drawn);

    vu.uTime.value = time;
    vu.uDelta.value = dt;
    pu.uDelta.value = dt;

    compute.compute();

    /* Hand the freshly computed textures to the render material. */
    material.uniforms.uPositions.value = compute.getCurrentRenderTarget(positionVar).texture;
    material.uniforms.uVelocities.value = compute.getCurrentRenderTarget(velocityVar).texture;
    material.uniforms.uTime.value = time;
    material.uniforms.uReveal.value = revealRef.current;

    /* A bounded yaw, a pointer-led tilt, and the chapter offset. Transform only.
       The yaw oscillates rather than accumulating: an ever-growing rotation
       eventually presents every flat formation edge-on to the camera. */
    if (groupRef.current) {
      const g = groupRef.current;
      const yaw = Math.sin(time * 0.17) * artYaw + scrollState.pointerSmooth.x * 0.22;

      g.rotation.y = damp(g.rotation.y, yaw, 2.4, dt);
      g.rotation.x = damp(g.rotation.x, -scrollState.pointerSmooth.y * 0.14, 2.4, dt);

      g.position.x = damp(g.position.x, artOffsetX, 2.6, dt);
      g.position.y = damp(g.position.y, artOffsetY, 2.6, dt);
      g.position.z = damp(g.position.z, artOffsetZ, 2.6, dt);
      g.updateMatrixWorld();

      /* Where each glyph label sits on screen: its anchor, posed like its
         glyph, through the group and the camera. Faded with its glyph. */
      for (const [name, anchor] of Object.entries(GLYPH_ANCHORS)) {
        const kind = anchor.glyph === 'pipeline' ? 2 : anchor.glyph === 'book' ? 3 : 4;
        const m = anchor.glyph === 'pipeline' ? u.uPosePipe.value : anchor.glyph === 'book' ? u.uPoseBook.value : u.uPoseVault.value;
        scratch.v.set(anchor.p[0], anchor.p[1], anchor.p[2]).applyMatrix3(m);
        g.localToWorld(scratch.v);
        scratch.v.project(camera);
        const mark = (experienceState.marks[name] ??= { x: 0, y: 0, o: 0 });
        mark.x = (scratch.v.x * 0.5 + 0.5) * size.width;
        mark.y = (-scratch.v.y * 0.5 + 0.5) * size.height;
        mark.o = smoothstep(0.7, 1, presence(kind)) * material.uniforms.uOpacity.value;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />
    </group>
  );
}
