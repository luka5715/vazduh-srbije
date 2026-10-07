import { describe, expect, it } from 'vitest';

import type { Parameter } from '@shared/aqi';
import type { DailyStatRecord } from '@shared/contracts';

import type { StationView } from '@/lib/stations';

import {
  calendarMatrix,
  calendarSentence,
  dailyMedianSeries,
  dayLengthHours,
  dayWorstRanks,
  dumbbellLensNote,
  dumbbellScale,
  isCoveredStat,
  lastComplete,
  minCoveredHours,
  notLoadedDays,
  pollutedComparison,
  pollutedInsight,
  pollutedSentence,
  roundAxisMax,
  scopeDailyStats,
  scopedDayCounts,
  stationDayCells,
  trendSummary,
  trendWindow,
  weekOverWeek,
  worstStationOnDay,
} from './trendData';

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07'];
const TODAY = '2026-10-07';

function stat(
  station: string,
  day: string,
  parameter: Parameter,
  categoryMax: number,
  maxValue: number,
  avgValue = maxValue / 2,
  hours = day === TODAY ? 10 : 24,
): DailyStatRecord {
  return {
    id: `${station}-${parameter}-${day}`,
    station_id: station,
    parameter,
    day,
    avgValue,
    maxValue,
    minValue: 0,
    maxHour: 20,
    hours,
    categoryMax,
    updatedAt: `${day}T23:00:00Z`,
  };
}

/** Red brojeva po danu (za testove sažetaka). */
function counts(day: string, values: number[], short = 0) {
  return { day, counts: values, total: values.reduce((sum, value) => sum + value, 0), short };
}

function view(id: string, name: string): StationView {
  return { id, station: { name } } as unknown as StationView;
}

describe('trendWindow', () => {
  it('daje 30 dana zaključno sa današnjim (Beograd)', () => {
    // 22:30 UTC 6. 10. je već 7. 10. u Beogradu.
    const window = trendWindow(new Date('2026-10-06T22:30:00Z'));
    expect(window.today).toBe('2026-10-07');
    expect(window.days).toHaveLength(30);
    expect(window.days[0]).toBe('2026-09-08');
    expect(window.fromDay).toBe('2026-09-08');
    expect(window.days[29]).toBe('2026-10-07');
  });

  it('daje 30 završenih dana za poređenje 15 + 15 (od dana pre prozora do juče)', () => {
    const window = trendWindow(new Date('2026-10-06T22:30:00Z'));
    expect(window.compareDays).toHaveLength(30);
    expect(window.compareDays[0]).toBe('2026-09-07');
    expect(window.compareDays[29]).toBe('2026-10-06');
  });
});

describe('pokrivenost dana stanice (≥ 75 % sati)', () => {
  it('dužina lokalnog dana prati prelazak na letnje/zimsko vreme', () => {
    expect(dayLengthHours('2026-10-06')).toBe(24);
    expect(dayLengthHours('2026-03-29')).toBe(23);
    expect(dayLengthHours('2026-10-25')).toBe(25);
  });

  it('prag je 18 h (24 i 23 h), a 19 h na dan od 25 h', () => {
    expect(minCoveredHours('2026-10-06')).toBe(18);
    expect(minCoveredHours('2026-03-29')).toBe(18);
    expect(minCoveredHours('2026-10-25')).toBe(19);
    expect(isCoveredStat({ day: '2026-10-06', hours: 18 })).toBe(true);
    expect(isCoveredStat({ day: '2026-10-06', hours: 17 })).toBe(false);
    expect(isCoveredStat({ day: '2026-03-29', hours: 17 })).toBe(false);
    expect(isCoveredStat({ day: '2026-10-25', hours: 18 })).toBe(false);
    expect(isCoveredStat({ day: '2026-10-25', hours: 19 })).toBe(true);
  });
});

