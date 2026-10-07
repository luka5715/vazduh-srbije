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
});
