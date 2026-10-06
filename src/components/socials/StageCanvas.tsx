'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';

import { sampleGlyph, type GlyphKey } from './glyphs';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import {
  STAGE_VELOCITY,
  STAGE_POSITION,
  STAGE_POINTS_VERTEX,
  STAGE_POINTS_FRAGMENT,
  DUST_VERTEX,
  DUST_FRAGMENT,
  HALO_VERTEX,
  HALO_FRAGMENT,
} from './stage.glsl';
import { socialState, activeSocial } from '@/lib/socialState';
import { damp, scrollState } from '@/lib/scrollState';
import { sound } from '@/lib/sound';
import { cssColor } from '../canvas/Atmosphere';
import { useDeviceTier, type DeviceTier } from '@/hooks/useDeviceTier';
import styles from './StageCanvas.module.css';

/* ============================================================================
   STAGE CANVAS

   The one deliberate exception to "one canvas". The socials stage is a
   separate room: a mark on a pedestal under a dome, framed by its own fixed
   camera. Built into the background canvas it would inherit the dolly, the
   pointer parallax and the field's art direction, all of which belong to the
   descent, not to this room.

   It is transparent, so the shared fog atmosphere shows through and the two
   canvases read as one space. It costs a second WebGL context, so it only
   renders while the stage is on screen.
   ========================================================================= */

/* A camera raised well above the plinth: the pedestal's top face reads as a
   stage, and the mark, pedestal and selector stack without overlapping.
   Positions were placed by projecting the scene, not by eye; see layout(). */
const CAMERA_POS = new THREE.Vector3(0, 1.2, 9);
const LOOK_AT = new THREE.Vector3(0, 0.05, 0);
/** Seconds for a bead's home to migrate from one logo to the next. The
    visible re-form runs longer: the heat kick has to cool first. */
const MORPH_SECONDS = 1.2;

/* --- Layout ---------------------------------------------------------------
   One source for the mark and the chamber, so they always agree. Projected
   at 1440×900: mark 11–62% of the height (about 51vmin). The camera looks
   down, so the pedestal's far rim projects ABOVE the plane the mark stands
   on; the gap is sized so the mark's base still clears that rim by ~40px
   and the mark floats over the plinth instead of sinking into it. The
   plinth's front edge lands at 87%, under the selector band. Portrait
   screens are width-limited and keep the mark at ~72vw. */
function layout(viewport: { width: number; height: number }) {
  const scale = Math.min(viewport.height * 0.22, viewport.width * 0.34);
  const markY = LOOK_AT.y + scale * 0.52;
  const pedestalTop = markY - scale - 0.6;
  /* The plinth narrows on a portrait screen so it never runs off the sides. */
  const fit = Math.min(1, viewport.width / 3.9);
  return { scale, markY, pedestalTop, fit };
}

/* --- Mark ----------------------------------------------------------------
   A GPU-simulated bead volume (see stage.glsl.ts). The CPU side only:
   integrates the turn, turns the cursor into a 3D gust, runs the morph
   state machine, and feeds the simulation its uniforms each frame.
   ------------------------------------------------------------------------- */

/** Simulation texture edge per tier. Beads = edge². */
const SIM_SIZE: Record<DeviceTier, number> = { high: 192, mid: 144, low: 96 };

/** Turn rate as a function of facing, fitted to the reference frame by
    frame: about 1.4 rad/s through the profiles, about 2.2 rad/s round the
    back, and nearly still (0.22 rad/s) facing the visitor, which is the
    "hold" you see for ~0.8 s every time it comes round. */
const TURN_MIN = 0.22;
const TURN_MAX = 2.2;
function turnRate(yaw: number) {
  const away = Math.sin(yaw / 2) ** 2; // 0 front-on, 1 facing away
  return TURN_MIN + (TURN_MAX - TURN_MIN) * Math.pow(away, 0.75);
}

type CloudTextures = { position: THREE.DataTexture; normal: THREE.DataTexture };

function cloudTextures(glyphs: readonly GlyphKey[], size: number): CloudTextures[] {
  const count = size * size;
  return glyphs.map((glyph) => {
    const cloud = sampleGlyph(glyph, count);
    const pos = new Float32Array(count * 4);
    const nor = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 4] = cloud.positions[i * 3];
      pos[i * 4 + 1] = cloud.positions[i * 3 + 1];
      pos[i * 4 + 2] = cloud.positions[i * 3 + 2];
      pos[i * 4 + 3] = 1;
      nor[i * 4] = cloud.normals[i * 3];
      nor[i * 4 + 1] = cloud.normals[i * 3 + 1];
      nor[i * 4 + 2] = cloud.normals[i * 3 + 2];
    }
    const position = new THREE.DataTexture(pos, size, size, THREE.RGBAFormat, THREE.FloatType);
    const normal = new THREE.DataTexture(nor, size, size, THREE.RGBAFormat, THREE.FloatType);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    return { position, normal };
  });
}

