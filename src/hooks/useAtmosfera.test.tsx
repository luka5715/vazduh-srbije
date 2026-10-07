import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncRunRecord } from '@shared/contracts';

import { syncStateOf } from '@/components/sync/runModel';
import { buildDemoCore } from '@/demo/fixture';
import { rankByLens, type Lens } from '@/lib/insights';
import { buildStationViews } from '@/lib/stations';
import type { DataService } from '@/services/dataService';
import type { IAuthService } from '@/services/IAuthService';

const holder = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('@/services/dataService', () => ({ createDataService: () => holder.service }));

// Uvoz posle `vi.mock` (hoisting): provider dobija lažni servis.
const { AuthProvider } = await import('@/hooks/AuthContext');
const { AtmosferaProvider, REMOTE_POLL_MS, RESUME_RELOAD_MS, VISIBLE_RELOAD_MS, useAtmosfera } = await import('@/hooks/useAtmosfera');

const NOW = new Date('2026-10-07T09:30:00Z');
const MINUTE = 60_000;

function syncRun(id: string, status: SyncRunRecord['status'], startedMinutesAgo: number, finishedMinutesAgo: number | null): SyncRunRecord {
  return {
    id,
    kind: 'sync',
    status,
    startedAt: new Date(NOW.getTime() - startedMinutesAgo * MINUTE).toISOString(),
    finishedAt: finishedMinutesAgo === null ? null : new Date(NOW.getTime() - finishedMinutesAgo * MINUTE).toISOString(),
    windowFrom: new Date(NOW.getTime() - 36 * 60 * MINUTE).toISOString(),
    windowTo: NOW.toISOString(),
    stationsSeen: 25,
    observationsSeen: 900,
    rowsWritten: 25,
    message: null,
  };
}

/** Servis čiji `running` red (posao druge sesije) postaje `ok` od drugog čitanja dnevnika. */
function remoteSyncService() {
  const oldOk = syncRun('old', 'ok', 30, 29);
  const running = syncRun('remote', 'running', 1, null);
  const finished = { ...running, status: 'ok' as const, finishedAt: new Date(NOW.getTime() + 20_000).toISOString() };
  let runCalls = 0;
  let okCalls = 0;
  const service: DataService = {
    mode: 'demo',
    listStations: vi.fn(async () => []),
    listSnapshots: vi.fn(async () => []),
    listDailyStats: vi.fn(async () => []),
    listNetworkDailyStats: vi.fn(async () => []),
    listSyncRuns: vi.fn(async () => (++runCalls === 1 ? [running, oldOk] : [finished, oldOk])),
    latestSuccessfulSync: vi.fn(async () => (++okCalls === 1 ? oldOk : finished)),
    runSync: vi.fn(),
    runBackfill: vi.fn(),
  };
  return service;
}

const auth: IAuthService = {
  mode: 'demo',
  config: { kind: 'demo' },
  canSignIn: true,
  resolveSession: async () => ({ id: 'u', email: 'demo@example.invalid', name: 'Demo' }),
  signIn: async () => ({ id: 'u', email: 'demo@example.invalid', name: 'Demo' }),
  signOut: async () => undefined,
};

const seen: string[] = [];

function Probe() {
  const { data, sync, lastSync, now, dataVersion, syncHealth } = useAtmosfera();
  const state = syncStateOf(sync.activity?.kind ?? null, data.syncRuns, lastSync, now);
  if (data.status === 'ready') seen.push(state.kind);
  return <p data-testid="probe">{`${data.status}|${state.kind}|${syncHealth}|v${dataVersion}`}</p>;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AtmosferaProvider – posao druge sesije', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    seen.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('prati `running` red druge sesije i prelazi u „sveže“ bez „neuspelo“', async () => {
    const service = remoteSyncService();
    holder.service = service;
    render(
      <MemoryRouter initialEntries={['/?view=sinhronizacija']}>
        <AuthProvider authService={auth}>
          <AtmosferaProvider>
            <Probe />
          </AtmosferaProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('ready|remote-running|running|v0');
    expect(service.listSyncRuns).toHaveBeenCalledTimes(1);

    await flush(REMOTE_POLL_MS);
    expect(service.listSyncRuns).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('probe')).toHaveTextContent('ready|fresh|ok|v1');

    // Posle isteka tolerancije (5 min) ostaje „sveže“, bez novih učitavanja.
    await flush(6 * MINUTE);
    expect(screen.getByTestId('probe')).toHaveTextContent('ready|fresh|ok|v1');
    expect(service.listSyncRuns).toHaveBeenCalledTimes(2);
    expect(seen).not.toContain('failed');
  });
});

function StationProbe() {
  const { data, selected } = useAtmosfera();
  const [params] = useSearchParams();
  return <p data-testid="station">{`${data.status}|${params.get('station') ?? '-'}|${selected?.id ?? '-'}`}</p>;
}

