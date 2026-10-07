import { describe, expect, it } from 'vitest';

import type { Parameter } from '@shared/aqi';
import type { SnapshotSeries, SnapshotValues, StationRecord, StationSnapshotRecord } from '@shared/contracts';

import {
  average24h,
  deltaVs24h,
  dominantCategory,
  dominantDrivers,
  filterByOkrug,
  hazeColor,
  isLens,
  lensDistribution,
  lensLabel,
  lensOf,
  minSlotCoverage,
  networkDelta24h,
  networkHourly,
  okrugAggregates,
  okrugLabel,
  okrugList,
  okrugOf,
  pmIntensity,
  rankByLens,
  resolveLensParameter,
  stationHourMatrix,
  stationsWithoutOkrug,
  thresholdsFor,
  trimLowCoverage,
} from '@/lib/insights';
import {
  concentrationDigits,
  formatConcentration,
  formatDelta,
  formatHourAt,
  formatHourInterval,
  roundConcentration,
  stationsShort,
} from '@/lib/format';
import { activeViews, buildStationViews, computeNetworkKpis, isInactive, liveStatus, type StationView } from '@/lib/stations';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-07T09:30:00Z');
/** Poslednji sat serije (početak) za „normalne“ stanice. */
const LAST = Date.parse('2026-10-07T07:00:00Z');

interface StationSpec {
  id: string;
  name: string;
  municipality?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  active?: boolean;
  /** Vrednosti po polutantu za 24 sata (najstarija prva). */
  series?: Partial<Record<Parameter, Array<number | null>>>;
  /** Pomak poslednjeg sata serije u satima u odnosu na LAST (negativno = kasni). */
  shiftHours?: number;
  /** Kraj serije u apsolutnom vremenu (za zastarele stanice). */
  observedAtMs?: number;
  /** Ručno zadate trenutne vrednosti (podrazumevano poslednja vrednost serije). */
  values?: SnapshotValues;
  category?: number;
  dominant?: Parameter;
  noSnapshot?: boolean;
}

function classifyRank(parameter: Parameter, value: number): number {
  const limits: Record<Parameter, number[]> = {
    SO2: [20, 40, 125, 190, 275],
    PM10: [15, 45, 120, 195, 270],
    O3: [60, 100, 120, 160, 180],
    NO2: [10, 25, 60, 100, 150],
    'PM2.5': [5, 15, 50, 90, 140],
  };
  const index = limits[parameter].findIndex((limit) => value <= limit);
  return index === -1 ? 5 : index;
}

function make(specs: StationSpec[], now: Date = NOW): StationView[] {
  const stations: StationRecord[] = [];
  const snapshots: StationSnapshotRecord[] = [];
  specs.forEach((spec, index) => {
    stations.push({
      id: spec.id,
      sepaId: index + 1,
      code: `S${index + 1}`,
      name: spec.name,
      municipality: spec.municipality ?? null,
      latitude: spec.latitude ?? null,
      longitude: spec.longitude ?? null,
      active: spec.active ?? true,
      updatedAt: NOW.toISOString(),
    });
    if (spec.noSnapshot) return;
    const lastMs = spec.observedAtMs ?? LAST + (spec.shiftHours ?? 0) * HOUR;
    const series: SnapshotSeries = { start: new Date(lastMs - 23 * HOUR).toISOString(), values: spec.series ?? {} };
    let values: SnapshotValues = spec.values ?? {};
    if (!spec.values) {
      for (const [parameter, list] of Object.entries(spec.series ?? {}) as Array<[Parameter, Array<number | null>]>) {
        const last = list[list.length - 1];
        if (typeof last === 'number') {
          values = { ...values, [parameter]: { v: last, t: new Date(lastMs).toISOString(), c: classifyRank(parameter, last) } };
        }
      }
    }
    let category = spec.category ?? 0;
    let dominant: Parameter = spec.dominant ?? 'PM10';
    if (spec.category === undefined) {
      for (const [parameter, entry] of Object.entries(values) as Array<[Parameter, { c: number }]>) {
        if (entry.c >= category) {
          category = entry.c;
          dominant = parameter;
        }
      }
    }
    snapshots.push({
      id: `snap-${spec.id}`,
      station_id: spec.id,
      observedAt: new Date(lastMs).toISOString(),
      category,
      dominant,
      valuesJson: JSON.stringify(values),
      seriesJson: JSON.stringify(series),
      updatedAt: NOW.toISOString(),
    });
  });
  return buildStationViews(stations, snapshots, now);
}