type MarkProps = { glyphs: readonly GlyphKey[]; simSize: number; reducedMotion: boolean };

function Mark({ glyphs, simSize, reducedMotion }: MarkProps) {
  const gl = useThree((s) => s.gl);
  const viewport = useThree((s) => s.viewport);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);

  const targets = useMemo(() => cloudTextures(glyphs, simSize), [glyphs, simSize]);

  /* --- Simulation --- */
  const sim = useMemo(() => {
    const compute = new GPUComputationRenderer(simSize, simSize, gl);
    const ctx = gl.getContext();
    const hasFloat = !!(ctx as WebGL2RenderingContext).getExtension?.('EXT_color_buffer_float');
    compute.setDataType(hasFloat ? THREE.FloatType : THREE.HalfFloatType);

    /* Beads start as a hot cloud around the plinth; the scroll entrance
       holds them hot (uHold) and lets them condense as it completes. */
    const p0 = compute.createTexture();
    const v0 = compute.createTexture();
    const pd = p0.image.data as Float32Array;
    const vd = v0.image.data as Float32Array;
    for (let i = 0; i < simSize * simSize; i++) {
      const r = 1.4 + Math.random() * 2.4;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pd[i * 4] = r * Math.sin(ph) * Math.cos(th);
      pd[i * 4 + 1] = r * Math.cos(ph) * 0.7 + 0.4;
      pd[i * 4 + 2] = r * Math.sin(ph) * Math.sin(th) * 0.6;
      pd[i * 4 + 3] = Math.random();
      vd[i * 4 + 3] = 1;
    }

    const posVar = compute.addVariable('texturePosition', STAGE_POSITION, p0);
    const velVar = compute.addVariable('textureVelocity', STAGE_VELOCITY, v0);
    compute.setVariableDependencies(posVar, [posVar, velVar]);
    compute.setVariableDependencies(velVar, [posVar, velVar]);

    Object.assign(velVar.material.uniforms, {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uMotion: { value: 1 },
      uTargetA: { value: null },
      uTargetB: { value: null },
      uMix: { value: 0 },
      uRot: { value: new THREE.Matrix3() },
      uOffset: { value: new THREE.Vector3() },
      uScale: { value: 1 },
      uRayO: { value: new THREE.Vector3(0, 0, 100) },
      uRayD: { value: new THREE.Vector3(0, 0, -1) },
      uWind: { value: new THREE.Vector3() },
      uWindRadius: { value: 0.4 },
      uKick: { value: 0 },
      uHold: { value: 1 },
      uBurst: { value: 0 },
    });
    Object.assign(posVar.material.uniforms, { uDelta: { value: 0 } });

    const error = compute.init();
    if (error) console.error('[StageCanvas] GPGPU init failed:', error);
    return { compute, posVar, velVar };
  }, [gl, simSize]);

  /* --- Render --- */
  const geometry = useMemo(() => {
    const count = simSize * simSize;
    const refs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % simSize) + 0.5) / simSize;
      refs[i * 2 + 1] = (Math.floor(i / simSize) + 0.5) / simSize;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    return g;
  }, [simSize]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAGE_POINTS_VERTEX,
        fragmentShader: STAGE_POINTS_FRAGMENT,
        uniforms: {
          uPositions: { value: null },
          uVelocities: { value: null },
          uNormalA: { value: null },
          uNormalB: { value: null },
          uMix: { value: 0 },
          uRot: { value: new THREE.Matrix3() },
          uBead: { value: 0.02 },
          uPxPerUnit: { value: 100 },
          uRefDist: { value: CAMERA_POS.distanceTo(LOOK_AT) },
          uDpr: { value: dpr },
          uResolution: { value: new THREE.Vector2(1, 1) },
          // Slate body, as in the reference: darker than the fog, so torn
          // beads glowing white stand out against it.
          uLit: { value: cssColor('--c-floor', '#8e97a5') },
          uShade: { value: cssColor('--c-ink-3', '#323b49') },
          uHot: { value: cssColor('--c-glint', '#ffffff').lerp(cssColor('--c-accent-4', '#a9c6db'), 0.2) },
        },
      }),
    [dpr],
  );

  const halo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPositions: { value: null },
          uVelocities: { value: null },
          uBead: { value: 0.02 },
          uPxPerUnit: { value: 100 },
          uRefDist: { value: CAMERA_POS.distanceTo(LOOK_AT) },
          uDpr: { value: dpr },
          uColor: { value: cssColor('--c-glint', '#ffffff') },
        },
      }),
    [dpr],
  );

  useEffect(
    () => () => {
      sim.compute.dispose();
      geometry.dispose();
      material.dispose();
      halo.dispose();
      targets.forEach((t) => {
        t.position.dispose();
        t.normal.dispose();
      });
    },
    [sim, geometry, material, halo, targets],
  );

  /* Pointer, in this canvas's own NDC. The canvas has pointer-events off
     (the DOM selector owns interaction), so it listens on the window. */
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const knockPending = useRef(false);
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      pointer.current = { x, y, inside: Math.abs(x) <= 1 && Math.abs(y) <= 1 };
    };
    const onLeave = () => (pointer.current.inside = false);
    // A click on the mark knocks it; the hit test happens in the frame loop.
    const onDown = (e: PointerEvent) => {
      onMove(e);
      if (pointer.current.inside) knockPending.current = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [gl]);

  const morph = useRef({ from: 0, to: 0, mix: 0, kick: 0 });
  const turn = useRef({ yaw: -1.4 });
  /* The body's own response to being hit: a damped spring on lean and tilt,
     so a gust rocks the whole mark (~30° at most) and it settles back. */
  const wobble = useRef({ roll: 0, pitch: 0, vRoll: 0, vPitch: 0 });
  const storm = useRef(0);
  const wind = useRef({ v: new THREE.Vector3(), last: new THREE.Vector3(), has: false });
  const tmp = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      hit: new THREE.Vector3(),
      ndc: new THREE.Vector2(),
      gust: new THREE.Vector3(),
      euler: new THREE.Euler(),
      m4: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const t = state.clock.elapsedTime;
    const { compute, posVar, velVar } = sim;
    const vu = velVar.material.uniforms;
    const { scale, markY } = layout(viewport);

    /* --- Morph state machine ---
       A change of target mid-flight either reverses the flight (heading back
       where it came from) or re-aims it; every change kicks heat into the
       cloud so the old shape blows apart before the new one condenses. */
    const m = morph.current;
    const target = Math.min(activeSocial(), glyphs.length - 1);
    if (target !== m.to) {
      if (target === m.from && m.mix > 0) {
        m.from = m.to;
        m.to = target;
        m.mix = 1 - m.mix;
      } else if (m.mix < 0.5) {
        m.to = target;
      } else {
        m.from = m.to;
        m.to = target;
        m.mix = 0;
      }
      m.kick = reducedMotion ? 0 : 0.9;
    }
    if (m.from !== m.to) {
      m.mix = Math.min(1, m.mix + dt / (reducedMotion ? 0.3 : MORPH_SECONDS));
      if (m.mix >= 1) {
        m.from = m.to;
        m.mix = 0;
      }
    }

    /* --- Turn: integrated, never sin(t), because the rate varies.
       A sideways gust also spins it a little, as in the reference. --- */
    const tr = turn.current;
    const wv = wind.current.v;
    if (reducedMotion) {
      tr.yaw = damp(tr.yaw, 0, 3, dt);
    } else {
      tr.yaw = (tr.yaw + (turnRate(tr.yaw) + wv.x * 0.35) * dt) % (Math.PI * 2);
    }

    /* --- Wobble: gust → angular impulse → damped spring back --- */
    const wb = wobble.current;
    if (!reducedMotion) {
      wb.vRoll += (-wv.x * 1.1 - wb.roll * 16 - wb.vRoll * 3.2) * dt;
      wb.vPitch += (wv.y * 0.6 - wb.pitch * 16 - wb.vPitch * 3.6) * dt;
      wb.roll = THREE.MathUtils.clamp(wb.roll + wb.vRoll * dt, -0.5, 0.5);
      wb.pitch = THREE.MathUtils.clamp(wb.pitch + wb.vPitch * dt, -0.18, 0.18);
    }
    const lean = reducedMotion ? 0 : Math.sin(t * 0.55) * 0.035;
    const bob = reducedMotion ? 0 : Math.sin(t * 0.8) * 0.04;
    tmp.euler.set(lean * 0.6 + wb.pitch, tr.yaw, lean + wb.roll);
    tmp.m4.makeRotationFromEuler(tmp.euler);
    vu.uRot.value.setFromMatrix4(tmp.m4);
    vu.uOffset.value.set(0, markY + bob, 0);
    vu.uScale.value = scale;

    /* --- Cursor gust: velocity of the cursor on the mark's plane --- */
    const p = pointer.current;
    const w = wind.current;
    tmp.gust.set(0, 0, 0);
    if (p.inside && !reducedMotion) {
      tmp.ndc.set(p.x, p.y);
      tmp.raycaster.setFromCamera(tmp.ndc, camera);
      vu.uRayO.value.copy(tmp.raycaster.ray.origin);
      vu.uRayD.value.copy(tmp.raycaster.ray.direction);
      if (tmp.raycaster.ray.intersectPlane(tmp.plane, tmp.hit)) {
        if (w.has) tmp.gust.subVectors(tmp.hit, w.last).divideScalar(Math.max(dt, 1e-3)).multiplyScalar(0.5);
        w.last.copy(tmp.hit);
        w.has = true;
      }
    } else {
      w.has = false;
    }
    if (tmp.gust.length() > 5) tmp.gust.setLength(5);

    /* --- Knock: a click whose ray passes through the mark --- */
    let burst = 0;
    if (knockPending.current) {
      knockPending.current = false;
      const centre = tmp.hit.set(0, markY, 0);
      if (!reducedMotion && tmp.raycaster.ray.distanceToPoint(centre) < scale * 1.1) {
        burst = 1;
        wobble.current.vRoll += (p.x > 0 ? -1 : 1) * 1.1;
        sound.burst(1);
      }
    }
    // Gusts arrive fast and die fast: a still cursor stirs nothing.
    w.v.lerp(tmp.gust, 1 - Math.exp(-14 * dt));
    vu.uWind.value.copy(w.v);
    // A gust takes a real chunk of the mark, not a wisp.
    vu.uWindRadius.value = scale * 0.42;

    vu.uTime.value = t;
    vu.uDelta.value = dt;
    vu.uMotion.value = reducedMotion ? 0 : 1;
    vu.uTargetA.value = targets[m.from].position;
    vu.uTargetB.value = targets[m.to].position;
    vu.uMix.value = m.mix;
    vu.uKick.value = m.kick;
    vu.uBurst.value = burst;
    if (m.kick > 0) sound.burst(0.8);
    vu.uHold.value = 1 - socialState.assemble;
    posVar.material.uniforms.uDelta.value = dt;
    compute.compute();
    m.kick = 0; // one-frame pulses

    /* --- Sound: the air layer follows the disturbance --- */
    storm.current = Math.max(storm.current * Math.exp(-1.4 * dt), Math.min(1, w.v.length() / 2.2), burst);
    sound.setGust(storm.current, dt);
    sound.setPresence(scrollState.stage);

    const u = material.uniforms;
    u.uPositions.value = compute.getCurrentRenderTarget(posVar).texture;
    u.uVelocities.value = compute.getCurrentRenderTarget(velVar).texture;
    u.uNormalA.value = targets[m.from].normal;
    u.uNormalB.value = targets[m.to].normal;
    u.uMix.value = m.mix;
    u.uRot.value.copy(vu.uRot.value);
    // Grain ≈ 1/100 of the mark's height, as in the reference.
    u.uBead.value = (2 * scale) / 170;
    u.uPxPerUnit.value = size.height / viewport.height;
    u.uResolution.value.set(size.width * dpr, size.height * dpr);

    const h = halo.uniforms;
    h.uPositions.value = u.uPositions.value;
    h.uVelocities.value = u.uVelocities.value;
    h.uBead.value = u.uBead.value;
    h.uPxPerUnit.value = u.uPxPerUnit.value;
  });

  return (
    <>
      <points geometry={geometry} material={material} frustumCulled={false} />
      <points geometry={geometry} material={halo} frustumCulled={false} renderOrder={5} />
    </>
  );
}

