import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SyncRunRecord } from '@shared/contracts';

import { RunTable, RunTimeline } from './RunLog';
import { ABANDONED_NOTE, INVALID_NOTE } from './runModel';

const NOW = new Date('2026-10-07T10:20:00Z');
const MIN = 60_000;

const runs: SyncRunRecord[] = [
  {
    id: 'abandoned',
    kind: 'sync',
    status: 'running',
    startedAt: new Date(NOW.getTime() - 20 * MIN),
    finishedAt: null,
    windowFrom: new Date('2026-10-05T22:00:00Z'),
    windowTo: new Date(NOW.getTime() - 20 * MIN),
    stationsSeen: 0,
    observationsSeen: 0,
    rowsWritten: 0,
    message: null,
  },
  {
    id: 'error',
    kind: 'sync',
    status: 'error',
    startedAt: new Date(NOW.getTime() - 130 * MIN),
    finishedAt: new Date(NOW.getTime() - 129 * MIN),
    windowFrom: new Date('2026-10-05T22:00:00Z'),
    windowTo: new Date(NOW.getTime() - 130 * MIN),
    stationsSeen: 26,
    observationsSeen: 0,
    rowsWritten: 26,
    message: 'Kosava API: HTTP 503 Service Unavailable',
  },
];

describe('RunTimeline', () => {
  it('napušten red ima status rečju i objašnjenje, greška ima naslov i sirovu poruku', () => {
    render(<RunTimeline runs={runs} now={NOW} />);
    expect(screen.getByText('Prekinuto bez završetka')).toBeInTheDocument();
    expect(screen.getByText(ABANDONED_NOTE)).toBeInTheDocument();
    expect(screen.getByText('Greška')).toBeInTheDocument();
    expect(screen.getByText('SEPA/Kosava API nije vratio podatke')).toBeInTheDocument();
    expect(screen.getByText('Kosava API: HTTP 503 Service Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Danas')).toBeInTheDocument();
  });
});

describe('RunTable', () => {
  it('tabelarni blizanac ima red za svaki posao i objašnjenje napuštenog reda', () => {
    render(<RunTable runs={runs} now={NOW} />);
    expect(screen.getAllByRole('row')).toHaveLength(runs.length + 1);
    expect(screen.getByText(ABANDONED_NOTE)).toBeInTheDocument();
  });
});

describe('delimičan i neispravan posao u dnevniku', () => {
  const extra: SyncRunRecord[] = [
    {
      ...runs[1],
      id: 'partial',
      status: 'ok',
      message: '2 stanice preskočene – vremenski limit | Stanica 106: HTTP 500',
    },
    {
      ...runs[1],
      id: 'forged',
      status: 'running',
      startedAt: new Date('2099-01-01T00:00:00Z'),
      finishedAt: null,
      message: null,
    },
  ];

  it('vremenska linija: „Delimično“ sa brojem stanica bez merenja i „Neispravan zapis“ sa objašnjenjem', () => {
    render(<RunTimeline runs={extra} now={NOW} />);
    expect(screen.getByText('Delimično')).toBeInTheDocument();
    expect(screen.getByText('3 stanice bez novih merenja')).toBeInTheDocument();
    expect(screen.getByText('Neispravan zapis')).toBeInTheDocument();
    expect(screen.getByText(INVALID_NOTE)).toBeInTheDocument();
    // Vreme iz budućnosti se ne prikazuje kao „upravo sada“.
    expect(screen.queryByText(/upravo sada/)).toBeNull();
  });

  it('tabela: neispravan red nosi objašnjenje umesto poruke', () => {
    render(<RunTable runs={extra} now={NOW} />);
    expect(screen.getByText(INVALID_NOTE)).toBeInTheDocument();
    expect(screen.getByText('Delimično')).toBeInTheDocument();
  });

  it('„Delimično“ samo zbog neupisanih redova (R1): razlog je prolazna greška baze, ne „0 stanica bez novih merenja“', () => {
    const unwritten: SyncRunRecord = { ...runs[1], id: 'unwritten', status: 'ok', message: '3 reda nisu upisana u bazu' };
    render(<RunTimeline runs={[unwritten]} now={NOW} />);
    expect(screen.getByText('Delimično')).toBeInTheDocument();
    expect(screen.getByText(/prolazna greška baze; sledeća sinhronizacija ih piše ponovo/)).toBeInTheDocument();
    expect(screen.getAllByText('3 reda nisu upisana u bazu').length).toBeGreaterThan(0);
    expect(screen.queryByText(/bez novih merenja/)).toBeNull();
  });

  it('„Delimično“ sa stanicama i neupisanim redovima navodi oba razloga', () => {
    const both: SyncRunRecord = { ...runs[1], id: 'both', status: 'ok', message: 'Stanica 106: HTTP 500 | 1 red nije upisan u bazu' };
    render(<RunTimeline runs={[both]} now={NOW} />);
    expect(screen.getByText('1 stanica bez novih merenja')).toBeInTheDocument();
    expect(screen.getByText(/Uz to 1 red nije upisan u bazu – prolazna greška baze/)).toBeInTheDocument();
  });
});

describe('traka trajanja prema najdužem poslu u dnevniku (R11)', () => {
  const ok = (id: string, ms: number, kind: 'sync' | 'backfill' = 'sync'): SyncRunRecord => ({
    ...runs[1],
    id,
    kind,
    status: 'ok',
    finishedAt: new Date(new Date(runs[1].startedAt).getTime() + ms),
    message: null,
  });

  it('brzi poslovi se razlikuju: skala je najmanje 60 s, pa je 12 s petina, a 30 s polovina trake', () => {
    render(<RunTimeline runs={[ok('q1', 12_000), ok('q2', 30_000)]} now={NOW} />);
    const bars = screen.getAllByTestId('duration-bar');
    expect(bars.map((bar) => bar.dataset.ratio)).toEqual(['0.200', '0.500']);
    // Kraj staze nosi skalu, ne limit funkcije.
    expect(screen.getAllByText('1 min')).toHaveLength(2);
    expect(screen.queryByText('240 s')).toBeNull();
  });

  it('sporiji dan istorije širi skalu; napušten posao ostaje puna traka', () => {
    render(<RunTimeline runs={[ok('s', 12_000), ok('b', 142_000, 'backfill'), runs[0]]} now={NOW} />);
    const bars = screen.getAllByTestId('duration-bar');
    expect(bars.map((bar) => bar.dataset.ratio)).toEqual(['0.085', '1.000', '1.000']);
    expect(screen.getAllByText('2 min 22 s').length).toBeGreaterThanOrEqual(3);
  });
});