const flat = (value: number | null, length = 24) => Array.from({ length }, () => value);
const ramp = (from: number, to: number) => Array.from({ length: 24 }, (_, i) => from + ((to - from) * i) / 23);

describe('lensOf', () => {
  it('za „worst“ vraća dominantni polutant i ukupnu kategoriju', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: flat(30), NO2: flat(70) } }]);
    const reading = lensOf(view, 'worst');
    expect(reading.parameter).toBe('NO2');
    expect(reading.value).toBe(70);
    expect(reading.category?.rank).toBe(3);
    expect(reading.stale).toBe(false);
  });

  it('za polutant vraća njegovu vrednost i kategoriju iz snimka', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: flat(30), NO2: flat(70) } }]);
    const reading = lensOf(view, 'PM10');
    expect(reading).toMatchObject({ parameter: 'PM10', value: 30, stale: false });
    expect(reading.category?.label).toBe('Prihvatljiv');
  });

  it('nedostajući polutant daje null vrednost i kategoriju', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: flat(30) } }]);
    expect(lensOf(view, 'SO2')).toEqual({ parameter: 'SO2', value: null, category: null, stale: false });
  });

  it('zastarela stanica zadržava poslednju vrednost, ali bez kategorije', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: flat(80) }, observedAtMs: NOW.getTime() - 10 * HOUR }]);
    expect(view.stale).toBe(true);
    const worst = lensOf(view, 'worst');
    expect(worst).toMatchObject({ parameter: 'PM10', value: 80, category: null, stale: true });
    expect(lensOf(view, 'PM10').category).toBeNull();
  });
});

describe('networkHourly', () => {
  it('poravnava serije po apsolutnom satu i računa medijanu i n', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: flat(10) } },
      { id: 'b', name: 'B', series: { PM10: flat(30) } },
      // Kasni sat vremena: njena vrednost za najnoviji sat ne postoji, a 24 h unazad ispada iz prozora.
      { id: 'c', name: 'C', series: { PM10: flat(50) }, shiftHours: -1 },
    ]);
    const slots = networkHourly(views, 'PM10');
    expect(slots).toHaveLength(24);
    expect(slots[23].t.toISOString()).toBe(new Date(LAST).toISOString());
    expect(slots[0].t.toISOString()).toBe(new Date(LAST - 23 * HOUR).toISOString());
    expect(slots[23]).toMatchObject({ median: 20, n: 2 });
    expect(slots[22]).toMatchObject({ median: 30, n: 3 });
    expect(slots[0]).toMatchObject({ median: 30, n: 3 });
  });

  it('isključuje zastarele stanice i null vrednosti', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: [...flat(null, 23), 12] } },
      { id: 'old', name: 'Old', series: { PM10: flat(500) }, observedAtMs: NOW.getTime() - 9 * HOUR },
    ]);
    const slots = networkHourly(views, 'PM10');
    expect(slots[23]).toMatchObject({ median: 12, n: 1 });
    expect(slots[5]).toMatchObject({ median: null, n: 0 });
  });

  it('bez svežih serija vraća prazan niz', () => {
    expect(networkHourly(make([{ id: 'a', name: 'A', noSnapshot: true }]), 'PM10')).toEqual([]);
    expect(networkHourly([], 'PM10')).toEqual([]);
  });

  it('networkDelta24h poredi poslednji i prvi sat sa podatkom', () => {
    const slots = networkHourly(make([{ id: 'a', name: 'A', series: { PM10: ramp(20, 44) } }]), 'PM10');
    const delta = networkDelta24h(slots);
    expect(delta).toMatchObject({ then: 20, now: 44, delta: 24, direction: 'up' });
    expect(networkDelta24h(networkHourly(make([{ id: 'a', name: 'A', series: { PM10: flat(30) } }]), 'PM10'))?.direction).toBe('flat');
    expect(networkDelta24h([])).toBeNull();
  });
});

