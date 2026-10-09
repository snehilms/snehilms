'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

import {
  PLATE_VERTEX,
  PLATE_FRAGMENT,
  WIRE_VERTEX,
  WIRE_FRAGMENT,
  GLINT_VERTEX,
  GLINT_FRAGMENT,
} from './ice.glsl';
import { archiveState } from '@/lib/archiveState';
import { damp, scrollState, smoothstep } from '@/lib/scrollState';
import { sound } from '@/lib/sound';

/* ============================================================================
   ICE CRYSTAL

   A project frozen in a block of ice, path traced offline
   (art/scripts/crystal_core.py) and played here as a sway loop on a plate
   that faces the camera. Real-time glass cannot refract, frost and trap air
   like Cycles can; what has to stay live does: on hover, the ice block's
   evenly triangulated surface is drawn around the pointer's path, projected
   through the exact Blender camera and the pivot matrix of the frame on
   screen, so the mesh sits on the rendered crystal frame for frame.

   Unit plate height: CrystalGallery scales the group so one unit is the
   plate's height on screen, measured from the slot.

   Loads in two steps. The poster (one still, straight alpha) is up almost at
   once; the video replaces it when it can play. Reduced motion keeps the
   poster and its pose, and the hover mesh still works.
   ========================================================================= */

type Meta = {
  fps: number;
  frames: number;
  aspect: number;
  view: number[];
  proj: number[];
  camera: number[];
  poses: number[][];
  envelope: { positions: number[]; indices: number[] };
};

/* The wave (owner's calls): moving the pointer sends one wave at a time,
   from a pinpoint where the pointer is, outward along the way it is moving.
   Nothing glows at rest or on arrival. Any movement counts, however small
   (a fixed distance threshold read as a dead zone): a nudge sends a faint
   wave, a sweep a full one. A new wave waits until the last is half spent. */
const WAVES = 2;
const WAVE_LIFE = 1.5;
const WAVE_NUDGE = 0.004; // plate heights: a few pixels, just above jitter
const WAVE_FULL = 0.08; // movement that sends a full-strength wave
const WAVE_READY = 0.5; // the previous wave must be this far through its life
const WAVE_IDLE = 0.25; // seconds still before movement so far is forgotten

/* Transit: a crystal rolls a little and settles back as it rises through
   the screen, and fades into the fog at the top and bottom edges. */
const ROLL = 0.3; // radians at one screen-height from centre
const TRANSIT_SCALE = 0.14;
const WIRE_COLOR = new THREE.Color('#f6f9fc');
const WIRE_HALO = new THREE.Color('#323b49'); // --c-ink-3

