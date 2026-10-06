'use client';

import { useEffect, useState } from 'react';

export type DeviceTier = 'low' | 'mid' | 'high';

export type DeviceProfile = {
  tier: DeviceTier;
  /** Square edge of the GPGPU simulation texture. Particles = edge². */
  simSize: number;
  /** Device pixel ratio ceiling handed to the renderer. */
  dpr: [number, number];
  /** Whether the postprocessing stack runs at all. */
  postprocessing: boolean;
  reducedMotion: boolean;
  isTouch: boolean;
};

const PROFILES: Record<DeviceTier, Omit<DeviceProfile, 'reducedMotion' | 'isTouch'>> = {
  high: { tier: 'high', simSize: 256, dpr: [1, 2], postprocessing: true },
  mid:  { tier: 'mid',  simSize: 192, dpr: [1, 1.5], postprocessing: true },
  low:  { tier: 'low',  simSize: 128, dpr: [1, 1], postprocessing: false },
};

function detect(): DeviceProfile {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const narrow = window.innerWidth < 768;

  let tier: DeviceTier = 'high';
  if (narrow || isTouch || cores <= 4 || mem <= 4) tier = 'mid';
  // Reduced motion is a preference about movement, not a hardware signal:
  // it must never cost the visitor resolution, bead count or post.
  if (cores <= 2 || mem <= 2) tier = 'low';

  return { ...PROFILES[tier], reducedMotion, isTouch };
}

const FALLBACK: DeviceProfile = {
  ...PROFILES.mid,
  reducedMotion: false,
  isTouch: false,
};

/** Resolves after mount — SSR always gets the safe mid profile. */
export function useDeviceTier(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(FALLBACK);

  useEffect(() => {
    setProfile(detect());
  }, []);

  return profile;
}
