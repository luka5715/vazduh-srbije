/**
 * Da li je blok sa napretkom i „Zaustavi“ u heroju Sinhronizacije na ekranu. Heroj ga
 * javlja (IntersectionObserver), a ljuska tada ne prikazuje isti napredak i u obaveštenju;
 * čim se heroj odskroluje, obaveštenje sa napretkom i „Zaustavi“ se vraća.
 */

import { useSyncExternalStore } from 'react';

let visible = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return visible;
}

export function setHeroProgressVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  for (const listener of listeners) listener();
}

export function useHeroProgressVisible(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