describe('pokrivenost satova (trimLowCoverage)', () => {
  // Četiri stanice javljaju do 07:00 (~40), jedna je „brža“ i ima i 08:00 (12).
  const lagged = () =>
    make(
      [
        { id: 'a', name: 'A', series: { PM10: flat(40) } },
        { id: 'b', name: 'B', series: { PM10: flat(42) } },
        { id: 'c', name: 'C', series: { PM10: flat(38) } },
        { id: 'd', name: 'D', series: { PM10: flat(41) } },
        { id: 'e', name: 'E', series: { PM10: flat(12) }, shiftHours: 1 },
      ],
      new Date('2026-10-07T08:20:00Z'),
    );

  it('najnoviji sat sa jednom stanicom ne određuje promenu ni kraj sparkline-a', () => {
    const views = lagged();
    const kpis = computeNetworkKpis(views);
    expect(kpis.medianPm10).toBe(40);
    const slots = networkHourly(views, 'PM10');
    // Sirovo: poslednji sat (08:00) ima samo stanicu E.
    expect(slots[23]).toMatchObject({ median: 12, n: 1 });
    expect(minSlotCoverage(slots)).toBe(3);

    const delta = networkDelta24h(slots);
    expect(delta?.now).toBe(40);
    expect(delta?.then).toBe(40);

    const trimmed = trimLowCoverage(slots);
    expect(trimmed[23]).toMatchObject({ median: null, n: 1 });
    expect(trimmed[22].t.toISOString()).toBe('2026-10-07T07:00:00.000Z');
    expect(trimmed[22].median).toBe(40);
    const finite = trimmed.map((slot) => slot.median).filter((value): value is number => value !== null);
    expect(finite[finite.length - 1]).toBe(40);
    // Najstariji sat (07:00 juče) ima samo četiri spore stanice – pokriven je.
    expect(trimmed[0].median).not.toBeNull();
  });

  it('kad sve stanice kasne isto, ništa se ne menja', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: ramp(20, 44) } },
      { id: 'b', name: 'B', series: { PM10: ramp(22, 46) } },
      { id: 'c', name: 'C', series: { PM10: ramp(18, 42) } },
    ]);
    const slots = networkHourly(views, 'PM10');
    expect(trimLowCoverage(slots)).toEqual(slots);
    expect(networkDelta24h(slots)).toMatchObject({ then: 20, now: 44, delta: 24, direction: 'up' });
  });

  it('jedna stanica u prozoru (okrug sa jednom stanicom) i dalje ima seriju', () => {
    const slots = networkHourly(make([{ id: 'a', name: 'A', series: { PM10: ramp(20, 44) } }]), 'PM10');
    expect(minSlotCoverage(slots)).toBe(1);
    expect(trimLowCoverage(slots)).toEqual(slots);
  });

  it('unutrašnje rupe ostaju, menjaju se samo krajevi', () => {
    const slots = networkHourly(
      make([
        { id: 'a', name: 'A', series: { PM10: [12, ...flat(30, 22), 50] } },
        { id: 'b', name: 'B', series: { PM10: [null, ...flat(32, 22), null] } },
        { id: 'c', name: 'C', series: { PM10: [null, ...flat(34, 10), ...flat(null, 2), ...flat(34, 10), null] } },
      ]),
      'PM10',
    );
    const trimmed = trimLowCoverage(slots);
    expect(trimmed[0].median).toBeNull();
    expect(trimmed[23].median).toBeNull();
    expect(trimmed[11]).toEqual(slots[11]);
    expect(trimmed[12]).toEqual(slots[12]);
    expect(trimLowCoverage(trimmed)).toEqual(trimmed);
  });
});

