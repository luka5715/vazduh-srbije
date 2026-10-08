import { describe, expect, it } from 'vitest';

import type { SyncRunRecord } from '@shared/contracts';
import { dayUtcRange } from '@shared/time';

import { SYNC_HOURS_BACK } from '@/hooks/useSync';

import {
  ageParts,
  backfillDayMs,
  backfillDayOf,
  backfillEtaText,
  durationExpectation,
  durationScaleMs,
  expectedDurationText,
  expectedSyncDuration,
  freshnessOf,
  groupRunsByDay,
  isStoppedOutcome,
  roughDuration,
  runDurationMs,
  runMessage,
  runMissingStations,
  runStatus,
  runWindowText,
  summarizeRuns,
  syncStateOf,
  syncWindowText,
  UNMEASURED,
} from './runModel';

const NOW = new Date('2026-10-07T10:20:00Z'); // 12:20 u Beogradu
const MIN = 60_000;

function run(partial: Partial<SyncRunRecord> & { id: string }): SyncRunRecord {
  const startedAt = partial.startedAt ?? new Date(NOW.getTime() - 12 * MIN);
  return {
    kind: 'sync',
    status: 'ok',
    startedAt,
    finishedAt: new Date(new Date(startedAt).getTime() + 95_000),
    windowFrom: new Date('2026-10-05T22:00:00Z'),
    windowTo: startedAt,
    stationsSeen: 26,
    observationsSeen: 4518,
    rowsWritten: 287,
    message: null,
    ...partial,
  };
}

describe('runStatus / runDurationMs', () => {
  it('running red stariji od 5 min je napušten i nema trajanje', () => {
    const abandoned = run({ id: 'a', status: 'running', startedAt: new Date(NOW.getTime() - 20 * MIN), finishedAt: null });
    expect(runStatus(abandoned, NOW)).toBe('abandoned');
    expect(runDurationMs(abandoned, 'abandoned')).toBeNull();
  });

  it('svež running red je u toku', () => {
    const running = run({ id: 'r', status: 'running', startedAt: new Date(NOW.getTime() - 2 * MIN), finishedAt: null });
    expect(runStatus(running, NOW)).toBe('running');
    expect(runDurationMs(running, 'running')).toBeNull();
  });

  it('trajanje završenog posla', () => {
    expect(runDurationMs(run({ id: 'ok' }))).toBe(95_000);
  });
});

describe('prozor i poruka', () => {
  it('istorija: ceo dan, poruka „Dan …“ je suvišna', () => {
    const { from, to } = dayUtcRange('2026-10-06');
    const backfill = run({ id: 'b', kind: 'backfill', windowFrom: from, windowTo: to, message: 'Dan 2026-10-06' });
    expect(backfillDayOf(backfill)).toBe('2026-10-06');
    expect(runWindowText(backfill)).toBe('ceo dan 06. 10. 2026.');
    expect(runMessage(backfill, 'ok')).toBeNull();
  });

  it('sinhronizacija: prozor preko dva dana', () => {
    const sync = run({ id: 's', windowFrom: new Date('2026-10-05T22:00:00Z'), windowTo: new Date('2026-10-07T08:10:00Z') });
    expect(runWindowText(sync)).toBe('06. 10. 00:00 – 07. 10. 10:10');
  });

  it('poruka greške ostaje', () => {
    expect(runMessage(run({ id: 'e', status: 'error', message: 'Kosava API: HTTP 503' }), 'error')).toBe('Kosava API: HTTP 503');
  });
});

describe('groupRunsByDay', () => {
  it('Danas / Juče / datum', () => {
    const groups = groupRunsByDay(
      [
        run({ id: '1', startedAt: new Date('2026-10-07T08:00:00Z') }),
        run({ id: '2', startedAt: new Date('2026-10-07T06:00:00Z') }),
        run({ id: '3', startedAt: new Date('2026-10-06T08:00:00Z') }),
        run({ id: '4', startedAt: new Date('2026-10-04T08:00:00Z') }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.runs.length])).toEqual([
      ['Danas', 2],
      ['Juče', 1],
      ['04. 10. 2026.', 1],
    ]);
  });
});