describe('scopeDailyStats / scopedDayCounts', () => {
  const stats = [stat('a', DAYS[0], 'PM10', 2, 60), stat('a', DAYS[0], 'SO2', 4, 200), stat('b', DAYS[0], 'PM10', 1, 30)];

  it('filtrira po stanicama i polutantu sočiva', () => {
    expect(scopeDailyStats(stats, null, 'worst')).toHaveLength(3);
    expect(scopeDailyStats(stats, null, 'PM10')).toHaveLength(2);
    expect(scopeDailyStats(stats, new Set(['b']), 'worst')).toHaveLength(1);
  });

  it('za „Najlošiji“ stanica dobija najgoru kategoriju svih polutanata, za polutant samo njegovu', () => {
    expect(scopedDayCounts(stats, DAYS, null, 'worst')[0].counts).toEqual([0, 1, 0, 0, 1, 0]);
    expect(scopedDayCounts(stats, DAYS, null, 'PM10')[0].counts).toEqual([0, 1, 1, 0, 0, 0]);
    expect(scopedDayCounts(stats, DAYS, null, 'PM10')[1].total).toBe(0);
  });

  it('kraći dan stanice (< 18 h) ne ulazi u kategorije, nego u `short`; današnji dan se broji ceo', () => {
    const mixed = [
      stat('a', DAYS[0], 'PM10', 1, 30),
      stat('b', DAYS[0], 'PM10', 4, 250, 100, 5), // 5 h – kraći dan
      stat('c', DAYS[0], 'PM10', 0, 10, 5, 12),
      stat('c', DAYS[0], 'NO2', 3, 80, 40, 20), // pokriven drugi polutant – stanica se broji
      stat('a', TODAY, 'PM10', 3, 70, 30, 4), // danas: nepotpun, ali se prikazuje
    ];
    const rows = scopedDayCounts(mixed, DAYS, null, 'worst', TODAY);
    expect(rows[0]).toEqual({ day: DAYS[0], counts: [0, 1, 0, 1, 0, 0], total: 2, short: 1 });
    expect(rows[2]).toEqual({ day: TODAY, counts: [0, 0, 0, 1, 0, 0], total: 1, short: 0 });
    // Kroz sočivo PM10: a pokriven, b (5 h) i c (PM10 12 h) kraći.
    expect(scopedDayCounts(mixed, DAYS, null, 'PM10', TODAY)[0]).toMatchObject({ total: 1, short: 2 });
  });
});

describe('trendSummary', () => {
  it('ne računa današnji dan i bira dan sa najvećim udelom „Zagađen“ ili lošije', () => {
    const rows = [
      { day: DAYS[0], counts: [0, 2, 1, 1, 0, 0], total: 4 },
      { day: DAYS[1], counts: [0, 1, 0, 0, 1, 0], total: 2 },
      { day: DAYS[2], counts: [0, 0, 0, 0, 0, 3], total: 3 },
    ];
    const summary = trendSummary(rows, TODAY);
    expect(summary.completeDays).toBe(2);
    expect(summary.alertDays).toBe(2);
    expect(summary.worst).toEqual({ day: DAYS[1], count: 1, total: 2, share: 0.5 });
  });

  it('bez lošeg dana vraća worst = null i broji isključene kraće dane', () => {
    const summary = trendSummary([counts(DAYS[0], [1, 0, 0, 0, 0, 0], 2), counts(TODAY, [0, 0, 0, 1, 0, 0], 4)], TODAY);
    expect(summary).toEqual({ completeDays: 1, alertDays: 0, worst: null, shortStationDays: 2 });
  });

  it('dan samo sa kraćim danima stanica nije završen dan sa podacima', () => {
    const summary = trendSummary([counts(DAYS[0], [0, 0, 0, 0, 0, 0], 3), counts(DAYS[1], [0, 1, 0, 1, 0, 0])], TODAY);
    expect(summary.completeDays).toBe(1);
    expect(summary.worst).toEqual({ day: DAYS[1], count: 1, total: 2, share: 0.5 });
  });
});