describe('stationHourMatrix', () => {
  const views = make([
    { id: 'clean', name: 'Čista', series: { PM10: flat(10), NO2: flat(5) } },
    { id: 'dirty', name: 'Prljava', series: { PM10: flat(150), NO2: flat(20) } },
    { id: 'mid', name: 'Srednja', series: { PM10: flat(60) } },
    { id: 'old', name: 'Stara', series: { PM10: flat(300) }, observedAtMs: NOW.getTime() - 12 * HOUR },
  ]);

  it('redovi su sveže stanice, najlošije prve, sa tačno 24 ćelije', () => {
    const matrix = stationHourMatrix(views, 'worst');
    expect(matrix.hours).toHaveLength(24);
    expect(matrix.rows.map((row) => row.id)).toEqual(['dirty', 'mid', 'clean']);
    for (const row of matrix.rows) expect(row.cells).toHaveLength(24);
  });

  it('za „worst“ ćelija nosi najgoru kategoriju svih polutanata u tom satu', () => {
    const matrix = stationHourMatrix(views, 'worst');
    const clean = matrix.rows.find((row) => row.id === 'clean')!;
    // PM10 10 → Dobar (0), NO2 5 → Dobar (0); dominantni je onaj bliži pragu.
    expect(clean.cells[23].category?.rank).toBe(0);
    const dirty = matrix.rows.find((row) => row.id === 'dirty')!;
    expect(dirty.cells[0]).toMatchObject({ value: 150, parameter: 'PM10' });
    expect(dirty.cells[0].category?.rank).toBe(3);
  });

  it('za polutant ćelija nosi njegovu vrednost; stanica koja ga ne meri se ne prikazuje', () => {
    const matrix = stationHourMatrix(views, 'NO2');
    expect(matrix.rows.find((row) => row.id === 'mid')).toBeUndefined();
    expect(matrix.missing).toBe(1);
    expect(matrix.rows[0].id).toBe('dirty');
    expect(matrix.rows[0].cells[23]).toMatchObject({ value: 20, parameter: 'NO2' });
  });

  it('stanica bez O3 se izostavlja za sočivo O3 i broji u missing; „worst“ zadržava sve', () => {
    const mixed = make([
      { id: 'o3', name: 'Sa ozonom', series: { PM10: flat(20), O3: flat(80) } },
      { id: 'nO3', name: 'Bez ozona', series: { PM10: flat(30) } },
      { id: 'gap', name: 'Ozon sa rupom', series: { O3: [...flat(null, 20), 70, 72, null, null] } },
    ]);
    const o3 = stationHourMatrix(mixed, 'O3');
    expect(o3.rows.map((row) => row.id).sort()).toEqual(['gap', 'o3']);
    expect(o3.missing).toBe(1);
    const worst = stationHourMatrix(mixed, 'worst');
    expect(worst.rows).toHaveLength(3);
    expect(worst.missing).toBe(0);
  });
});

describe('okruzi', () => {
  const views = make([
    { id: 'bg1', name: 'Beograd 1', municipality: 'Beograd', series: { PM10: flat(40) } },
    { id: 'bg2', name: 'Beograd 2', municipality: 'Novi Beograd', series: { PM10: ramp(10, 60) } },
    { id: 'ni', name: 'Niš', municipality: 'Niš', series: { PM10: flat(90) } },
    { id: 'xx', name: 'Nepoznata', municipality: 'Atlantida', series: { PM10: flat(20) } },
    { id: 'gps', name: 'Sa koordinatama', municipality: 'Niš', latitude: 43.3, longitude: 21.9, series: { PM10: flat(30) } },
  ]);

  it('okrugOf koristi opštinu i za stanice sa koordinatama', () => {
    const byId = Object.fromEntries(views.map((view) => [view.id, view]));
    expect(okrugOf(byId.bg1)).toBe('Grad Beograd');
    expect(okrugOf(byId.ni)).toBe('Nišavski okrug');
    expect(okrugOf(byId.gps)).toBe('Nišavski okrug');
    expect(okrugOf(byId.xx)).toBeNull();
  });

  it('okrugList i filterByOkrug', () => {
    expect(okrugList(views)).toEqual(['Grad Beograd', 'Nišavski okrug']);
    expect(filterByOkrug(views, 'Nišavski okrug').map((view) => view.id).sort()).toEqual(['gps', 'ni']);
    expect(filterByOkrug(views, null)).toBe(views);
  });

  it('okrugLabel dodaje „okrug“ samo kad nedostaje', () => {
    expect(okrugLabel('Sremski')).toBe('Sremski okrug');
    expect(okrugLabel('Nišavski okrug')).toBe('Nišavski okrug');
    expect(okrugLabel('Grad Beograd')).toBe('Grad Beograd');
  });

  it('okrugAggregates: medijana sada i medijana 24-časovnih proseka, sortirano po sada', () => {
    const aggregates = okrugAggregates(views, 'PM10');
    expect(aggregates.map((a) => a.okrug)).toEqual(['Nišavski okrug', 'Grad Beograd']);
    const beograd = aggregates.find((a) => a.okrug === 'Grad Beograd')!;
    expect(beograd).toMatchObject({ stations: 2, total: 2, nowMedian: 50, parameter: 'PM10' });
    // Proseci: 40 i 35 → medijana 37,5.
    expect(beograd.avg24Median).toBeCloseTo(37.5, 5);
    expect(beograd.worstCategory?.rank).toBe(2);
    expect(okrugAggregates(views, 'worst')[0].parameter).toBe('PM10');
  });

  it('grad podeljen na gradske opštine (Kragujevac) ipak dobija okrug', () => {
    const [kg] = make([{ id: 'kg', name: 'Kragujevac 1', municipality: 'Kragujevac', series: { PM10: flat(20) } }]);
    expect(okrugOf(kg)).toBe('Šumadijski okrug');
    expect(stationsWithoutOkrug([kg])).toBe(0);
  });

  it('stanice bez okruga se broje (samo aktivne)', () => {
    expect(stationsWithoutOkrug(views)).toBe(1);
    const withRetired = make([
      { id: 'xx', name: 'Nepoznata', municipality: 'Atlantida', series: { PM10: flat(20) } },
      { id: 'yy', name: 'Ugašena', municipality: 'Atlantida', active: false, series: { PM10: flat(20) } },
      { id: 'ni', name: 'Niš', municipality: 'Niš', series: { PM10: flat(90) } },
    ]);
    expect(stationsWithoutOkrug(withRetired)).toBe(1);
  });

  it('neaktivne stanice nisu deo uzorka okruga', () => {
    const withRetired = make([
      { id: 'ni', name: 'Niš', municipality: 'Niš', series: { PM10: flat(90) } },
      { id: 'ni-old', name: 'Niš stara', municipality: 'Niš', active: false, series: { PM10: flat(10) } },
    ]);
    expect(okrugAggregates(withRetired, 'PM10')[0]).toMatchObject({ okrug: 'Nišavski okrug', stations: 1, total: 1, nowMedian: 90 });
  });
});