describe('summarizeRuns', () => {
  it('broji statuse i računa prosek samo uspešnih sinhronizacija', () => {
    const runs = [
      run({ id: '1', finishedAt: new Date(NOW.getTime() - 12 * MIN + 60_000) }),
      run({ id: '2', status: 'error' }),
      run({ id: '3', status: 'running', startedAt: new Date(NOW.getTime() - 60 * MIN), finishedAt: null }),
      run({ id: '4', kind: 'backfill', finishedAt: new Date(NOW.getTime() - 12 * MIN + 200_000) }),
      run({ id: '5', finishedAt: new Date(NOW.getTime() - 12 * MIN + 120_000) }),
    ];
    const summary = summarizeRuns(runs, NOW);
    expect(summary).toMatchObject({ total: 5, ok: 3, error: 1, abandoned: 1, running: 0, avgSyncMs: 90_000 });
    expect(summary.statuses).toEqual(['ok', 'ok', 'abandoned', 'error', 'ok']);
    expect(summary.lastOkSync?.id).toBe('1');
  });
});

describe('svežina i stanje', () => {
  it('prag od 65 min', () => {
    expect(freshnessOf(new Date(NOW.getTime() - 12 * MIN), NOW)).toMatchObject({ stale: false });
    expect(freshnessOf(new Date(NOW.getTime() - 66 * MIN), NOW)).toMatchObject({ stale: true, ratio: 1 });
    expect(freshnessOf(null, NOW)).toBeNull();
  });

  it('delovi starosti', () => {
    expect(ageParts(12 * MIN)).toEqual({ value: 12, unit: 'min' });
    expect(ageParts(185 * MIN)).toEqual({ value: 3, unit: 'h' });
    expect(ageParts(3 * 24 * 60 * MIN)).toEqual({ value: 3, unit: 'dana' });
  });

  it('stanje heroja', () => {
    const last = new Date(NOW.getTime() - 12 * MIN);
    expect(syncStateOf('sync', [], null, NOW).kind).toBe('syncing');
    expect(syncStateOf(null, [], null, NOW).kind).toBe('empty');
    expect(syncStateOf(null, [run({ id: '1' })], last, NOW).kind).toBe('fresh');
    expect(syncStateOf(null, [run({ id: '1' })], new Date(NOW.getTime() - 90 * MIN), NOW).kind).toBe('stale');
    // Novija greška posle uspešne → „failed“; starija greška ne menja stanje.
    const failedNewer = run({ id: 'e', status: 'error', startedAt: new Date(NOW.getTime() - 5 * MIN) });
    expect(syncStateOf(null, [failedNewer, run({ id: '1' })], last, NOW).kind).toBe('failed');
    const failedOlder = run({ id: 'e', status: 'error', startedAt: new Date(NOW.getTime() - 130 * MIN) });
    expect(syncStateOf(null, [run({ id: '1' }), failedOlder], last, NOW).kind).toBe('fresh');
    expect(syncStateOf(null, [failedNewer], null, NOW).kind).toBe('never-ok');
    const remote = run({ id: 'r', status: 'running', startedAt: new Date(NOW.getTime() - 1 * MIN), finishedAt: null });
    expect(syncStateOf(null, [remote], last, NOW).kind).toBe('remote-running');
  });
});