describe('AtmosferaProvider – podrazumevana stanica Mape', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each<Lens>(['worst', 'O3'])('bez ?station= upisuje „Najlošije sada“ sa Pregleda (sočivo %s)', async (lens) => {
    const core = buildDemoCore(NOW);
    const okRun = syncRun('ok', 'ok', 10, 9);
    holder.service = {
      mode: 'demo',
      listStations: vi.fn(async () => core.stations),
      listSnapshots: vi.fn(async () => core.snapshots),
      listDailyStats: vi.fn(async () => []),
      listNetworkDailyStats: vi.fn(async () => []),
      listSyncRuns: vi.fn(async () => [okRun]),
      latestSuccessfulSync: vi.fn(async () => okRun),
      runSync: vi.fn(),
      runBackfill: vi.fn(),
    } satisfies DataService;
    const expected = rankByLens(buildStationViews(core.stations, core.snapshots, NOW), lens, 1)[0]?.view.id;
    expect(expected).toBeTruthy();

    render(
      <MemoryRouter initialEntries={[lens === 'worst' ? '/?view=mapa' : `/?view=mapa&lens=${lens}`]}>
        <AuthProvider authService={auth}>
          <AtmosferaProvider>
            <StationProbe />
          </AtmosferaProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByTestId('station')).toHaveTextContent(`ready|${expected}|${expected}`);
  });
});

const rayfinAuth: IAuthService = { ...auth, mode: 'rayfin', config: { kind: 'ready' } };

function okService(okMinutesAgo: number, extraRuns: SyncRunRecord[] = [], dataAt: Date | null = null) {
  const okRun = syncRun('ok', 'ok', okMinutesAgo + 1, okMinutesAgo);
  // Demo stanice i snimci čiji je najnoviji sat ~1 h pre `dataAt` (null = prazna baza).
  const core = dataAt ? buildDemoCore(dataAt) : { stations: [], snapshots: [] };
  const service = {
    mode: 'demo',
    listStations: vi.fn(async () => core.stations),
    listSnapshots: vi.fn(async () => core.snapshots),
    listDailyStats: vi.fn(async () => []),
    listNetworkDailyStats: vi.fn(async () => []),
    listSyncRuns: vi.fn(async () => [...extraRuns, okRun]),
    latestSuccessfulSync: vi.fn(async () => okRun),
    runSync: vi.fn(async () => ({
      ok: true,
      syncRunId: 'new',
      from: NOW.toISOString(),
      to: NOW.toISOString(),
      stationsSeen: 25,
      stationsWritten: 25,
      observationsSeen: 900,
      snapshotsWritten: 25,
      dailyStatsWritten: 50,
      durationMs: 1000,
      warnings: [],
    })),
    runBackfill: vi.fn(),
  } satisfies DataService;
  return service;
}

function RefreshProbe() {
  const { data, sync, refresh } = useAtmosfera();
  return (
    <>
      <p data-testid="outcome">{`${data.status}|${sync.outcome?.tone ?? '-'}|${sync.outcome?.title ?? '-'}`}</p>
      <button type="button" onClick={refresh}>
        osveži
      </button>
    </>
  );
}