/* --- Ambient dust --------------------------------------------------------- */

function Dust({ reducedMotion }: { reducedMotion: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // Densest in a soft column just right of the mark, thin elsewhere.
      const column = Math.random() < 0.45;
      pos[i * 3] = column ? 1.5 + (Math.random() - 0.5) * 0.7 : (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = column ? (Math.random() - 0.5) * 1.2 : -Math.random() * 4;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DUST_VERTEX,
        fragmentShader: DUST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: dpr },
          uMotion: { value: reducedMotion ? 0 : 1 },
          uColor: { value: cssColor('--c-glint', '#ffffff') },
        },
      }),
    [dpr, reducedMotion],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* --- Pedestal, rings, dome ---------------------------------------------- */

function Chamber() {
  const viewport = useThree((s) => s.viewport);
  const colours = useMemo(
    () => ({
      stone: cssColor('--c-fog-lo', '#c9cfd8'),
      groove: cssColor('--c-floor', '#8e97a5'),
      glint: cssColor('--c-glint', '#ffffff'),
    }),
    [],
  );

  /* Ground shadow: a soft radial falloff that seats the pedestal on the
     floor. Without it the plinth floats in the fog. */
  const shadow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: cssColor('--c-floor-deep', '#5d6676') } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float d = distance(vUv, vec2(0.5)) * 2.0;
            gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.35, 1.0, d)) * 0.38);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  /* Only the far half of the dome: the near half sits between the camera
     and the plinth and would rule lines straight across the mark. */
  const dome = useMemo(() => {
    const wire = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(5.6, 2));
    const src = wire.getAttribute('position');
    const kept: number[] = [];
    for (let i = 0; i < src.count; i += 2) {
      if (src.getZ(i) < -0.4 && src.getZ(i + 1) < -0.4 && src.getY(i) > -0.2 && src.getY(i + 1) > -0.2) {
        kept.push(src.getX(i), src.getY(i), src.getZ(i), src.getX(i + 1), src.getY(i + 1), src.getZ(i + 1));
      }
    }
    wire.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
    return geo;
  }, []);

  useEffect(
    () => () => {
      shadow.dispose();
      dome.dispose();
    },
    [shadow, dome],
  );

  const { pedestalTop, fit } = layout(viewport);

  return (
    <group position={[0, pedestalTop, 0]} scale={fit}>
      <mesh position={[0, -0.18, 0]}>
        <cylinderGeometry args={[1.5, 1.55, 0.34, 96, 1]} />
        <meshStandardMaterial color={colours.stone} roughness={0.62} metalness={0.04} />
      </mesh>

      {/* Engraved inlay on the plinth's top face. */}
      {[0.68, 1.04].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[r, r + 0.03, 96]} />
          <meshBasicMaterial color={colours.groove} transparent opacity={0.45} toneMapped={false} />
        </mesh>
      ))}

      {/* Rim light: the brightest thing in the room, and the bloom's job. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <torusGeometry args={[1.52, 0.018, 8, 160]} />
        <meshBasicMaterial color={colours.glint} toneMapped={false} />
      </mesh>

      {/* Light rings spreading across the floor. */}
      {[
        { r: 2.4, o: 0.7 },
        { r: 3.4, o: 0.4 },
      ].map(({ r, o }) => (
        <mesh key={r} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.36, 0]}>
          <torusGeometry args={[r, 0.014, 6, 200]} />
          <meshBasicMaterial color={colours.glint} transparent opacity={o} toneMapped={false} />
        </mesh>
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.355, 0]}>
        <planeGeometry args={[6.5, 6.5]} />
        <primitive object={shadow} attach="material" />
      </mesh>

      <lineSegments geometry={dome} position={[0, -0.36, 0]}>
        <lineBasicMaterial color={colours.glint} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

