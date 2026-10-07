import { describe, expect, it } from 'vitest';

import { classify, type Parameter } from '@shared/aqi';
import type { SnapshotValues, StationRecord, StationSnapshotRecord } from '@shared/contracts';

import { buildStationViews, type StationView } from '@/lib/stations';

import {
  bandLimits,
  bandsFor,
  buildStationRows,
  DEFAULT_SORT,
  deltaText,
  encodeGroup,
  encodeSort,
  formatLastSeen,
  formatValue,
  groupCounts,
  groupLabel,
  nextSort,
  isStaleGroup,
  okrugShort,
  parseGroup,
  parseSort,
  scalePosition,
  searchRows,
  sortRows,
  statusSummary,
  type StationRow,
} from './stationRows';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-07T09:30:00Z');
const LAST = Date.parse('2026-10-07T08:00:00Z');

interface Spec {
  id: string;
  name: string;
  municipality?: string | null;
  code?: string;
  series?: Partial<Record<Parameter, Array<number | null>>>;
  /** Pomak poslednjeg sata u satima (negativno = kasni). */
  shiftHours?: number;
  /** Zastarela stanica (poslednje merenje pre 3 dana). */
  stale?: boolean;
  latitude?: number | null;
  /** SEPA je stanicu označila kao neaktivnu (`active = false`). */
  inactive?: boolean;
}

const flat = (value: number | null, length = 24) => Array.from({ length }, () => value);
const ramp = (from: number, to: number) => Array.from({ length: 24 }, (_, i) => from + ((to - from) * i) / 23);

function make(specs: Spec[]): StationView[] {
  const stations: StationRecord[] = [];
  const snapshots: StationSnapshotRecord[] = [];
  specs.forEach((spec, index) => {
    stations.push({
      id: spec.id,
      sepaId: index + 1,
      code: spec.code ?? `S${index + 1}`,
      name: spec.name,
      municipality: spec.municipality ?? null,
      latitude: spec.latitude ?? null,
      longitude: spec.latitude === undefined || spec.latitude === null ? null : 20.5,
      active: !spec.inactive,
      updatedAt: NOW.toISOString(),
    });
    const lastMs = spec.stale ? LAST - 72 * HOUR : LAST + (spec.shiftHours ?? 0) * HOUR;
    let values: SnapshotValues = {};
    let category = 0;
    let dominant: Parameter = 'PM10';
    for (const [parameter, list] of Object.entries(spec.series ?? {}) as Array<[Parameter, Array<number | null>]>) {
      const last = list[list.length - 1];
      if (typeof last !== 'number') continue;
      const c = classify(parameter, last);
      values = { ...values, [parameter]: { v: last, t: new Date(lastMs).toISOString(), c } };
      if (c >= category) {
        category = c;
        dominant = parameter;
      }
    }
    snapshots.push({
      id: `snap-${spec.id}`,
      station_id: spec.id,
      observedAt: new Date(lastMs).toISOString(),
      category,
      dominant,
      valuesJson: JSON.stringify(values),
      seriesJson: JSON.stringify({ start: new Date(lastMs - 23 * HOUR).toISOString(), values: spec.series ?? {} }),
      updatedAt: NOW.toISOString(),
    });
  });
  return buildStationViews(stations, snapshots, NOW);
}

const names = (rows: StationRow[]) => rows.map((row) => row.view.station.name);

const VIEWS = make([
  { id: 'nis', name: 'Niš IZJZ', municipality: 'Niš', series: { PM10: ramp(20, 60), NO2: flat(20) } },
  { id: 'cacak', name: 'Čačak', municipality: 'Čačak', series: { PM10: flat(30), NO2: flat(40) } },
  { id: 'bor', name: 'Bor Gradski park', municipality: 'Bor', series: { PM10: flat(10), SO2: ramp(200, 130) }, latitude: 44.07 },
  { id: 'kikinda', name: 'Kikinda', municipality: 'Kikinda', series: { PM10: flat(12) }, shiftHours: -3 },
  { id: 'pirot', name: 'Pirot', municipality: 'Pirot', series: { PM10: flat(14), O3: flat(50) }, stale: true },
]);
const LATEST = new Date(LAST);