describe('neaktivne stanice i brojanje mreže', () => {
  it('neaktivna stanica nije u ukupnom broju, u „bez svežih podataka“ ni u prstenu', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: flat(30) } },
      { id: 'b', name: 'B', series: { PM10: flat(130) } },
      { id: 'old', name: 'Old', series: { PM10: flat(50) }, observedAtMs: NOW.getTime() - 7 * HOUR },
      { id: 'gone', name: 'Ugašena', active: false, series: { PM10: flat(300) }, observedAtMs: NOW.getTime() - 400 * HOUR },
      { id: 'none', name: 'Bez snimka', noSnapshot: true },
    ]);
    const kpis = computeNetworkKpis(views);
    expect(kpis).toMatchObject({ reporting: 2, total: 4, stale: 2, inactive: 1 });
    // Ukupno = javljaju + bez svežih podataka (stanica bez snimka je takođe bez svežih podataka).
    expect(kpis.reporting + kpis.stale).toBe(kpis.total);
    expect(kpis.countsByCategory.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(isInactive(views.find((view) => view.id === 'gone')!)).toBe(true);
    expect(activeViews(views).map((view) => view.id)).not.toContain('gone');
    expect(activeViews(views)).toHaveLength(4);
  });
});

describe('raspodela kroz sočivo i polutanti koji određuju kategoriju', () => {
  const views = make([
    { id: 'a', name: 'A', series: { NO2: flat(40), SO2: flat(10) } },
    { id: 'b', name: 'B', series: { NO2: flat(45), PM10: flat(30) } },
    { id: 'c', name: 'C', series: { 'PM2.5': flat(30), SO2: flat(30) } },
    { id: 'd', name: 'D', series: { PM10: flat(140) } },
    { id: 'old', name: 'Old', series: { NO2: flat(50), SO2: flat(200) }, observedAtMs: NOW.getTime() - 7 * HOUR },
  ]);

  it('lensDistribution broji sveže stanice po kategoriji polutanta i one bez vrednosti', () => {
    expect(lensDistribution(views, 'SO2')).toEqual({ counts: [1, 1, 0, 0, 0, 0], reporting: 2, missing: 2 });
    expect(lensDistribution(views, 'worst')).toEqual({ counts: [0, 0, 3, 1, 0, 0], reporting: 4, missing: 0 });
  });

  it('dominantDrivers: dominantni polutanti svežih stanica u kategoriji, najčešći prvi', () => {
    expect(dominantDrivers(views, 2)).toEqual({
      stations: 3,
      drivers: [
        { parameter: 'NO2', count: 2 },
        { parameter: 'PM2.5', count: 1 },
      ],
    });
    expect(dominantDrivers(views, 3)).toEqual({ stations: 1, drivers: [{ parameter: 'PM10', count: 1 }] });
    expect(dominantDrivers(views, 5)).toEqual({ stations: 0, drivers: [] });
  });
});