function renderWith(authService: IAuthService) {
  return render(
    <MemoryRouter initialEntries={['/?view=pregled']}>
      <AuthProvider authService={authService}>
        <AtmosferaProvider>
          <RefreshProbe />
        </AtmosferaProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AtmosferaProvider – kartica se vraća, dugme „Osveži“', () => {
  let visibility: DocumentVisibilityState = 'visible';
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('posle > 10 min u pozadini tiho ponovo čita bazu i ponovo primenjuje pravilo od 65 min', async () => {
    const service = okService(30);
    holder.service = service;
    renderWith(rayfinAuth);
    await flush();
    expect(service.listSyncRuns).toHaveBeenCalledTimes(1);
    expect(service.runSync).not.toHaveBeenCalled(); // 30 min < 65 min

    act(() => setVisibility('hidden'));
    await flush(60 * MINUTE); // skrivena kartica: bez periodičnog čitanja
    expect(service.listSyncRuns).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await flush();
    // Poslednja uspešna je sada stara 90 min → automatsko osvežavanje: tiho čitanje pri
    // povratku, sinhronizacija, pa čitanje posle nje.
    expect(service.runSync).toHaveBeenCalledTimes(1);
    expect(service.listSyncRuns).toHaveBeenCalledTimes(3);
    expect(RESUME_RELOAD_MS).toBe(10 * MINUTE);
  });

  it('neuspelo tiho čitanje pri povratku ne pokreće automatsku sinhronizaciju', async () => {
    const service = okService(30);
    service.listSyncRuns.mockImplementationOnce(async () => [syncRun('ok', 'ok', 31, 30)]).mockRejectedValue(new Error('Failed to fetch'));
    holder.service = service;
    renderWith(rayfinAuth);
    await flush();
    act(() => setVisibility('hidden'));
    await flush(60 * MINUTE);
    act(() => setVisibility('visible'));
    await flush();
    expect(service.listSyncRuns).toHaveBeenCalledTimes(2);
    // Podaci su stari 90 min, ali čitanje je palo – sinhronizacija bi pala isto.
    expect(service.runSync).not.toHaveBeenCalled();
  });

  it('tiho čitanje koje donese sinhronizaciju druge sesije ponovo učitava dnevnu statistiku', async () => {
    const service = okService(5);
    const newer = syncRun('other', 'ok', 2, 1);
    service.latestSuccessfulSync.mockImplementationOnce(async () => syncRun('ok', 'ok', 6, 5)).mockImplementation(async () => newer);
    holder.service = service;
    render(
      <MemoryRouter initialEntries={['/?view=pregled']}>
        <AuthProvider authService={auth}>
          <AtmosferaProvider>
            <Probe />
          </AtmosferaProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('|v0');
    await flush(VISIBLE_RELOAD_MS);
    expect(service.latestSuccessfulSync).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('probe')).toHaveTextContent('|v1');
  });

  it('kratko skrivanje ne čita ponovo; dok je vidljiva, čita na svakih 12 min', async () => {
    const service = okService(5);
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => setVisibility('hidden'));
    await flush(2 * MINUTE);
    act(() => setVisibility('visible'));
    await flush();
    expect(service.listSyncRuns).toHaveBeenCalledTimes(1);
    await flush(VISIBLE_RELOAD_MS);
    expect(service.listSyncRuns).toHaveBeenCalledTimes(2);
    expect(service.runSync).not.toHaveBeenCalled(); // demo režim nikad ne sinhronizuje sam
  });

  it('„Osveži“ posle skorašnje sinhronizacije samo ponovo čita bazu', async () => {
    const service = okService(10);
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => screen.getByRole('button', { name: 'osveži' }).click());
    await flush();
    expect(service.runSync).not.toHaveBeenCalled();
    expect(service.listSyncRuns).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('outcome')).toHaveTextContent('ready|info|Osveženo pre 10 min – SEPA objavljuje nova merenja jednom na sat');
  });

  it('„Osveži“ dok druga sesija sinhronizuje ne pokreće drugi posao', async () => {
    const service = okService(90, [syncRun('remote', 'running', 1, null)]);
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => screen.getByRole('button', { name: 'osveži' }).click());
    await flush();
    expect(service.runSync).not.toHaveBeenCalled();
    expect(screen.getByTestId('outcome')).toHaveTextContent('ready|info|Sinhronizacija je već u toku (druga sesija)');
  });

  it('„Osveži“ posle starije sinhronizacije pokreće sinhronizaciju; red iz budućnosti ne smeta', async () => {
    const forged = { ...syncRun('forged', 'running', 0, null), startedAt: '2099-01-01T00:00:00Z' };
    const service = okService(30, [forged], NOW);
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => screen.getByRole('button', { name: 'osveži' }).click());
    await flush();
    expect(service.runSync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('outcome')).toHaveTextContent('ready|ok|Podaci su osveženi');
  });

  it('uspešna sinhronizacija bez novih sati ne kaže „Podaci su osveženi“', async () => {
    // Najnoviji sat u bazi je od pre ~6 h, a sinhronizacija ne donosi ništa novo.
    const service = okService(30, [], new Date(NOW.getTime() - 5 * 60 * MINUTE));
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => screen.getByRole('button', { name: 'osveži' }).click());
    await flush();
    expect(service.runSync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('outcome')).toHaveTextContent('ready|partial|Sinhronizacija je uspela, ali SEPA nema novih merenja');
  });

  it('sinhronizacija koja donese novije, ali i dalje stare sate kaže „SEPA i dalje kasni“', async () => {
    // Pre posla najnoviji sat je od pre ~9 h, posle od pre ~6 h: novi sati jesu stigli.
    const service = okService(30, [], new Date(NOW.getTime() - 8 * 60 * MINUTE));
    const after = buildDemoCore(new Date(NOW.getTime() - 5 * 60 * MINUTE));
    service.listSnapshots.mockImplementation(async () => (service.runSync.mock.calls.length ? after.snapshots : buildDemoCore(new Date(NOW.getTime() - 8 * 60 * MINUTE)).snapshots));
    holder.service = service;
    renderWith(auth);
    await flush();
    act(() => screen.getByRole('button', { name: 'osveži' }).click());
    await flush();
    expect(service.runSync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('outcome')).toHaveTextContent('ready|partial|Osveženo – SEPA i dalje kasni');
  });
});