describe('buildStationRows', () => {
  it('čita sočivo, grupu, kašnjenje i promenu prema proseku 24 h', () => {
    const rows = buildStationRows(VIEWS, 'worst', LATEST);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.nis.reading.parameter).toBe('PM10');
    expect(byId.nis.group).toBe(2);
    expect(byId.nis.delta?.direction).toBe('up');
    expect(byId.nis.series).toHaveLength(24);
    expect(byId.cacak.reading.parameter).toBe('NO2');
    expect(byId.kikinda.lagHours).toBe(3);
    expect(byId.nis.lagHours).toBe(0);
    expect(byId.pirot.group).toBe('stale');
    expect(byId.pirot.delta).toBeNull();
    expect(byId.pirot.series).toBeNull();
    expect(byId.pirot.severity).toBeNull();
  });

  it('polutant koji stanica ne meri daje grupu „none“', () => {
    const rows = buildStationRows(VIEWS, 'SO2', LATEST);
    expect(rows.find((row) => row.id === 'nis')?.group).toBe('none');
    expect(rows.find((row) => row.id === 'bor')?.group).toBe(3);
  });
});

describe('groupCounts', () => {
  it('broji redom kategorija, pa bez vrednosti, pa bez svežih', () => {
    const counts = groupCounts(buildStationRows(VIEWS, 'SO2', LATEST));
    expect(counts.map((entry) => entry.group)).toEqual([3, 'none', 'stale']);
    expect(counts.find((entry) => entry.group === 'none')?.count).toBe(3);
    expect(groupLabel('stale')).toBe('Bez svežih podataka');
    expect(groupLabel(1)).toBe('Prihvatljiv');
  });
});

describe('searchRows', () => {
  const rows = buildStationRows(VIEWS, 'worst', LATEST);

  it('ne zavisi od dijakritika i traži i po šifri i okrugu', () => {
    expect(names(searchRows(rows, 'cacak').rows)).toEqual(['Čačak']);
    expect(names(searchRows(rows, 'NIS').rows)).toEqual(['Niš IZJZ']);
    expect(names(searchRows(rows, 's3').rows)).toEqual(['Bor Gradski park']);
    expect(names(searchRows(rows, 'borski').rows)).toEqual(['Bor Gradski park']);
  });

  it('rasuta poklapanja samo kad nema pravih', () => {
    const result = searchRows(rows, 'bgp');
    expect(result.loose).toBe(true);
    expect(names(result.rows)).toContain('Bor Gradski park');
    expect(searchRows(rows, 'qqq').rows).toHaveLength(0);
    expect(searchRows(rows, '  ').rows).toHaveLength(rows.length);
  });
});