describe('format: koncentracije, promene, sati', () => {
  it('jedna decimala ispod 100, ceo broj od 100 (isto na svim stranicama)', () => {
    expect(formatConcentration(57.46)).toBe('57,5');
    expect(formatConcentration(8)).toBe('8');
    expect(formatConcentration(8, { fixed: true })).toBe('8,0');
    expect(formatConcentration(161.4)).toBe('161');
    // Zaokruživanje na prag sakrilo bi prelazak (O₃ „Zagađen“ je ≤ 160): decimala ostaje.
    expect(formatConcentration(160.4)).toBe('160,4');
    expect(formatConcentration(120.3)).toBe('120,3');
    expect(formatConcentration(119.6)).toBe('119,6');
    expect(formatConcentration(120)).toBe('120');
    expect(formatConcentration(124.6)).toBe('124,6');
    expect(formatConcentration(99.96)).toBe('100');
    expect(formatConcentration(99.96, { fixed: true })).toBe('100');
    expect(formatConcentration(1234.5)).toBe('1.235');
    expect(formatConcentration(null)).toBe('–');
    expect(concentrationDigits(99.94)).toBe(1);
    expect(roundConcentration(57.46)).toBe(57.5);
    expect(roundConcentration(161.4)).toBe(161);
    expect(roundConcentration(160.4)).toBe(160.4);
  });

  it('iznos promene i kratak broj stanica', () => {
    expect(formatDelta(-4.36)).toBe('4,4');
    expect(formatDelta(12.4)).toBe('12');
    expect(formatDelta(9.96)).toBe('10');
    expect(stationsShort(1)).toBe('1 st.');
  });

  it('satni interval po Beogradu, ponoć je kraj dana', () => {
    expect(formatHourInterval(new Date('2026-10-07T14:00:00Z'))).toBe('16–17 h');
    expect(formatHourInterval(new Date('2026-10-07T21:00:00Z'))).toBe('23–24 h');
    expect(formatHourInterval(null)).toBe('–');
    // Sat merenja sa datumom samo kad nije današnji (godina samo iz druge godine).
    expect(formatHourAt(new Date('2026-10-07T05:00:00Z'), NOW)).toBe('7–8 h');
    expect(formatHourAt(new Date('2026-10-04T20:00:00Z'), NOW)).toBe('04. 10. 22–23 h');
    expect(formatHourAt(new Date('2025-12-30T20:00:00Z'), NOW)).toBe('30. 12. 2025. 21–22 h');
    expect(formatHourAt(null, NOW)).toBe('–');
  });
});

describe('liveStatus', () => {
  const hour = new Date('2026-10-07T14:00:00Z'); // 16–17 h po Beogradu

  it('uživo dok se interval nije završio pre više od 3 h; uvek sa starošću', () => {
    expect(liveStatus(hour, new Date('2026-10-07T16:40:00Z'))).toEqual({ live: true, label: '16–17 h', ageText: 'pre 3 h' });
    expect(liveStatus(hour, new Date('2026-10-07T18:00:00Z')).live).toBe(true);
    expect(liveStatus(hour, new Date('2026-10-07T18:01:00Z')).live).toBe(false);
  });

  it('sat iz prethodnog dana nosi datum; bez merenja nema „uživo“', () => {
    expect(liveStatus(hour, new Date('2026-10-08T01:00:00Z'))).toEqual({ live: false, label: '07. 10. 16–17 h', ageText: 'pre 11 h' });
    expect(liveStatus(null, new Date())).toEqual({ live: false, label: '–', ageText: '' });
  });
});

describe('deltaVs24h i average24h', () => {
  it('poredi trenutnu vrednost sa sopstvenim prosekom', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: ramp(10, 56) } }]);
    expect(average24h(view, 'PM10')).toBeCloseTo(33, 5);
    const delta = deltaVs24h(view, 'PM10')!;
    expect(delta.current).toBe(56);
    expect(delta.delta).toBeCloseTo(23, 5);
    expect(delta.direction).toBe('up');
  });

  it('premalo sati ili nedostajući polutant daju null', () => {
    const [view] = make([{ id: 'a', name: 'A', series: { PM10: [...flat(null, 20), 1, 2, 3, 4] } }]);
    expect(average24h(view, 'PM10')).toBeNull();
    expect(deltaVs24h(view, 'PM10')).toBeNull();
    expect(deltaVs24h(view, 'O3')).toBeNull();
  });
});