describe('delimičan i neispravan posao', () => {
  const warn = 'Stanica 106: HTTP 500 za https://opendata.kosava.cloud/api/v1/observations?station_id=106';

  it('ok posao sa upozorenjem o stanici ili vremenskom limitu je „Delimično“; demo napomena nije', () => {
    expect(runStatus(run({ id: 'p', message: warn }), NOW)).toBe('partial');
    expect(runStatus(run({ id: 'd', message: '3 stanice preskočene – vremenski limit' }), NOW)).toBe('partial');
    expect(runStatus(run({ id: 'demo', message: 'Demo: ništa nije preuzeto sa SEPA.' }), NOW)).toBe('ok');
    expect(runStatus(run({ id: 'b', kind: 'backfill', message: `${warn} | Stanica 7: fetch failed` }), NOW)).toBe('partial');
    // Greška ostaje greška i kad poruka pominje stanicu.
    expect(runStatus(run({ id: 'e', status: 'error', message: warn }), NOW)).toBe('error');
  });

  it('broj stanica bez merenja iz poruke; 5 upozorenja ili skraćena poruka su donja granica', () => {
    expect(runMissingStations(run({ id: 'p', message: `4 stanice preskočene – vremenski limit | ${warn}` }))).toEqual({ count: 5, atLeast: false });
    const five = Array.from({ length: 5 }, (_, i) => `Stanica ${i}: x`).join(' | ');
    expect(runMissingStations(run({ id: 'f', message: five }))).toEqual({ count: 5, atLeast: true });
  });

  it('red iz budućnosti je „Neispravan zapis“, bez trajanja, i ne ulazi u stanje heroja', () => {
    const forged = run({ id: 'x', status: 'running', startedAt: new Date('2099-01-01T00:00:00Z'), finishedAt: null });
    expect(runStatus(forged, NOW)).toBe('invalid');
    expect(runDurationMs(forged, 'invalid')).toBeNull();
    const last = new Date(NOW.getTime() - 12 * MIN);
    expect(syncStateOf(null, [forged, run({ id: '1' })], last, NOW).kind).toBe('fresh');
  });

  it('sažetak broji delimične i neispravne; delimična sinhronizacija je poslednja uspešna', () => {
    const forged = run({ id: 'x', startedAt: new Date('2099-01-01T00:00:00Z') });
    const summary = summarizeRuns([forged, run({ id: 'p', message: warn }), run({ id: 'ok' })], NOW);
    expect(summary).toMatchObject({ total: 3, ok: 1, partial: 1, invalid: 1 });
    expect(summary.lastOkSync?.id).toBe('p');
    expect(summary.statuses).toEqual(['ok', 'partial', 'invalid']);
  });
});

describe('SEPA kasni', () => {
  const last = new Date(NOW.getTime() - 12 * MIN);
  const HOUR = 60 * MIN;

  it('skorašnja sinhronizacija, ali najnoviji sat završen pre više od 3 h → „sepa-late“', () => {
    const fiveHoursAgo = new Date(NOW.getTime() - 5 * HOUR);
    expect(syncStateOf(null, [run({ id: '1' })], last, NOW, fiveHoursAgo)).toEqual({ kind: 'sepa-late', latestObservedAt: fiveHoursAgo });
    // Interval 2 h star počeo je pre 2 h i završio se pre 1 h → uživo.
    expect(syncStateOf(null, [run({ id: '1' })], last, NOW, new Date(NOW.getTime() - 2 * HOUR)).kind).toBe('fresh');
    // Nema merenja u bazi uopšte.
    expect(syncStateOf(null, [run({ id: '1' })], last, NOW, null)).toEqual({ kind: 'sepa-late', latestObservedAt: null });
    // Bez podatka o najnovijem satu (undefined) se kašnjenje izvora ne proverava.
    expect(syncStateOf(null, [run({ id: '1' })], last, NOW).kind).toBe('fresh');
  });

  it('zastarela sopstvena sinhronizacija ima prednost („Podaci kasne“)', () => {
    expect(syncStateOf(null, [run({ id: '1' })], new Date(NOW.getTime() - 90 * MIN), NOW, new Date(NOW.getTime() - 9 * HOUR)).kind).toBe('stale');
  });

  it('zaustavljena istorija je neutralan ishod', () => {
    expect(isStoppedOutcome({ kind: 'backfill', ok: false, tone: 'stopped', title: 'x', at: NOW })).toBe(true);
    expect(isStoppedOutcome({ kind: 'backfill', ok: false, tone: 'error', title: 'x', at: NOW })).toBe(false);
  });
});

