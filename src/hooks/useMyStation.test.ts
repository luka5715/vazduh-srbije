import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StationRecord, StationSnapshotRecord } from '@shared/contracts';

import { buildStationViews } from '@/lib/stations';

import { MY_STATION_KEY, readMyStationId, resetMyStationCache, resolveMyStation, useMyStation, writeMyStationId } from './useMyStation';

const NOW = new Date('2026-10-07T09:30:00Z');

function station(id: string, name: string): StationRecord {
  return { id, sepaId: 1, code: id.toUpperCase(), name, municipality: 'Niš', latitude: null, longitude: null, active: true, updatedAt: NOW.toISOString() };
}

const VIEWS = buildStationViews([station('ni', 'Niš 1'), station('bg', 'Beograd 1')], [] as StationSnapshotRecord[], NOW);

describe('useMyStation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    localStorage.clear();
    resetMyStationCache();
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    resetMyStationCache();
  });

  it('pamti izbor u localStorage i deli ga između instanci', () => {
    const first = renderHook(() => useMyStation(VIEWS));
    const second = renderHook(() => useMyStation(VIEWS));
    expect(first.result.current.view).toBeNull();
    expect(first.result.current.missing).toBe(false);

    act(() => first.result.current.setMyStation('ni'));
    expect(localStorage.getItem(MY_STATION_KEY)).toBe('ni');
    expect(second.result.current.view?.station.name).toBe('Niš 1');
    expect(second.result.current.isMine('ni')).toBe(true);
    expect(second.result.current.isMine('bg')).toBe(false);

    // Prekidač: ista stanica se uklanja, druga postaje moja.
    act(() => second.result.current.toggleMyStation('bg'));
    expect(first.result.current.storedId).toBe('bg');
    act(() => second.result.current.toggleMyStation('bg'));
    expect(first.result.current.storedId).toBeNull();
    expect(localStorage.getItem(MY_STATION_KEY)).toBeNull();
  });

  it('čita sačuvanu stanicu pri pokretanju i proverava je prema listi stanica', () => {
    localStorage.setItem(MY_STATION_KEY, 'ugasena');
    const { result, rerender } = renderHook(({ views }) => useMyStation(views), { initialProps: { views: VIEWS } });
    expect(result.current.storedId).toBe('ugasena');
    expect(result.current.view).toBeNull();
    expect(result.current.missing).toBe(true);
    // Dok lista stanica nije učitana, id nije „nestao“.
    rerender({ views: [] });
    expect(result.current.missing).toBe(false);
  });

  it('radi i kad localStorage baca grešku (izbor važi do osvežavanja)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    resetMyStationCache();
    const { result } = renderHook(() => useMyStation(VIEWS));
    expect(result.current.storedId).toBeNull();
    act(() => result.current.setMyStation('bg'));
    expect(result.current.view?.id).toBe('bg');
    expect(readMyStationId()).toBe('bg');
  });

  it('promena iz druge kartice stiže kroz događaj „storage“', () => {
    const { result } = renderHook(() => useMyStation(VIEWS));
    act(() => {
      localStorage.setItem(MY_STATION_KEY, 'ni');
      window.dispatchEvent(new StorageEvent('storage', { key: MY_STATION_KEY }));
    });
    expect(result.current.view?.id).toBe('ni');
  });

  it('odbacuje neispravne vrednosti i proverava id čistom funkcijom', () => {
    writeMyStationId('   ');
    expect(readMyStationId()).toBeNull();
    writeMyStationId('x'.repeat(500));
    expect(readMyStationId()).toBeNull();
    expect(resolveMyStation(null, VIEWS)).toEqual({ view: null, missing: false });
    expect(resolveMyStation('bg', VIEWS).view?.id).toBe('bg');
    expect(resolveMyStation('nema', VIEWS)).toEqual({ view: null, missing: true });
  });
});