function FixedCamera() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.copy(CAMERA_POS);
    camera.lookAt(LOOK_AT);
  }, [camera]);
  return null;
}

/* --- Root ---------------------------------------------------------------- */

export function StageCanvas({ glyphs }: { glyphs: readonly GlyphKey[] }) {
  const { tier, dpr, reducedMotion } = useDeviceTier();
  const wrap = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const tones = useMemo(
    () => ({
      // Distance fades toward the stage's dimmer room, not the page fog.
      fog: cssColor('--c-room', '#9ea8b6'),
      sky: cssColor('--c-glint', '#ffffff'),
      floor: cssColor('--c-floor-deep', '#5d6676'),
    }),
    [],
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: '160px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className={styles.canvas} aria-hidden="true">
      <Canvas
        flat
        dpr={dpr}
        frameloop={inView ? 'always' : 'never'}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 35, near: 0.1, far: 60, position: CAMERA_POS.toArray() }}
      >
        <FixedCamera />
        <fog attach="fog" args={[tones.fog, 9, 22]} />
        <hemisphereLight args={[tones.sky, tones.floor, 1.6]} />
        <directionalLight position={[-2, 6, 4]} intensity={1.4} />
        <Chamber />
        <Dust reducedMotion={reducedMotion} />
        <Mark glyphs={glyphs} simSize={SIM_SIZE[tier]} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