describe('očekivano trajanje iz izmerenih poslova (R9)', () => {
  const sync = (id: string, ms: number) => run({ id, finishedAt: new Date(NOW.getTime() - 12 * MIN + ms) });
  const backfill = (id: string, ms: number) => run({ id, kind: 'backfill', finishedAt: new Date(NOW.getTime() - 12 * MIN + ms) });

  it('sažetak računa i prosek dana istorije, odvojeno od sinhronizacija', () => {
    const summary = summarizeRuns([sync('1', 12_000), sync('2', 14_000), backfill('b1', 40_000), run({ id: 'e', status: 'error' })], NOW);
    expect(summary.avgSyncMs).toBe(13_000);
    expect(summary.avgBackfillMs).toBe(40_000);
    expect(summarizeRuns([run({ id: 'e', status: 'error' })], NOW)).toMatchObject({ avgSyncMs: null, avgBackfillMs: null });
  });

  it('grubo zaokruživanje: sekunde, 10 s preko minuta, minuti, sati', () => {
    expect(roughDuration(12_340)).toBe('12 s');
    expect(roughDuration(400)).toBe('1 s');
    expect(roughDuration(91_500)).toBe('1 min 30 s');
    expect(roughDuration(7 * MIN + 20_000)).toBe('7 min');
    expect(roughDuration(70 * MIN)).toBe('1 h 10 min');
    expect(roughDuration(120 * MIN)).toBe('2 h');
  });

  it('izmerena sinhronizacija: „obično oko 12 s · limit 240 s“', () => {
    const expectation = durationExpectation(summarizeRuns([sync('1', 12_000)], NOW));
    expect(expectation).toEqual({ syncMs: 12_000, backfillMs: null });
    expect(expectedSyncDuration(expectation)).toBe('oko 12 s');
    expect(expectedDurationText(expectation)).toBe('obično oko 12 s · limit 240 s');
  });

  it('bez merenja ne izmišlja broj: „ispod minuta“', () => {
    expect(expectedSyncDuration(UNMEASURED)).toBe('ispod minuta');
    expect(expectedDurationText(UNMEASURED)).toBe('obično ispod minuta · limit 240 s');
    expect(backfillEtaText(UNMEASURED, 30)).toBe('obično ispod minuta po danu');
    expect(backfillDayMs(UNMEASURED)).toBeNull();
  });

  it('dnevnik bez sinhronizacije: važi poslednja uspešna iz zasebnog upita', () => {
    const summary = summarizeRuns([backfill('b1', 40_000)], NOW);
    expect(durationExpectation(summary, sync('old', 20_000))).toEqual({ syncMs: 20_000, backfillMs: 40_000 });
    expect(durationExpectation(summary)).toEqual({ syncMs: null, backfillMs: 40_000 });
  });

  it('procena po danu: iz izmerenih dana istorije, inače 24 h od prozora sinhronizacije', () => {
    expect(backfillDayMs({ syncMs: 12_000, backfillMs: 40_000 })).toBe(40_000);
    expect(backfillDayMs({ syncMs: 12_000, backfillMs: null })).toBeCloseTo((12_000 * 24) / SYNC_HOURS_BACK);
    expect(backfillEtaText({ syncMs: null, backfillMs: 40_000 }, 30)).toBe('oko 40 s po danu, ukupno oko 20 min za 30 dana');
    expect(backfillEtaText({ syncMs: null, backfillMs: 40_000 }, 1)).toBe('oko 40 s po danu, ukupno oko 40 s za 1 dan');
    expect(backfillEtaText({ syncMs: null, backfillMs: 40_000 })).toBe('oko 40 s po danu');
    expect(backfillEtaText({ syncMs: null, backfillMs: 40_000 }, 0)).toBe('oko 40 s po danu');
  });

  it('skala trake trajanja: najduži posao u dnevniku, najmanje 60 s; napušteni i u toku ne računaju se', () => {
    expect(durationScaleMs([sync('1', 12_000), sync('2', 30_000)], NOW)).toBe(60_000);
    expect(durationScaleMs([sync('1', 12_000), backfill('b', 142_000)], NOW)).toBe(142_000);
    const abandoned = run({ id: 'a', status: 'running', startedAt: new Date(NOW.getTime() - 20 * MIN), finishedAt: null });
    expect(durationScaleMs([abandoned], NOW)).toBe(60_000);
    expect(durationScaleMs([], NOW)).toBe(60_000);
  });
});

describe('prozor sinhronizacije rečima (R14)', () => {
  it('slaže broj sati: 72 sata, 36 sati, 1 sat; kratko sa „h“', () => {
    expect(syncWindowText(false, 72)).toBe('poslednja 72 sata');
    expect(syncWindowText(false, 36)).toBe('poslednjih 36 sati');
    expect(syncWindowText(false, 1)).toBe('poslednji 1 sat');
    expect(syncWindowText(true, 72)).toBe('poslednja 72 h');
    expect(syncWindowText()).toBe(syncWindowText(false, SYNC_HOURS_BACK));
  });
});
