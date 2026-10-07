import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncRunRecord } from '@shared/contracts';

import { buildDemoCore } from '@/demo/fixture';
import { rankByLens } from '@/lib/insights';
import { buildStationViews } from '@/lib/stations';
import type { DataService } from '@/services/dataService';
import type { IAuthService } from '@/services/IAuthService';

const holder = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('@/services/dataService', () => ({ createDataService: () => holder.service }));

// Uvoz posle `vi.mock` (hoisting): provider dobija lažni servis.
const { AuthProvider } = await import('@/hooks/AuthContext');
const { AtmosferaProvider, useAtmosfera } = await import('@/hooks/useAtmosfera');
const { LinkNotice } = await import('./LinkNotice');

const NOW = new Date('2026-10-07T09:30:00Z');
const core = buildDemoCore(NOW);
const okRun: SyncRunRecord = {
  id: 'ok',
  kind: 'sync',
  status: 'ok',
  startedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString(),
  finishedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
  windowFrom: new Date(NOW.getTime() - 36 * 3_600_000).toISOString(),
  windowTo: NOW.toISOString(),
  stationsSeen: 26,
  observationsSeen: 900,
  rowsWritten: 26,
  message: null,
};

const auth: IAuthService = {
  mode: 'demo',
  config: { kind: 'demo' },
  canSignIn: true,
  resolveSession: async () => ({ id: 'u', email: 'demo@example.invalid', name: 'Demo' }),
  signIn: async () => ({ id: 'u', email: 'demo@example.invalid', name: 'Demo' }),
  signOut: async () => undefined,
};

function Probe() {
  const location = useLocation();
  const { selected, data } = useAtmosfera();
  return <p data-testid="probe">{`${data.status}|${location.search}|${selected?.id ?? '-'}`}</p>;
}

async function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider authService={auth}>
        <AtmosferaProvider>
          <LinkNotice />
          <Probe />
        </AtmosferaProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function probe() {
  const [status, search, selected] = (screen.getByTestId('probe').textContent ?? '').split('|');
  return { status, params: new URLSearchParams(search), selected };
}

describe('LinkNotice – neispravan link se ne zamenjuje tiho', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Mapa: nepoznata stanica i okrug – poruka, parametri uklonjeni, izabrana najlošija', async () => {
    await renderAt('/?view=mapa&station=does-not-exist&okrug=Nepostojeci');
    const worst = rankByLens(buildStationViews(core.stations, core.snapshots, NOW), 'worst', 1)[0]?.view.id;
    const notice = screen.getByTestId('link-notice');
    expect(notice).toHaveTextContent('Stanica iz linka nije pronađena (možda ju je SEPA ugasila ili joj promenila oznaku) – prikazana je stanica sa najlošijim vazduhom sada.');
    expect(notice).toHaveTextContent('Okrug iz linka („Nepostojeci“) nema stanica u mreži – prikazani su svi okruzi.');
    const { status, params, selected } = probe();
    expect(status).toBe('ready');
    expect(params.get('okrug')).toBeNull();
    expect(params.get('station')).toBe(worst);
    expect(selected).toBe(worst);
    // Ista poruka se ne ponavlja (provera se ponovi posle upisa najlošije stanice).
    expect(notice.querySelectorAll('li')).toHaveLength(2);
  });

  it('nepoznat polutant: poruka i sočivo „Najlošiji“; zatvaranje uklanja poruku', async () => {
    await renderAt('/?view=stanice&lens=CO');
    expect(screen.getByTestId('link-notice')).toHaveTextContent('Polutant iz linka („CO“) se ne prati');
    expect(probe().params.get('lens')).toBeNull();
    expect(probe().params.get('view')).toBe('stanice');
    fireEvent.click(screen.getByRole('button', { name: 'Zatvori obaveštenje o linku' }));
    expect(screen.queryByTestId('link-notice')).toBeNull();
  });

  it('ispravan link: bez poruke, parametri ostaju', async () => {
    const station = core.stations[3];
    await renderAt(`/?view=mapa&station=${station.id}&lens=NO2`);
    expect(screen.queryByTestId('link-notice')).toBeNull();
    const { params, selected } = probe();
    expect(params.get('station')).toBe(station.id);
    expect(params.get('lens')).toBe('NO2');
    expect(selected).toBe(station.id);
  });
});
