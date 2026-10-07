/**
 * „Moja stanica“: stanica koju je korisnik izabrao kao svoju (samo ovaj pregledač).
 *
 * Izbor se čuva u localStorage (ključ `MY_STATION_KEY`), svako čitanje i pisanje je u
 * try/catch (privatni prozor, blokirano skladište, Fabric iframe). Kad skladište ne radi,
 * izbor važi do osvežavanja strane (memorija modula). Sve instance hook-a dele isto stanje
 * (Pregled, detalj stanice na Mapi, paleta …), a promena u drugoj kartici stiže kroz `storage`.
 * Sačuvani id se uvek proverava prema trenutnoj listi stanica – ugašena ili promenjena stanica
 * daje `missing: true`, nikad tuđe ili staro očitavanje.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { StationView } from '@/lib/stations';

export const MY_STATION_KEY = 'vazduh-moja-stanica';

/** Najduži id koji prihvatamo iz skladišta (UUID v5 ima 36 znakova; demo id-jevi su kraći). */
const MAX_ID_LENGTH = 128;

/** `undefined` = skladište još nije pročitano. */
let memory: string | null | undefined;
const listeners = new Set<() => void>();

function sanitize(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function readStorage(): string | null {
  try {
    return sanitize(localStorage.getItem(MY_STATION_KEY));
  } catch {
    return null;
  }
}

/** Sačuvani id moje stanice (bez provere da li stanica postoji) ili null. */
export function readMyStationId(): string | null {
  if (memory === undefined) memory = readStorage();
  return memory;
}

/** Postavlja (`id`) ili briše (`null`) moju stanicu i obaveštava sve instance hook-a. */
export function writeMyStationId(id: string | null): void {
  const next = sanitize(id);
  memory = next;
  try {
    if (next) localStorage.setItem(MY_STATION_KEY, next);
    else localStorage.removeItem(MY_STATION_KEY);
  } catch {
    /* skladište nedostupno – izbor važi do osvežavanja strane */
  }
  for (const listener of listeners) listener();
}

/** Samo za testove: zaboravlja pročitanu vrednost (sledeće čitanje ide u skladište). */
export function resetMyStationCache(): void {
  memory = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MY_STATION_KEY) return;
    memory = readStorage();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export interface ResolvedMyStation {
  /** Stanica iz trenutne liste ili null (nije izabrana, nije pronađena ili lista još nije učitana). */
  view: StationView | null;
  /** Id je sačuvan, stanice su učitane, a te stanice nema (ugašena ili promenjen id). */
  missing: boolean;
}

/** Provera sačuvanog id-ja prema trenutnoj listi stanica (čista funkcija). */
export function resolveMyStation(id: string | null, views: readonly StationView[]): ResolvedMyStation {
  if (!id || views.length === 0) return { view: null, missing: false };
  const view = views.find((candidate) => candidate.id === id) ?? null;
  return { view, missing: view === null };
}

export interface MyStation extends ResolvedMyStation {
  /** Sirovi sačuvani id (i kad stanica više ne postoji) ili null. */
  storedId: string | null;
  /** Da li je ova stanica moja. */
  isMine: (stationId: string) => boolean;
  /** Postavlja moju stanicu; `null` je uklanja. */
  setMyStation: (stationId: string | null) => void;
  /** Prekidač „Postavi kao moju stanicu“: ista stanica se uklanja, druga postaje moja. */
  toggleMyStation: (stationId: string) => void;
}

/**
 * Moja stanica proverena prema `views` (najčešće `useAtmosfera().views` – cela mreža, ne samo
 * filtrirani okrug). Primer za prekidač u detalju stanice:
 *
 *   const { isMine, toggleMyStation } = useMyStation(views);
 *   <button aria-pressed={isMine(view.id)} onClick={() => toggleMyStation(view.id)}>…</button>
 */
export function useMyStation(views: readonly StationView[]): MyStation {
  const storedId = useSyncExternalStore(subscribe, readMyStationId, () => null);
  const resolved = useMemo(() => resolveMyStation(storedId, views), [storedId, views]);
  const isMine = useCallback((stationId: string) => storedId !== null && storedId === stationId, [storedId]);
  const setMyStation = useCallback((stationId: string | null) => writeMyStationId(stationId), []);
  const toggleMyStation = useCallback((stationId: string) => writeMyStationId(readMyStationId() === stationId ? null : stationId), []);
  return useMemo(
    () => ({ ...resolved, storedId, isMine, setMyStation, toggleMyStation }),
    [resolved, storedId, isMine, setMyStation, toggleMyStation],
  );
}
