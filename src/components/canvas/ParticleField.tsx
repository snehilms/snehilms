'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

import { VELOCITY_SHADER, POSITION_SHADER, POINTS_VERTEX, POINTS_FRAGMENT } from './gpgpu/simulation.glsl';
import { buildTargets, initialPositions, cloudToTexture } from './gpgpu/targets';
import { scrollState, damp, clamp01 } from '@/lib/scrollState';
import { archiveState } from '@/lib/archiveState';
import { identity } from '@/config/content';
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
  // Chapter 01 is the initials: a flat glyph plane that must face the camera,
  // so its amplitude is zero. Anything else turns the letterforms edge-on.
  // Lifted clear of the meta row at the hero's foot: solid beads under small
  // type fail contrast where soft glow never did.
  // Back 2.6 into the fog and right: the shell sits beside the name, clear of
  // the headline and the meta row.
  { offsetX: 2.95, offsetY: 0.0, offsetZ: -2.6, opacity: 1.0, size: 2.7, yaw: 0.34 }, // 00 intro
  // Both columns carry text (prose left, stats right), so the field steps
  // out past the stats and down, thinned: it must never sit under the labels.
  { offsetX: 3.7, offsetY: -0.9, offsetZ: -1.6, opacity: 0.24, size: 1.9, yaw: 0.0 }, // 01 experience
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

  const groupRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  const pointerWorld = useRef(new THREE.Vector3(0, 0, 0));
  const dispersionRef = useRef(0);
  const stageRef = useRef(0);
  const outroRef = useRef(0);

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

    const targets = buildTargets(simSize, identity.initials);

    Object.assign(velocityVar.material.uniforms, {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uTargetA: { value: targets[0] },
      uTargetB: { value: targets[1] },
      uMix: { value: 0 },
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

    return { compute, positionVar, velocityVar, targets, count };
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
    [],
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
    const { compute, targets } = sim;
    return () => {
      targets.forEach((t) => t.dispose());
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

    /* Chapter position → (targetA, targetB, mix) across the chain. */
    const segments = targets.length - 1;
    const scaled = Math.min(Math.max(scrollState.chapterSmooth, 0), segments);
    const index = Math.min(Math.floor(scaled), segments - 1);
    const raw = scaled - index;
    // Smoothstep the crossfade so targets settle instead of arriving linearly.
    const mix = raw * raw * (3 - 2 * raw);

    vu.uTargetA.value = targets[index];
    vu.uTargetB.value = targets[index + 1];
    vu.uMix.value = mix;

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
    const transitionHeat = Math.sin(raw * Math.PI);
    dispersionRef.current = damp(dispersionRef.current, transitionHeat, 6, dt);

    // Enough scatter to sell the reform, not so much that the field
    // sprays across the reading column mid-transition.
    vu.uDispersion.value = dispersionRef.current * 0.30;
    vu.uStiffness.value = 4.4 - dispersionRef.current * 1.9;
    vu.uTurbulence.value = 0.46 + Math.abs(scrollState.velocity) * 0.5;

    /* Pointer → world space on the z=0 plane. */
    scrollState.pointerSmooth.x = damp(scrollState.pointerSmooth.x, scrollState.pointer.x, 6, dt);
    scrollState.pointerSmooth.y = damp(scrollState.pointerSmooth.y, scrollState.pointer.y, 6, dt);

    pointerWorld.current.set(
      (scrollState.pointerSmooth.x * viewport.width) / 2,
      (scrollState.pointerSmooth.y * viewport.height) / 2,
      0,
    );
    vu.uPointer.value.copy(pointerWorld.current);
    vu.uPointerStrength.value = reducedMotion ? 0 : 5.5 * revealRef.current;

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
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />
    </group>
  );
}