describe('pollutedComparison – udeo dana stanica „Zagađen“ ili lošije', () => {
  const days = Array.from({ length: 31 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`.replace('2026-09-31', '2026-10-01'));
  const today = days[30];

  it('poredi poslednjih 15 završenih dana sa prethodnih 15 (udeo stanica-dana, ne broj dana)', () => {
    // Prethodnih 15: 1 od 10 stanica zagađena svaki dan (10 %); poslednjih 15: 3 od 10 (30 %).
    const rows = days.map((day, i) => (i < 15 ? counts(day, [5, 4, 0, 1, 0, 0]) : i < 30 ? counts(day, [3, 2, 2, 2, 1, 0], 1) : counts(day, [0, 0, 0, 9, 0, 0])));
    const result = pollutedComparison(rows, today);
    expect(result.recent).toMatchObject({ from: days[15], to: days[29], days: 15, daysWithData: 15, stationDays: 150, polluted: 45 });
    expect(result.recent.share).toBeCloseTo(0.3);
    expect(result.previous).toMatchObject({ from: days[0], to: days[14], stationDays: 150, polluted: 15 });
    expect(result.previous.share).toBeCloseTo(0.1);
    expect(result.delta).toBeCloseTo(0.2);
    expect(result.daily).toHaveLength(30);
    expect(result.daily[29]).toEqual({ day: days[29], share: 0.3, total: 10, short: 1 });
  });

  it('bez dovoljno dana u prethodnom periodu nema poređenja; dan bez podataka ima share null', () => {
    const rows = days.map((day, i) => (i < 10 ? counts(day, [0, 0, 0, 0, 0, 0]) : counts(day, [1, 0, 0, 1, 0, 0])));
    const result = pollutedComparison(rows, today);
    expect(result.previous.daysWithData).toBe(5);
    expect(result.delta).toBeNull();
    expect(result.recent.share).toBe(0.5);
    expect(result.daily[0].share).toBeNull();
  });

  it('prazni podaci daju null udele', () => {
    const result = pollutedComparison([], today);
    expect(result.recent.share).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.daily).toEqual([]);
  });
});

describe('pollutedInsight / pollutedSentence – rečenica „Trend mreže“', () => {
  it('juče i prosek dnevnih udela završenih dana sa podacima (bez današnjeg)', () => {
    const rows = [counts(DAYS[0], [3, 0, 0, 1, 0, 0]), counts(DAYS[1], [1, 0, 0, 0, 1, 0], 2), counts(TODAY, [0, 0, 0, 0, 0, 4])];
    const insight = pollutedInsight(rows, TODAY);
    expect(insight).toEqual({ latest: { day: DAYS[1], share: 0.5, count: 1, total: 2 }, average: 0.375, days: 2 });
    expect(pollutedSentence(insight, TODAY, 'Zagađen')).toBe('Udeo stanica „Zagađen“ ili lošije: juče 50 %, prosek 2 završena dana 38 %.');
  });

  it('kad juče nema pokrivenih podataka, navodi poslednji dan sa podacima', () => {
    const rows = [counts(DAYS[0], [1, 0, 0, 1, 0, 0]), counts(DAYS[1], [0, 0, 0, 0, 0, 0], 3), counts(TODAY, [1, 0, 0, 0, 0, 0])];
    expect(pollutedSentence(pollutedInsight(rows, TODAY), TODAY, 'Zagađen')).toBe(
      'Udeo stanica „Zagađen“ ili lošije: poslednji dan sa podacima (05. 10.) 50 %.',
    );
    expect(pollutedSentence(pollutedInsight([counts(TODAY, [1, 0, 0, 0, 0, 0])], TODAY), TODAY, 'Zagađen')).toBeNull();
  });
});

describe('stationDayCells', () => {
  it('za „Najlošiji“ bira lošiju kategoriju, a pri istoj kategoriji polutant bliži pragu', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 2, 100), // 100/120 = 0,83
      stat('a', DAYS[0], 'NO2', 2, 58), // 58/60 = 0,97 → pobeđuje
      stat('a', DAYS[1], 'PM10', 3, 150),
      stat('a', DAYS[1], 'O3', 1, 90),
    ];
    const cells = stationDayCells(stats, DAYS, 'worst').get('a')!;
    expect(cells[0]).toMatchObject({ parameter: 'NO2', rank: 2, value: 58, short: false });
    expect(cells[1]).toMatchObject({ parameter: 'PM10', rank: 3, value: 150 });
    expect(cells[2]).toMatchObject({ rank: null, value: null, short: false });
  });

  it('pokriven red pobeđuje lošiji kraći red; dan samo sa kraćim redovima je `short`', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 1, 30),
      stat('a', DAYS[0], 'SO2', 5, 400, 200, 3), // spajk iz 3 sata – ne određuje dan
      stat('a', DAYS[1], 'PM10', 3, 150, 80, 6),
      stat('a', TODAY, 'PM10', 2, 60, 30, 4), // danas – nije „kraći“, kolona je nepotpuna
    ];
    const cells = stationDayCells(stats, DAYS, 'worst', TODAY).get('a')!;
    expect(cells[0]).toMatchObject({ parameter: 'PM10', rank: 1, short: false });
    expect(cells[1]).toMatchObject({ parameter: 'PM10', rank: 3, short: true, hours: 6 });
    expect(cells[2]).toMatchObject({ rank: 2, short: false });
  });

  it('za polutant uzima samo njega', () => {
    const stats = [stat('a', DAYS[0], 'PM10', 2, 100), stat('a', DAYS[0], 'SO2', 5, 400)];
    expect(stationDayCells(stats, DAYS, 'PM10').get('a')![0]).toMatchObject({ parameter: 'PM10', rank: 2 });
    expect(stationDayCells(stats, DAYS, 'O3').size).toBe(0);
  });
});

describe('calendarMatrix', () => {
  it('sortira po broju loših dana, pa po prosečnoj kategoriji, i broji stanice bez podataka', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 2, 60),
      stat('a', DAYS[1], 'PM10', 2, 60),
      stat('b', DAYS[0], 'PM10', 3, 150),
      stat('b', DAYS[1], 'PM10', 0, 10),
      stat('c', DAYS[0], 'PM10', 1, 30),
    ];
    const matrix = calendarMatrix(stats, DAYS, [view('a', 'Aleksinac'), view('b', 'Bor'), view('c', 'Čačak'), view('d', 'Doljevac')], 'worst', TODAY);
    expect(matrix.rows.map((row) => row.id)).toEqual(['b', 'a', 'c']);
    expect(matrix.rows[0]).toMatchObject({ alertDays: 1, daysWithData: 2, shortDays: 0 });
    expect(matrix.missing).toBe(1);
    expect(calendarSentence(matrix.rows, 'Zagađen')).toBe(
      '1 stanica je imala bar jedan dan u kategoriji „Zagađen“ ili lošijoj; najviše Bor (1 od 2 pokrivena dana).',
    );
  });

  it('kraći i današnji dani se prikazuju, ali ne broje ni ne utiču na redosled', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 4, 250, 120, 4), // kraći dan „Veoma zagađen“
      stat('a', DAYS[1], 'PM10', 1, 30),
      stat('a', TODAY, 'PM10', 5, 500, 200, 8), // danas
      stat('b', DAYS[0], 'PM10', 2, 60),
      stat('b', DAYS[1], 'PM10', 2, 60),
    ];
    const matrix = calendarMatrix(stats, DAYS, [view('a', 'A'), view('b', 'B')], 'worst', TODAY);
    expect(matrix.rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(matrix.rows[1]).toMatchObject({ alertDays: 0, daysWithData: 1, shortDays: 1, meanRank: 1 });
    expect(matrix.rows[1].cells[0]).toMatchObject({ rank: 4, short: true });
    // Stanica samo sa kraćim danima ostaje u matrici (šrafirano), bez proseka.
    const onlyShort = calendarMatrix([stat('c', DAYS[0], 'PM10', 3, 90, 50, 2)], DAYS, [view('c', 'C')], 'worst', TODAY);
    expect(onlyShort.rows[0]).toMatchObject({ daysWithData: 0, meanRank: null, shortDays: 1 });
    expect(onlyShort.missing).toBe(0);
  });

  it('rečenica kad nijedna stanica nije imala loš dan', () => {
    const matrix = calendarMatrix([stat('a', DAYS[0], 'PM10', 1, 30)], DAYS, [view('a', 'A')], 'worst');
    expect(calendarSentence(matrix.rows, 'Zagađen')).toBe('Nijedna stanica nije imala završen dan u kategoriji „Zagađen“ ili lošijoj.');
    expect(calendarSentence([], 'Zagađen')).toBeNull();
  });
});

describe('dumbbellScale', () => {
  it('zaokružuje kraj ose i ostavlja pragove unutar ose', () => {
    const scale = dumbbellScale('PM10', [45, 38, null, 12]);
    expect(scale.max).toBe(60);
    expect(scale.thresholds).toEqual([
      { value: 15, rank: 0 },
      { value: 45, rank: 1 },
    ]);
    expect(scale.bands).toEqual([
      { rank: 0, from: 0, to: 15 },
      { rank: 1, from: 15, to: 45 },
      { rank: 2, from: 45, to: 60 },
    ]);
  });

  it('završava osu na bliskom SEPA pragu', () => {
    expect(dumbbellScale('PM10', [98.4, 40]).max).toBe(120);
  });

  it('uvek prikazuje bar prvi prag', () => {
    const scale = dumbbellScale('NO2', [3, 4]);
    expect(scale.max).toBeGreaterThan(10);
    expect(scale.thresholds[0]).toEqual({ value: 10, rank: 0 });
  });

  it('roundAxisMax koristi korake 2/5/10/25/50', () => {
    expect(roundAxisMax(13)).toBe(14);
    expect(roundAxisMax(41)).toBe(45);
    expect(roundAxisMax(101)).toBe(110);
    expect(roundAxisMax(260)).toBe(275);
    expect(roundAxisMax(780)).toBe(800);
  });

  it('napomena o PM10 samo za „Najlošiji“, bez tvrdnje o najčešćem polutantu', () => {
    expect(dumbbellLensNote('worst', 'PM10')).toBe('Za sočivo „Najlošiji“ okruzi se porede po PM10; izaberite polutant za drugi prikaz.');
    expect(dumbbellLensNote('worst', 'PM10')).not.toContain('najčešć');
    expect(dumbbellLensNote('NO2', 'NO2')).toBeNull();
  });
});

describe('sažetak po danima', () => {
  it('dayWorstRanks daje najvišu kategoriju dana ili null', () => {
    expect(
      dayWorstRanks([
        { day: DAYS[0], counts: [1, 0, 2, 0, 0, 0], total: 3 },
        { day: DAYS[1], counts: [0, 0, 0, 0, 0, 0], total: 0 },
      ]),
    ).toEqual([2, null]);
  });

  it('weekOverWeek poredi poslednjih 7 završenih dana sa prethodnih 7 (bez današnjeg)', () => {
    const days = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const series = [...Array.from({ length: 7 }, () => 10), ...Array.from({ length: 7 }, () => 16), 99];
    expect(weekOverWeek(series, days, days[14])).toEqual({ last: 16, previous: 10, delta: 6 });
    expect(weekOverWeek(series.slice(-6), days.slice(-6), days[14])).toBeNull();
    expect(lastComplete(series, days, days[14])).toEqual({ value: 16, day: days[13] });
  });

  it('dailyMedianSeries daje medijanu dnevnih proseka po danu (samo pokriveni dani stanica)', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 1, 40, 20),
      stat('b', DAYS[0], 'PM10', 1, 40, 30),
      stat('c', DAYS[0], 'PM10', 1, 40, 100),
      stat('d', DAYS[0], 'PM10', 1, 40, 900, 3), // prosek iz 3 sata se ne računa
    ];
    expect(dailyMedianSeries(stats, DAYS, 'PM10')).toEqual([30, null, null]);
  });

  it('worstStationOnDay bira najlošiju stanicu dana u opsegu (bez kraćih dana)', () => {
    const stats = [
      stat('a', DAYS[0], 'PM10', 2, 100),
      stat('b', DAYS[0], 'SO2', 4, 250),
      stat('b', DAYS[1], 'SO2', 5, 400),
      stat('c', DAYS[0], 'SO2', 5, 900, 300, 2),
    ];
    expect(worstStationOnDay(stats, DAYS[0], null, 'worst')).toEqual({ stationId: 'b', parameter: 'SO2', value: 250, rank: 4 });
    expect(worstStationOnDay(stats, DAYS[0], new Set(['a']), 'worst')?.stationId).toBe('a');
    expect(worstStationOnDay(stats, DAYS[0], null, 'O3')).toBeNull();
  });
});

describe('notLoadedDays – dan bez ijednog reda u bazi', () => {
  it('prošli dan bez ijednog reda (cela mreža) je „nije učitano“; današnji dan nikad', () => {
    const stats = [stat('a', DAYS[1], 'PM10', 1, 30)];
    expect([...notLoadedDays(stats, DAYS, TODAY)]).toEqual([DAYS[0]]);
    // Jedan red bilo koje stanice i polutanta znači da je dan učitan.
    expect([...notLoadedDays([...stats, stat('b', DAYS[0], 'SO2', 0, 5)], DAYS, TODAY)]).toEqual([]);
    expect([...notLoadedDays([], DAYS, TODAY)]).toEqual([DAYS[0], DAYS[1]]);
  });
});
