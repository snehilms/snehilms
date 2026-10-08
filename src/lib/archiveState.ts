/* ============================================================================
   ARCHIVE STATE

   Two different lifetimes, two different mechanisms.

   `archiveState` is mutable and lives outside React: hover and scroll
   presence change every frame and are read inside useFrame, where a React
   render would cost more than the work being done.

   `dossier` is a real store with subscriptions, because opening a project
   changes what the DOM renders and happens at most a handful of times.
   ========================================================================= */

import { useSyncExternalStore } from 'react';

export const archiveState = {
  /** Index of the shard under the pointer, or -1. */
  hovered: -1,
  /** 0 → 1 as the archive chapter occupies the viewport. */
  presence: 0,
  /** Damped presence, for anything that should lag the scroll slightly. */
  presenceSmooth: 0,
  /** The DOM slots, registered by Archive. The gallery measures them every
      frame and puts each shard exactly behind its slot. */
  slots: [] as (HTMLElement | null)[],
};

/* --- Dossier store ------------------------------------------------------ */

let openId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const dossier = {
  open(id: string) {
    if (openId === id) return;
    openId = id;
    emit();
  },
  close() {
    if (openId === null) return;
    openId = null;
    emit();
  },
  get: () => openId,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Subscribes a component to the currently open project id. */
export function useDossier() {
  return useSyncExternalStore(dossier.subscribe, dossier.get, () => null);
}
