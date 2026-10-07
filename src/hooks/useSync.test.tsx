import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackfillResult, DailyStatRecord, SyncResult } from '@shared/contracts';
import { deadlineWarning, stationWarning, SYNC_ALREADY_RUNNING } from '@shared/syncNotes';
import { addDays, todayLocal } from '@shared/time';

import { syncSuccessOutcome, useSync } from '@/hooks/useSync';
import type { DataService } from '@/services/dataService';

const NOW = new Date('2026-10-07T09:30:00Z');
const TODAY = todayLocal(NOW); // 2026-10-07

function syncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    ok: true,
    syncRunId: 'r',
    from: NOW.toISOString(),
    to: NOW.toISOString(),
    stationsSeen: 60,
    stationsWritten: 60,
    observationsSeen: 9000,
    snapshotsWritten: 55,
    dailyStatsWritten: 500,
    durationMs: 90_000,
    warnings: [],
    ...overrides,
  };
}

/** Potpun dan za 5 stanica. */
function fullDay(daysAgo: number): DailyStatRecord[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${daysAgo}-${i}`,
    station_id: `s${i}`,
    parameter: 'PM10',
    day: addDays(TODAY, -daysAgo),
    avgValue: 20,
    maxValue: 30,
    minValue: 10,
    maxHour: 20,
    hours: 24,
    categoryMax: 1,
    updatedAt: NOW,
  }));
}

function service(overrides: Partial<DataService> = {}): DataService {
  return {
    mode: 'demo',
    listStations: vi.fn(async () => []),
    listSnapshots: vi.fn(async () => []),
    listDailyStats: vi.fn(async () => []),
    listNetworkDailyStats: vi.fn(async () => []),
    listSyncRuns: vi.fn(async () => []),
    latestSuccessfulSync: vi.fn(async () => null),
    runSync: vi.fn(async () => syncResult()),
    runBackfill: vi.fn(async (day: string): Promise<BackfillResult> => ({
      ok: true,
      syncRunId: day,
      day,
      stationsSeen: 5,
      observationsSeen: 120,
      dailyStatsWritten: 5,
      durationMs: 1,
      warnings: [],
    })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('syncSuccessOutcome', () => {
  it('delimična sinhronizacija: „Osveženo delimično: X od Y stanica“ sa razlozima', () => {
    const outcome = syncSuccessOutcome(
      syncResult({ warnings: [deadlineWarning(12), stationWarning(106, 'HTTP 500'), stationWarning(7, 'fetch failed')] }),
    );
    expect(outcome.tone).toBe('partial');
    expect(outcome.title).toBe('Osveženo delimično: 46 od 60 stanica');
    expect(outcome.detail).toMatch(/^2 stanice bez odgovora izvora, 12 preskočeno zbog vremenskog limita; te stanice zadržavaju ranije podatke\./);
  });

  it('bez upozorenja o stanicama: „Podaci su osveženi“; demo napomena se navodi rečima', () => {
    const outcome = syncSuccessOutcome(syncResult({ warnings: ['Demo režim: podaci nisu stvarna merenja.'] }));
    expect(outcome).toMatchObject({ tone: 'ok', title: 'Podaci su osveženi' });
    expect(outcome.detail).toBe('60 stanica, 9.000 merenja, 55 snimaka. Demo režim: podaci nisu stvarna merenja.');
  });
});

describe('useSync', () => {
  it('server koji odbija drugi posao daje obaveštenje, ne grešku, i ponovo učitava podatke', async () => {
    const onComplete = vi.fn();
    const svc = service({ runSync: vi.fn(async () => syncResult({ ok: false, syncRunId: '', error: `${SYNC_ALREADY_RUNNING} (pokrenuta pre 1 min u drugoj sesiji).` })) });
    const { result } = renderHook(() => useSync(svc, onComplete));
    await act(async () => {
      await result.current.startSync();
    });
    expect(result.current.outcome).toMatchObject({ tone: 'info', ok: false, title: 'Sinhronizacija je već u toku' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('dopunjava samo dane koji nisu potpuni, od najstarijeg; posle zaustavljanja nastavlja gde je stalo', async () => {
    // U bazi su svi dani osim 5, 9 i 20 dana unazad.
    const stored = new Set(Array.from({ length: 30 }, (_, i) => i + 1).filter((d) => ![5, 9, 20].includes(d)));
    const svc = service({
      listNetworkDailyStats: vi.fn(async () => [...stored].flatMap(fullDay)),
    });
    const calls: string[] = [];
    let stopAfterFirst = true;
    const { result } = renderHook(() => useSync(svc, vi.fn()));
    svc.runBackfill = vi.fn(async (day: string) => {
      calls.push(day);
      stored.add(Math.round((Date.parse(`${TODAY}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000));
      if (stopAfterFirst) result.current.stopBackfill();
      return { ok: true, syncRunId: day, day, stationsSeen: 5, observationsSeen: 120, dailyStatsWritten: 5, durationMs: 1, warnings: [] };
    });

    await act(async () => {
      await result.current.startBackfill();
    });
    expect(calls).toEqual([addDays(TODAY, -20)]);
    expect(result.current.outcome).toMatchObject({ tone: 'stopped', title: 'Dopunjavanje zaustavljeno (1 od 3 dana)' });
    expect(result.current.outcome?.detail).toMatch(/nastavlja od prvog dana koji još nedostaje/);

    stopAfterFirst = false;
    await act(async () => {
      await result.current.startBackfill();
    });
    // Nastavak: dan 20 je sada u bazi, ostaju 9 pa 5 (najstariji prvi).
    expect(calls).toEqual([addDays(TODAY, -20), addDays(TODAY, -9), addDays(TODAY, -5)]);
    expect(result.current.outcome).toMatchObject({ tone: 'ok', title: 'Istorija dopunjena: 2 od 2 dana' });

    await act(async () => {
      await result.current.startBackfill();
    });
    expect(calls).toHaveLength(3);
    expect(result.current.outcome).toMatchObject({ tone: 'info', title: 'Istorija je već potpuna' });
  });

  it('neuspela provera istorije je greška bez poziva funkcije', async () => {
    const svc = service({ listNetworkDailyStats: vi.fn(async () => Promise.reject(new Error('HTTP 401 Unauthorized'))) });
    const { result } = renderHook(() => useSync(svc, vi.fn()));
    await act(async () => {
      await result.current.startBackfill();
    });
    expect(svc.runBackfill).not.toHaveBeenCalled();
    expect(result.current.outcome).toMatchObject({ tone: 'error', title: 'Provera istorije nije uspela' });
    expect(result.current.outcome?.detail).toMatch(/^Sesija nije važeća\./);
    expect(result.current.activity).toBeNull();
  });
});
