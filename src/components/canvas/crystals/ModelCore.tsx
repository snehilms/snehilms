'use client';

import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

/* ============================================================================
   MODEL CORE

   Optional: renders a real .glb in place of a generated core when a project
   sets `core.model`. Drop the file in /public and point at it, e.g.

     core: { kind: 'graph', model: '/models/penguin.glb', modelScale: 0.9 }

   Two safety nets, because a missing or malformed file is the likeliest
   thing to go wrong here and it must never take the page down:

     Suspense       covers the load, showing the generated core meanwhile.
     ErrorBoundary  covers a 404 or a parse failure, falling back for good.

   The model keeps its own materials, so it needs real lights — Scene adds a
   small ambient and key pair that only lit materials respond to. Every
   custom shader in this project ignores them.
   ========================================================================= */

type FallbackProps = { children: ReactNode; fallback: ReactNode };

class ModelErrorBoundary extends Component<FallbackProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[ModelCore] failed to load model, using generated core:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Model({
  url,
  scale,
  opacityRef,
}: {
  url: string;
  scale: number;
  opacityRef: React.RefObject<number>;
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  /* Clone so two shards pointing at the same file cannot share — and mutate
     — one scene graph. Materials are cloned too, since opacity is animated
     per instance. */
  const model = useMemo(() => {
    const copy = scene.clone(true);

    copy.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const source = child.material as THREE.Material | THREE.Material[];
      child.material = Array.isArray(source)
        ? source.map((m) => m.clone())
        : source.clone();
      child.castShadow = false;
      child.receiveShadow = false;
    });

    // Normalise: centre the model and fit it to a unit box before scaling.
    const box = new THREE.Box3().setFromObject(copy);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);

    const longest = Math.max(size.x, size.y, size.z) || 1;
    copy.position.sub(centre);
    copy.scale.setScalar(1 / longest);

    return copy;
  }, [scene]);

  useEffect(() => {
    return () => {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    };
  }, [model]);

  useFrame((state) => {
    const opacity = opacityRef.current ?? 0;
    const group = groupRef.current;
    if (!group) return;

    group.rotation.y = -state.clock.elapsedTime * 0.09;
    group.visible = opacity > 0.01;

    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.Material | THREE.Material[];
      const apply = (m: THREE.Material) => {
        m.transparent = true;
        m.opacity = opacity;
        m.depthWrite = opacity > 0.55;
      };
      if (Array.isArray(material)) material.forEach(apply);
      else apply(material);
    });
  });

  // 0.9 of the shard's inner bound: enough clearance to read as suspended.
  return (
    <group ref={groupRef} scale={scale} renderOrder={1}>
      <primitive object={model} />
    </group>
  );
}

export function ModelCore({
  url,
  scale = 0.8,
  fallback,
  opacityRef,
}: {
  url: string;
  scale?: number;
  fallback: ReactNode;
  opacityRef: React.RefObject<number>;
}) {
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Model url={url} scale={scale} opacityRef={opacityRef} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