describe('dominantCategory', () => {
  it('najčešća kategorija svežih stanica, nerešeno → lošija', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: flat(30) } },
      { id: 'b', name: 'B', series: { PM10: flat(30) } },
      { id: 'c', name: 'C', series: { PM10: flat(60) } },
      { id: 'd', name: 'D', series: { PM10: flat(60) } },
      { id: 'e', name: 'E', series: { PM10: flat(5) } },
      { id: 'old', name: 'Old', series: { PM10: flat(10) }, observedAtMs: NOW.getTime() - 8 * HOUR },
    ]);
    expect(dominantCategory(views)).toBe(2);
    expect(dominantCategory(views.slice(0, 3))).toBe(1);
    expect(dominantCategory([])).toBeNull();
    expect(hazeColor(2)).toBe('var(--glow-2)');
    expect(hazeColor(null)).toBe('var(--accent)');
  });
});

describe('rankByLens', () => {
  it('rangira sveže stanice po kategoriji pa po odnosu prema pragu', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: flat(100) } },
      { id: 'b', name: 'B', series: { PM10: flat(110) } },
      { id: 'c', name: 'C', series: { PM10: flat(20), NO2: flat(70) } },
      { id: 'old', name: 'Old', series: { PM10: flat(400) }, observedAtMs: NOW.getTime() - 8 * HOUR },
    ]);
    expect(rankByLens(views, 'worst').map((r) => r.view.id)).toEqual(['c', 'b', 'a']);
    expect(rankByLens(views, 'PM10', 2).map((r) => r.view.id)).toEqual(['b', 'a']);
    expect(rankByLens(views, 'SO2')).toEqual([]);
  });
});

describe('pragovi, sočiva i čestice', () => {
  it('thresholdsFor prati SEPA satne pragove', () => {
    const pm10 = thresholdsFor('PM10');
    expect(pm10.limits).toEqual([15, 45, 120, 195, 270]);
    expect(pm10.displayMax).toBe(195);
    expect(pm10.bands).toHaveLength(6);
    expect(pm10.bands[0]).toMatchObject({ rank: 0, from: 0, to: 15 });
    expect(pm10.bands[2]).toMatchObject({ rank: 2, from: 45, to: 120, label: 'Umeren' });
    expect(pm10.bands[5].from).toBe(270);
  });

  it('pmIntensity je monotona, ograničena na [0,12; 1], sa podrazumevanom vrednošću', () => {
    expect(pmIntensity(null)).toBe(0.2);
    expect(pmIntensity(Number.NaN)).toBe(0.2);
    expect(pmIntensity(0)).toBeCloseTo(0.12, 5);
    expect(pmIntensity(15)).toBeCloseTo(0.25, 5);
    expect(pmIntensity(45)).toBeCloseTo(0.45, 5);
    expect(pmIntensity(270)).toBe(1);
    expect(pmIntensity(5000)).toBe(1);
    let previous = 0;
    for (let value = 0; value <= 300; value += 5) {
      const next = pmIntensity(value);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  it('sočiva', () => {
    expect(lensLabel('worst')).toBe('Najlošiji');
    expect(lensLabel('NO2')).toBe('NO₂');
    expect(isLens('PM2.5')).toBe(true);
    expect(isLens('CO')).toBe(false);
    expect(resolveLensParameter('worst')).toBe('PM10');
    expect(resolveLensParameter('O3')).toBe('O3');
  });

  it('KPI i uvidi isključuju iste zastarele stanice', () => {
    const views = make([
      { id: 'a', name: 'A', series: { PM10: flat(30) } },
      { id: 'old', name: 'Old', series: { PM10: flat(300) }, observedAtMs: NOW.getTime() - 7 * HOUR },
    ]);
    const kpis = computeNetworkKpis(views);
    expect(kpis.reporting).toBe(1);
    expect(stationHourMatrix(views, 'PM10').rows).toHaveLength(1);
    expect(rankByLens(views, 'PM10')).toHaveLength(1);
  });
});