/** Row-major array (as Blender writes it) into a three Matrix4. */
function rowMajor(m: THREE.Matrix4, a: number[]) {
  // prettier-ignore
  m.set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7],
        a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]);
  return m;
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Non-indexed envelope with per-face normals and barycentrics. */
function envelopeGeometry(meta: Meta) {
  const { positions: p, indices: idx } = meta.envelope;
  const tris = idx.length / 3;
  const pos = new Float32Array(tris * 9);
  const nor = new Float32Array(tris * 9);
  const bar = new Float32Array(tris * 9);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromArray(p, idx[t * 3] * 3);
    b.fromArray(p, idx[t * 3 + 1] * 3);
    c.fromArray(p, idx[t * 3 + 2] * 3);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    [a, b, c].forEach((v, k) => {
      v.toArray(pos, t * 9 + k * 3);
      n.toArray(nor, t * 9 + k * 3);
      bar[t * 9 + k * 3 + k] = 1;
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('faceNormal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('bary', new THREE.BufferAttribute(bar, 3));

  const verts = p.length / 3;
  const seeds = new Float32Array(verts);
  for (let i = 0; i < verts; i++) seeds[i] = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const points = new THREE.BufferGeometry();
  points.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  points.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

  return { wire: geo, glints: points };
}

type Props = {
  index: number;
  /** Base path of the published crystal, e.g. '/crystals/v8'. */
  src: string;
  focusIndex: number;
  /** Rendered instead if the crystal's files can't be loaded. */
  fallback: ReactNode;
};

export function IceCrystal({ index, src, focusIndex, fallback }: Props) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const plateRef = useRef<THREE.Group>(null);
  const opacityRef = useRef(0);
  const hoverRef = useRef(0);
  const frameRef = useRef(-1);

  /* --- Data ---------------------------------------------------------- */
  useEffect(() => {
    let live = true;
    fetch(`${src}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((m: Meta) => live && setMeta(m))
      .catch((e) => {
        console.error('[IceCrystal] metadata failed, showing the shard:', e);
        archiveState.plateFailed[index] = true;
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [src, index]);

  /* --- Materials ------------------------------------------------------ */
  const mats = useMemo(() => {
    const projection = {
      uView: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uPose: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uHalf: { value: new THREE.Vector2(0.4, 0.5) },
    };
    const trail = {
      uWave: { value: Array.from({ length: WAVES }, () => new THREE.Vector4(0, 0, 1, 0)) },
      uWaveDir: { value: Array.from({ length: WAVES }, () => new THREE.Vector2(0, 1)) },
      uWaveRadius: { value: 0.3 }, // how far a wave travels from its origin
      uAspect: { value: 0.8 },
    };
    const plate = new THREE.ShaderMaterial({
      vertexShader: PLATE_VERTEX,
      fragmentShader: PLATE_FRAGMENT,
      uniforms: {
        uMap: { value: null as THREE.Texture | null },
        uStacked: { value: 0 },
        uTexelY: { value: 0.0002 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    /* Projection and trail uniform objects are shared, so each frame's pose
       and pointer are written once for both overlays. */
    const wire = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERTEX,
      fragmentShader: WIRE_FRAGMENT,
      uniforms: {
        ...projection,
        ...trail,
        uColor: { value: WIRE_COLOR },
        uHalo: { value: WIRE_HALO },
        uOpacity: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const glint = new THREE.ShaderMaterial({
      vertexShader: GLINT_VERTEX,
      fragmentShader: GLINT_FRAGMENT,
      uniforms: {
        ...projection,
        ...trail,
        uColor: { value: WIRE_COLOR },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 15 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    return { plate, wire, glint, projection, trail };
  }, []);

  useEffect(() => {
    const dpr = Math.min(gl.getPixelRatio(), 2);
    mats.wire.uniforms.uPixelRatio.value = dpr;
    mats.glint.uniforms.uPixelRatio.value = dpr;
  }, [gl, mats]);

  const geo = useMemo(() => (meta ? envelopeGeometry(meta) : null), [meta]);

  useEffect(() => {
    if (!meta) return;
    rowMajor(mats.projection.uView.value, meta.view);
    rowMajor(mats.projection.uProj.value, meta.proj);
    mats.projection.uCam.value.fromArray(meta.camera);
    mats.projection.uHalf.value.set(meta.aspect * 0.5, 0.5);
    mats.trail.uAspect.value = meta.aspect;
  }, [meta, mats]);

  /* --- Poster, then video -------------------------------------------- */
  const media = useRef<{
    video?: HTMLVideoElement;
    videoTex?: THREE.VideoTexture;
    poster?: THREE.Texture;
    playing: boolean;
    still: boolean;
  }>({ playing: false, still: false });

  useEffect(() => {
    if (!meta) return;
    const m = media.current;
    m.still = reducedMotion();
    const mid = Math.floor(meta.frames / 2);
    frameRef.current = mid;

    new THREE.TextureLoader().load(
      `${src}.webp`,
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace; // linearised in the shader
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        m.poster = tex;
        if (!m.playing) {
          mats.plate.uniforms.uMap.value = tex;
          mats.plate.uniforms.uStacked.value = 0;
        }
      },
      undefined,
      // No poster means the crystal was never published: the shard stands in.
      () => {
        archiveState.plateFailed[index] = true;
        setFailed(true);
      },
    );

    if (m.still) return;

    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    /* Nothing streams until the gallery first comes on screen (play() in the
       frame loop starts the download). Phones show cards, never the gallery,
       so they never fetch the video at all. */
    video.preload = 'none';
    video.src = `${src}.mp4`;
    m.video = video;

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    m.videoTex = tex;

    /* The loop is the sweep there and back: map the presented frame's
       media time to the rendered frame, so the wire uses the same pose as
       the picture. requestVideoFrameCallback gives the exact frame; the
       ticker fallback below reads currentTime instead. */
    const period = meta.frames * 2 - 2;
    const toPose = (t: number) => {
      const k = Math.round(t * meta.fps) % period;
      return k < meta.frames ? k : period - k;
    };
    let handle = 0;
    const hasRvfc = 'requestVideoFrameCallback' in video;
    const onFrame = (_: number, info: { mediaTime: number }) => {
      frameRef.current = toPose(info.mediaTime);
      handle = video.requestVideoFrameCallback(onFrame);
    };
    if (hasRvfc) handle = video.requestVideoFrameCallback(onFrame);

    const onPlaying = () => {
      m.playing = true;
      mats.plate.uniforms.uMap.value = tex;
      mats.plate.uniforms.uStacked.value = 1;
      mats.plate.uniforms.uTexelY.value = 0.5 / Math.max(video.videoHeight, 1);
    };
    video.addEventListener('playing', onPlaying, { once: true });
    // Start mid-sweep, the pose the poster shows, so the swap doesn't jump.
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = mid / meta.fps;
      },
      { once: true },
    );
    (video as HTMLVideoElement & { _toPose?: typeof toPose; _rvfc?: boolean })._toPose = toPose;
    (video as HTMLVideoElement & { _rvfc?: boolean })._rvfc = hasRvfc;

    return () => {
      if (hasRvfc) video.cancelVideoFrameCallback(handle);
      video.removeEventListener('playing', onPlaying);
      video.pause();
      video.removeAttribute('src');
      video.load();
      tex.dispose();
      m.video = undefined;
      m.videoTex = undefined;
      m.playing = false;
    };
  }, [meta, src, mats, index]);

  useEffect(() => {
    const m = media.current;
    return () => {
      m.poster?.dispose();
      mats.plate.dispose();
      mats.wire.dispose();
      mats.glint.dispose();
    };
  }, [mats]);

  useEffect(() => {
    return () => {
      geo?.wire.dispose();
      geo?.glints.dispose();
    };
  }, [geo]);

  /* --- Frame ---------------------------------------------------------- */
  const tmp = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      plane: new THREE.Plane(),
      ndc: new THREE.Vector2(),
      hit: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      inv: new THREE.Matrix4(),
      waves: Array.from({ length: WAVES }, () => ({ u: 0, v: 0, born: -1e9, s: 0, dx: 0, dy: 1 })),
      waveHead: 0,
      lastU: -1,
      lastV: -1,
      fromU: 0, // where the last wave started (or the pointer arrived or
      fromV: 0, // came to rest): net movement from here sends the next
      idle: 0,
      headX: 0, // recent heading: newest steps count most
      headY: 0,
      roll: new THREE.Quaternion(),
      zAxis: new THREE.Vector3(0, 0, 1),
      rate: 1,
    }),
    [],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const time = state.clock.elapsedTime;
    const group = groupRef.current;
    const plate = plateRef.current;
    if (!group || !plate || !meta) return;

    const presence = archiveState.presenceSmooth;
    const isOpen = focusIndex === index;
    const someoneOpen = focusIndex !== -1;
    const crowdFade = someoneOpen && !isOpen ? 0.18 : 1;

    /* Where this crystal's slot is on screen: 0 centred, ±1 a full screen
       height above or below. Drives the transit roll and the edge fade. */
    const slotEl = archiveState.slots[index];
    let t = 0;
    if (slotEl && slotEl.isConnected) {
      const r = slotEl.getBoundingClientRect();
      if (r.height > 0) t = (r.top + r.height / 2 - size.height / 2) / size.height;
    }
    const a = Math.abs(t);
    // Fades from a third of a screen out, so two crystals cross-dissolve
    // through the middle rather than one running up under the nav.
    const edgeFade = 1 - smoothstep(0.3, 0.72, a);
    const opacity = presence * crowdFade * edgeFade;
    opacityRef.current = opacity;
    group.visible = opacity > 0.01;

    /* Play only while this crystal is on screen: three 896x2240 streams
       decoding off screen would be waste. Scrolling spins the sway up a
       little, so a crystal turns as it rolls through. */
    const m = media.current;
    if (m.video) {
      if (group.visible && m.video.paused) m.video.play().catch(() => {});
      else if (!group.visible && !m.video.paused) m.video.pause();
      tmp.rate = damp(tmp.rate, 1 + Math.min(Math.abs(scrollState.velocity) * 3, 2.5), 4, dt);
      if (Math.abs(m.video.playbackRate - tmp.rate) > 0.04) m.video.playbackRate = tmp.rate;
      const v = m.video as HTMLVideoElement & { _toPose?: (t: number) => number; _rvfc?: boolean };
      if (!v._rvfc && v._toPose && m.playing) frameRef.current = v._toPose(v.currentTime);
    }

    // Rise into place with the chapter, like the shards did.
    group.position.y = damp(group.position.y, -0.12 + presence * 0.12, 3, dt);

    // Face the camera (the render was made head-on), rolled by the transit.
    const still = media.current.still;
    tmp.roll.setFromAxisAngle(tmp.zAxis, still ? 0 : t * ROLL);
    plate.quaternion.copy(camera.quaternion).multiply(tmp.roll);
    plate.scale.setScalar(1 - TRANSIT_SCALE * Math.min(a, 1));
    /* A barely-there float on top of the rendered sway, each crystal on its
       own phase, so the row never bobs in step. Still under reduced motion. */
    plate.position.y = still ? 0 : Math.sin(time * 0.55 + index * 1.9) * 0.007;
    plate.updateMatrixWorld();

    const hovered = archiveState.hovered === index || isOpen;
    hoverRef.current = damp(hoverRef.current, hovered ? 1 : 0, 6, dt);

    /* Pointer → plate uv. Movement since the last wave (or since arriving)
       starts the next one, from where the pointer is now, along the way it
       has been going. */
    if (archiveState.hovered === index) {
      const { x, y } = archiveState.pointer;
      tmp.ndc.set((x / size.width) * 2 - 1, -((y / size.height) * 2 - 1));
      tmp.ray.setFromCamera(tmp.ndc, camera);
      tmp.normal.set(0, 0, 1).applyQuaternion(plate.getWorldQuaternion(new THREE.Quaternion()));
      tmp.plane.setFromNormalAndCoplanarPoint(tmp.normal, plate.getWorldPosition(tmp.hit));
      if (tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) {
        tmp.inv.copy(plate.matrixWorld).invert();
        tmp.hit.applyMatrix4(tmp.inv);
        const u = tmp.hit.x / meta.aspect + 0.5;
        const v = tmp.hit.y + 0.5;
        if (tmp.lastU < 0) {
          // Arriving only notes where the pointer is: no wave until it moves.
          tmp.lastU = u;
          tmp.lastV = v;
          tmp.fromU = u;
          tmp.fromV = v;
          tmp.idle = 0;
          tmp.headX = 0;
          tmp.headY = 0;
        } else {
          const su = (u - tmp.lastU) * meta.aspect;
          const sv = v - tmp.lastV;
          tmp.lastU = u;
          tmp.lastV = v;
          const step = Math.hypot(su, sv);
          if (step > 1e-6) {
            tmp.idle = 0;
          } else if ((tmp.idle += dt) > WAVE_IDLE) {
            // Resting: what moved before must not fire a wave later.
            tmp.fromU = u;
            tmp.fromV = v;
          }
          // Net, not path length: a trembling hand cancels out instead of
          // adding up to a wave.
          const moved = Math.hypot((u - tmp.fromU) * meta.aspect, v - tmp.fromV);
          const keep = Math.exp(-dt * 8);
          tmp.headX = tmp.headX * keep + su;
          tmp.headY = tmp.headY * keep + sv;
          const heading = Math.hypot(tmp.headX, tmp.headY);
          const last = tmp.waves[tmp.waveHead];
          const ready = (time - last.born) / WAVE_LIFE > WAVE_READY;
          if (ready && tmp.idle === 0 && moved > WAVE_NUDGE && heading > 1e-6) {
            tmp.waveHead = (tmp.waveHead + 1) % WAVES;
            const w = tmp.waves[tmp.waveHead];
            w.u = u;
            w.v = v;
            w.born = time;
            w.s = 0.45 + 0.55 * Math.min(moved / WAVE_FULL, 1);
            w.dx = tmp.headX / heading;
            w.dy = tmp.headY / heading;
            tmp.fromU = u;
            tmp.fromV = v;
            sound.sparkle(w.s, tmp.ndc.x);
          }
        }
      }
    } else {
      // Off the crystal, forget the pointer: coming back must not fire a wave
      // for the distance travelled while away.
      tmp.lastU = -1;
    }
    const waveU = mats.trail.uWave.value;
    const waveD = mats.trail.uWaveDir.value;
    for (let i = 0; i < WAVES; i++) {
      const w = tmp.waves[i];
      waveU[i].set(w.u, w.v, Math.min((time - w.born) / WAVE_LIFE, 1), w.s);
      waveD[i].set(w.dx, w.dy);
    }

    /* Pose of the frame on screen. */
    const f = Math.min(Math.max(frameRef.current, 0), meta.frames - 1);
    rowMajor(mats.projection.uPose.value, meta.poses[f]);

    mats.plate.uniforms.uOpacity.value = opacity;
    const overlay = opacity * hoverRef.current;
    mats.wire.uniforms.uOpacity.value = overlay;
    mats.glint.uniforms.uOpacity.value = overlay;
    mats.glint.uniforms.uTime.value = time;
  });

  if (failed) return <>{fallback}</>;

  return (
    <group ref={groupRef}>
      <group ref={plateRef}>
        {meta && (
          <mesh renderOrder={5} material={mats.plate}>
            <planeGeometry args={[meta.aspect, 1]} />
          </mesh>
        )}
        {geo && <mesh geometry={geo.wire} material={mats.wire} renderOrder={6} frustumCulled={false} />}
        {geo && <points geometry={geo.glints} material={mats.glint} renderOrder={7} frustumCulled={false} />}
      </group>
    </group>
  );
}
