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
   separate room: a mark over an ice plinth in a pre-rendered world (see
   Backdrop), framed by its own fixed camera. Built into the background canvas it would inherit the dolly, the
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
   The mark's placement. The ice plinth in the backdrop render sits where
   the old pedestal did at landscape sizes (top at markY - scale - 0.6 =
   -1.155; PEDESTAL_TOP in art/scripts/stage_world.py): change one, change
   the other. Projected
   at 1440×900: mark 11–62% of the height (about 51vmin). The camera looks
   down, so the pedestal's far rim projects ABOVE the plane the mark stands
   on; the gap is sized so the mark's base still clears that rim by ~40px
   and the mark floats over the plinth instead of sinking into it. The
   plinth's front edge lands at 87%, under the selector band. Portrait
   screens are width-limited and keep the mark at ~72vw. */
function layout(viewport: { width: number; height: number }) {
  const scale = Math.min(viewport.height * 0.22, viewport.width * 0.34);
  const markY = LOOK_AT.y + scale * 0.52;
  return { scale, markY };
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
          uPresence: { value: 1 },
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
          uPresence: { value: 1 },
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
    // A tight, local disturbance: the cursor brushes a patch, not half the mark.
    vu.uWindRadius.value = scale * 0.22;

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

    // The mark arrives and leaves by density, in step with the stage (and
    // opposite the background field): gone before it can scroll into the nav.
    const presence = Math.min(1, Math.max(0, (scrollState.stage - 0.25) / 0.7));
    u.uPresence.value = presence;

    const h = halo.uniforms;
    h.uPresence.value = presence;
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

/* --- World backdrop -----------------------------------------------------
   Each social stands in its own pre-rendered world (art/scripts/
   stage_world.py: Blender, Cycles, CC0 Poly Haven sky and snow). The render
   uses this exact camera — fov 35° vertical, same position and target — and
   is drawn on a plane locked to the camera at the same vertical field of
   view, so the ice plinth in the image sits exactly under the live mark at
   any aspect; wider screens simply see more of a 2.4:1 plate.

   The plate crossfades to the next world as the mark changes (following
   hover previews too), fades in with the stage, and drifts a few pixels
   against the pointer for depth. A social without its own render yet
   borrows the first one that exists. */

const WORLD_PLATES: Partial<Record<GlyphKey, string>> = {
  github: '/stage/github.webp',
};
const PLATE_ASPECT = 2.4;
const PLATE_DISTANCE = 40;
const CROSSFADE_SECONDS = 0.9;

const PLATE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PLATE_FRAGMENT = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uOpacity;
uniform vec2 uShift;
uniform float uBufferHeight;
uniform float uFeatherTop;
uniform float uFeatherBottom;
uniform float uLift;
varying vec2 vUv;

// Where the podium (and its reflection) sits in the plate, 1 inside with a
// soft edge: only this patch breathes, never the walls, the posts or the sky.
// Its top edge eases out over the band behind the podium's rim, so the thin
// dome lines there stretch by a hair rather than tear.
float podium(vec2 p) {
  float wx = 1.0 - smoothstep(0.125, 0.19, abs(p.x - 0.5));
  float wy = smoothstep(0.06, 0.13, p.y) * (1.0 - smoothstep(0.34, 0.41, p.y));
  return wx * wy;
}

// 1 inside, easing to 0 across a band \`width\` deep from the edge; no band
// at all when width is 0.
float feather(float fromEdge, float width) {
  return width <= 0.0 ? 1.0 : smoothstep(0.0, width, fromEdge);
}

void main() {
  // A hair of overscan so the pointer drift never shows an edge.
  vec2 uv = (vUv - 0.5) * 0.99 + 0.5 + uShift;
  // The podium rises and settles: sampling from below lifts it.
  uv.y -= uLift * podium(vUv);
  vec3 colour = mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMix);
  // While the section is still moving in or out, the plate's leading edge
  // dissolves into the fog instead of sliding over it as a hard line.
  float y = gl_FragCoord.y / uBufferHeight;          // 0 bottom, 1 top
  float edge = feather(1.0 - y, uFeatherTop) * feather(y, uFeatherBottom);
  gl_FragColor = vec4(colour, uOpacity * edge);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a; // premultiplied, as the canvas is
}
`;

/* How deep the dissolving edge is, as a fraction of the canvas: wide while
   the section is well on its way, shrinking to nothing over the last fifth
   of the approach so the plate is whole by the time it fills the screen. */
function featherFor(gap: number) {
  if (gap <= 0) return 0;
  const visible = 1 - gap;
  const settle = Math.min(1, gap / 0.2);
  return Math.min(visible * 0.9, 0.5) * settle * settle * (3 - 2 * settle);
}

/* The podium breathes: a slow rise and settle of a few pixels (about 0.5%
   of the plate's height), two sines so it never quite repeats. The mark
   above it holds still, so the gap between them gently changes and the
   mark reads as floating. Ambient, so under reduced motion it runs at half
   speed rather than stopping. */
const PODIUM_LIFT = 0.005;

function Backdrop({ glyphs, reducedMotion }: { glyphs: readonly GlyphKey[]; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mesh = useRef<THREE.Mesh>(null);
  const plates = useRef<(THREE.Texture | null)[]>(glyphs.map(() => null));
  const fade = useRef({ from: 0, to: 0, mix: 1, opacity: 0 });
  const pointer = useRef(new THREE.Vector2());
  const drift = useRef(new THREE.Vector2());
  const breath = useRef(0);

  const geometry = useMemo(() => {
    const h = 2 * PLATE_DISTANCE * Math.tan(THREE.MathUtils.degToRad(35 / 2));
    return new THREE.PlaneGeometry(h * PLATE_ASPECT, h);
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uA: { value: null },
          uB: { value: null },
          uMix: { value: 0 },
          uOpacity: { value: 0 },
          uShift: { value: new THREE.Vector2() },
          uBufferHeight: { value: 1 },
          uFeatherTop: { value: 0 },
          uFeatherBottom: { value: 0 },
          uLift: { value: 0 },
        },
        vertexShader: PLATE_VERTEX,
        fragmentShader: PLATE_FRAGMENT,
        /* Drawn in the OPAQUE pass so renderOrder puts it first: three
           draws every transparent object after the opaque ones, which would
           paint the plate over the beads. Custom blending still lets it
           fade in with the stage. */
        transparent: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const fallback = Object.values(WORLD_PLATES)[0];
    const byUrl = new Map<string, THREE.Texture>();
    let alive = true;
    glyphs.forEach((glyph, i) => {
      const url = WORLD_PLATES[glyph] ?? fallback;
      if (!url) return;
      const ready = (tex: THREE.Texture) => {
        if (alive) plates.current[i] = tex;
      };
      const cached = byUrl.get(url);
      if (cached) return ready(cached);
      const tex = loader.load(url, ready);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      byUrl.set(url, tex);
    });
    const onMove = (e: PointerEvent) =>
      pointer.current.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      alive = false;
      window.removeEventListener('pointermove', onMove);
      byUrl.forEach((t) => t.dispose());
      geometry.dispose();
      material.dispose();
    };
  }, [glyphs, geometry, material]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const plane = mesh.current;
    if (!plane) return;
    // Locked to the camera, PLATE_DISTANCE down its view axis.
    plane.quaternion.copy(camera.quaternion);
    plane.position.copy(camera.position).add(
      new THREE.Vector3(0, 0, -PLATE_DISTANCE).applyQuaternion(camera.quaternion),
    );

    const f = fade.current;
    const target = activeSocial();
    if (target !== f.to) {
      // Retargeting mid-fade keeps whichever world is more visible.
      if (f.mix > 0.5) f.from = f.to;
      f.to = target;
      f.mix = 0;
    }
    f.mix = Math.min(1, f.mix + dt / CROSSFADE_SECONDS);
    f.opacity = damp(f.opacity, scrollState.stage, 3, dt);

    const a = plates.current[f.from] ?? plates.current[f.to];
    const b = plates.current[f.to] ?? a;
    const u = material.uniforms;
    u.uA.value = a;
    u.uB.value = b;
    u.uMix.value = f.mix * f.mix * (3 - 2 * f.mix);
    u.uOpacity.value = a ? f.opacity : 0;
    // Where the canvas sits in the viewport right now (it scrolls with the
    // section until the pin takes it, and again after the pin releases).
    const rect = gl.domElement.getBoundingClientRect();
    const vh = window.innerHeight;
    u.uBufferHeight.value = gl.domElement.height;
    u.uFeatherTop.value = featherFor(Math.min(1, Math.max(0, rect.top / vh)));
    u.uFeatherBottom.value = featherFor(Math.min(1, Math.max(0, (vh - rect.bottom) / vh)));

    drift.current.lerp(pointer.current, 1 - Math.exp(-2.5 * dt));
    u.uShift.value.set(-drift.current.x * 0.003, drift.current.y * 0.002);

    breath.current += dt * (reducedMotion ? 0.5 : 1);
    const t = breath.current;
    u.uLift.value = PODIUM_LIFT * (0.5 + 0.38 * Math.sin((t * Math.PI * 2) / 6.5) + 0.12 * Math.sin(t * 1.7 + 1.3));
  });

  return (
    <mesh ref={mesh} geometry={geometry} material={material} renderOrder={-10} frustumCulled={false} />
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
        // Capped at 1.5×: the world plate is soft by nature and the beads
        // read the same, while 2× doubles the fill cost of a full-screen stage.
        dpr={[dpr[0], Math.min(dpr[1], 1.5)]}
        frameloop={inView ? 'always' : 'never'}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 35, near: 0.1, far: 60, position: CAMERA_POS.toArray() }}
      >
        <FixedCamera />
        <fog attach="fog" args={[tones.fog, 9, 22]} />
        <hemisphereLight args={[tones.sky, tones.floor, 1.6]} />
        <directionalLight position={[-2, 6, 4]} intensity={1.4} />
        <Backdrop glyphs={glyphs} reducedMotion={reducedMotion} />
        <Dust reducedMotion={reducedMotion} />
        <Mark glyphs={glyphs} simSize={SIM_SIZE[tier]} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