describe('sortRows', () => {
  const rows = buildStationRows(VIEWS, 'worst', LATEST);

  it('kroz sočivo: najlošije prvo, zastarele uvek na kraju', () => {
    expect(names(sortRows(rows, { key: 'lens', dir: 'desc' }))).toEqual(['Bor Gradski park', 'Čačak', 'Niš IZJZ', 'Kikinda', 'Pirot']);
    expect(names(sortRows(rows, { key: 'lens', dir: 'asc' })).at(-1)).toBe('Pirot');
  });

  it('po polutantu: bez vrednosti posle izmerenih, zastarele poslednje', () => {
    const sorted = names(sortRows(rows, { key: 'NO2', dir: 'asc' }));
    expect(sorted.slice(0, 2)).toEqual(['Niš IZJZ', 'Čačak']);
    expect(sorted.at(-1)).toBe('Pirot');
  });

  it('po nazivu: srpski abecedni red (Č posle C)', () => {
    expect(names(sortRows(rows, { key: 'name', dir: 'asc' }))).toEqual(['Bor Gradski park', 'Čačak', 'Kikinda', 'Niš IZJZ', 'Pirot']);
  });

  it('po promeni: najveći rast prvi', () => {
    expect(names(sortRows(rows, { key: 'delta', dir: 'desc' }))[0]).toBe('Niš IZJZ');
  });

  it('nextSort menja smer iste kolone i počinje prirodnim smerom nove', () => {
    expect(nextSort({ key: 'lens', dir: 'desc' }, 'lens')).toEqual({ key: 'lens', dir: 'asc' });
    expect(nextSort({ key: 'lens', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'PM10')).toEqual({ key: 'PM10', dir: 'desc' });
  });
});

describe('SEPA skala', () => {
  it('jednaki pojasevi: granica kategorije pada na crticu', () => {
    expect(scalePosition('PM10', 15, 4).position).toBeCloseTo(0.25);
    expect(scalePosition('PM10', 45, 4).position).toBeCloseTo(0.5);
    expect(scalePosition('PM10', 30, 4).position).toBeCloseTo(0.375);
    expect(scalePosition('NO2', 25, 4).position).toBeCloseTo(0.5);
  });

  it('vrednost iznad poslednjeg pojasa puni traku i označava prekoračenje', () => {
    expect(scalePosition('PM10', 400, 4)).toEqual({ position: 1, overflow: true });
    expect(scalePosition('PM10', 0, 4)).toEqual({ position: 0, overflow: false });
  });

  it('broj pojaseva prati najgoru prisutnu kategoriju (4–6)', () => {
    const rows = buildStationRows(VIEWS, 'worst', LATEST);
    expect(bandsFor(rows)).toBe(5);
    expect(bandsFor([])).toBe(4);
    expect(bandLimits('PM10', 4)).toEqual([15, 45, 120]);
  });
});

describe('tekstovi', () => {
  it('promena prema proseku rečima', () => {
    expect(deltaText({ current: 60, avg24: 40, delta: 20, ratio: 1.5, direction: 'up' })).toEqual({
      arrow: '↑',
      amount: '20',
      words: 'iznad proseka',
      direction: 'up',
    });
    expect(deltaText({ current: 30, avg24: 32.5, delta: -2.5, ratio: 0.9, direction: 'down' }).amount).toBe('2,5');
    expect(deltaText({ current: 30, avg24: 30.2, delta: -0.2, ratio: 1, direction: 'flat' })).toMatchObject({ arrow: '→', amount: null });
  });

  it('vrednosti sa stalnom decimalom i kratak datum poslednjeg merenja', () => {
    expect(formatValue(8)).toBe('8,0');
    expect(formatValue(45.46)).toBe('45,5');
    expect(formatValue(123.4)).toBe('123');
    expect(formatValue(null)).toBe('–');
    expect(formatLastSeen(new Date('2026-10-04T10:00:00Z'))).toBe('04. 10. 12–13 h');
  });

  it('kratak naziv okruga i sažetak statusa', () => {
    expect(okrugShort('Nišavski okrug')).toBe('Nišavski');
    expect(okrugShort('Sremski')).toBe('Sremski');
    expect(okrugShort('Grad Beograd')).toBe('Grad Beograd');
    const summary = statusSummary(buildStationRows(VIEWS, 'worst', LATEST));
    expect(summary).toEqual({ total: 5, fresh: 4, lagging: 1, stale: 1, inactive: 0, approximate: 4 });
  });
});

describe('neaktivne stanice', () => {
  const WITH_INACTIVE = make([
    { id: 'nis', name: 'Niš IZJZ', municipality: 'Niš', series: { PM10: flat(30) } },
    { id: 'pirot', name: 'Pirot', municipality: 'Pirot', series: { PM10: flat(14) }, stale: true },
    { id: 'old', name: 'Aleksinac (ugašena)', municipality: 'Aleksinac', series: { PM10: flat(90) }, inactive: true },
  ]);

  it('imaju svoju grupu, posle zastarelih, i nikad kategoriju', () => {
    const rows = buildStationRows(WITH_INACTIVE, 'worst', LATEST);
    const old = rows.find((row) => row.id === 'old');
    expect(old?.group).toBe('inactive');
    expect(old?.reading.category).toBeNull();
    expect(old?.severity).toBeNull();
    expect(isStaleGroup('inactive')).toBe(true);
    expect(isStaleGroup('stale')).toBe(true);
    expect(isStaleGroup('none')).toBe(false);
    expect(isStaleGroup(0)).toBe(false);
    expect(groupCounts(rows).map((entry) => entry.group)).toEqual([1, 'stale', 'inactive']);
    expect(groupLabel('inactive')).toBe('Neaktivne');
  });

  it('su poslednje u svakom redosledu po broju (i obrnutom), ali abecedno po nazivu', () => {
    const rows = buildStationRows(WITH_INACTIVE, 'worst', LATEST);
    expect(names(sortRows(rows, { key: 'lens', dir: 'desc' }))).toEqual(['Niš IZJZ', 'Pirot', 'Aleksinac (ugašena)']);
    expect(names(sortRows(rows, { key: 'lens', dir: 'asc' }))).toEqual(['Niš IZJZ', 'Pirot', 'Aleksinac (ugašena)']);
    expect(names(sortRows(rows, { key: 'PM10', dir: 'desc' }))).toEqual(['Niš IZJZ', 'Pirot', 'Aleksinac (ugašena)']);
    expect(names(sortRows(rows, { key: 'name', dir: 'asc' }))[0]).toBe('Aleksinac (ugašena)');
  });

  it('se u statusu broje posebno – nisu ni sveže ni „bez svežih podataka“', () => {
    const summary = statusSummary(buildStationRows(WITH_INACTIVE, 'worst', LATEST));
    expect(summary).toMatchObject({ total: 3, fresh: 1, stale: 1, inactive: 1, lagging: 0 });
  });
});

describe('parametri URL-a (grupa, redosled)', () => {
  it('grupa: čitljiva vrednost u oba smera, nepoznata se zanemaruje', () => {
    expect(encodeGroup(2)).toBe('umeren');
    expect(encodeGroup(4)).toBe('veoma-zagadjen');
    expect(encodeGroup('none')).toBe('bez-vrednosti');
    expect(encodeGroup('stale')).toBe('bez-svezih');
    expect(encodeGroup('inactive')).toBe('neaktivne');
    for (const group of [0, 1, 2, 3, 4, 5, 'none', 'stale', 'inactive'] as const) expect(parseGroup(encodeGroup(group))).toBe(group);
    expect(parseGroup('Umeren')).toBe(2);
    expect(parseGroup('2')).toBeNull();
    expect(parseGroup('')).toBeNull();
    expect(parseGroup(null)).toBeNull();
  });

  it('redosled: podrazumevani bez parametra, ostali `ključ-smer` (i PM2.5)', () => {
    expect(encodeSort(DEFAULT_SORT)).toBeNull();
    expect(encodeSort({ key: 'lens', dir: 'asc' })).toBe('lens-asc');
    expect(encodeSort({ key: 'name', dir: 'asc' })).toBe('name-asc');
    expect(encodeSort({ key: 'PM2.5', dir: 'desc' })).toBe('PM2.5-desc');
    expect(parseSort('PM2.5-desc')).toEqual({ key: 'PM2.5', dir: 'desc' });
    expect(parseSort('delta-asc')).toEqual({ key: 'delta', dir: 'asc' });
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort('CO-desc')).toEqual(DEFAULT_SORT);
    expect(parseSort('name-up')).toEqual(DEFAULT_SORT);
    expect(parseSort('-asc')).toEqual(DEFAULT_SORT);
    expect(parseSort('name')).toEqual(DEFAULT_SORT);
  });
});
