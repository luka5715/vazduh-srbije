import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyStatRecord } from '@shared/contracts';

import { buildDemoCore } from '@/demo/fixture';
import { formatRelative } from '@/lib/format';
import { buildStationViews, liveStatus } from '@/lib/stations';
import type { DataService } from '@/services/dataService';

import { StationDetail } from './StationDetail';

const NOW = new Date('2026-10-07T09:30:00Z');
const core = buildDemoCore(NOW);
const views = buildStationViews(core.stations, core.snapshots, NOW);
const beograd = views.find((view) => view.station.name.includes('Beograd 1'))!;
const nis = views.find((view) => view.station.name.includes('Niš'))!;

function stat(stationId: string, day: string, maxValue: number): DailyStatRecord {
  return {
    id: `${stationId}-${day}`,
    station_id: stationId,
    parameter: 'PM10',
    day,
    avgValue: maxValue / 2,
    maxValue,
    minValue: 1,
    maxHour: 8,
    hours: 24,
    categoryMax: 1,
    updatedAt: NOW.toISOString(),
  };
}

function service(listDailyStats: DataService['listDailyStats']): DataService {
  return {
    mode: 'demo',
    listStations: vi.fn(async () => []),
    listSnapshots: vi.fn(async () => []),
    listDailyStats,
    listNetworkDailyStats: vi.fn(async () => []),
    listSyncRuns: vi.fn(async () => []),
    latestSuccessfulSync: vi.fn(async () => null),
    runSync: vi.fn(),
    runBackfill: vi.fn(),
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StationDetail', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('zastarela stanica: starost poslednjeg merenja se računa od kraja intervala, isto kao čip ljuske (R5)', async () => {
    // Poslednji sat 02:00–03:00Z (04–05 h lokalno) se završio u 03:00Z: pre 6 h 30 min → „pre 7 h“
    // (zaokruženo); od početka bi bilo 7 h 30 min → „pre 8 h“. Oba mesta (napomena i natpis satnih
    // vrednosti) koriste starost od kraja.
    const observedAt = new Date('2026-10-07T02:00:00Z');
    const stale = { ...beograd, stale: true, observedAt };
    const endBased = liveStatus(observedAt, NOW).ageText;
    const startBased = formatRelative(observedAt, NOW);
    expect(endBased).toBe('pre 7 h');
    expect(startBased).toBe('pre 8 h');
    const { container } = render(<StationDetail view={stale} service={service(vi.fn(async () => []))} dataVersion={0} now={NOW} />);
    await settle();
    const text = container.textContent ?? '';
    expect(text).toContain(`Poslednji podaci: 4–5 h · ${endBased}`);
    expect(text).toContain(`Do poslednjeg merenja (4–5 h, ${endBased}) – zastarele vrednosti.`);
    expect(text).not.toContain(startBased);
  });

  it('neuspelo osvežavanje sa ranijim podacima: napomena i „Pokušaj ponovo“', async () => {
    let calls = 0;
    const list = vi.fn(async (stationId: string) => {
      calls++;
      if (calls === 2) throw new Error('mreža');
      return [stat(stationId, '2026-10-06', 40)];
    });
    const svc = service(list);
    const { rerender } = render(<StationDetail view={beograd} service={svc} dataVersion={0} now={NOW} />);
    await settle();
    expect(screen.queryByText(/Osvežavanje nije uspelo/)).toBeNull();

    rerender(<StationDetail view={beograd} service={svc} dataVersion={1} now={NOW} />);
    await settle();
    // Vreme poslednjeg uspelog čitanja (`useAsyncData.loadedAt`): „… podaci od 14:05“ ili sa datumom.
    expect(screen.getByText(/^Osvežavanje nije uspelo – prikazani su podaci od (\d{2}\. \d{2}\. )?\d{2}:\d{2}\.$/)).toBeInTheDocument();
    expect(screen.queryByText('Dnevna statistika nije učitana')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    await settle();
    expect(screen.queryByText(/Osvežavanje nije uspelo/)).toBeNull();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('posle promene stanice ne prikazuje statistiku prethodne (neuspelo učitavanje = greška)', async () => {
    const list = vi.fn(async (stationId: string) => {
      if (stationId === nis.id) throw new Error('mreža');
      return [stat(stationId, '2026-10-06', 40)];
    });
    const svc = service(list);
    const { rerender } = render(<StationDetail view={beograd} service={svc} dataVersion={0} now={NOW} />);
    await settle();
    rerender(<StationDetail view={nis} service={svc} dataVersion={0} now={NOW} />);
    await settle();
    expect(screen.getByText('Dnevna statistika nije učitana')).toBeInTheDocument();
    expect(screen.queryByText(/Osvežavanje nije uspelo/)).toBeNull();
    expect(screen.queryByText('Vrh')).toBeNull();
  });

  it('stanica van izabranog okruga: napomena sa njenim okrugom i uklanjanjem filtera', async () => {
    const onChange = vi.fn();
    render(
      <StationDetail
        view={beograd}
        service={service(vi.fn(async () => []))}
        dataVersion={0}
        now={NOW}
        scope={{ okrug: 'Nišavski okrug', onChange }}
        myStation={{ mine: false, onToggle: vi.fn() }}
      />,
    );
    await settle();
    expect(screen.getByTestId('outside-okrug')).toHaveTextContent('Van filtera: Nišavski okrug');
    fireEvent.click(screen.getByRole('button', { name: 'Prikaži Grad Beograd' }));
    expect(onChange).toHaveBeenLastCalledWith('Grad Beograd');
    fireEvent.click(screen.getByRole('button', { name: 'Ukloni filter' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Postavi kao moju stanicu' })).toBeInTheDocument();
  });

  it('stanica u izabranom okrugu: bez napomene', async () => {
    render(<StationDetail view={beograd} service={service(vi.fn(async () => []))} dataVersion={0} now={NOW} scope={{ okrug: 'Grad Beograd', onChange: vi.fn() }} />);
    await settle();
    expect(screen.queryByTestId('outside-okrug')).toBeNull();
  });
});
