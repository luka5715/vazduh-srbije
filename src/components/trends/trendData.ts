/**
 * Čiste funkcije stranice Trendovi (bez React-a i bez I/O): prozor od 30 dana, dnevna
 * statistika kroz sočivo polutanta i filter okruga, matrica stanica × dani za „Kalendar“,
 * sažeci (rečenice) i skala „dumbbell“ prikaza okruga.
 *
 * Dnevna kategorija (`categoryMax`) je kategorija NAJVIŠE satne vrednosti polutanta tog
 * dana. Za sočivo „Najlošiji“ dan stanice dobija najgoru kategoriju svih njenih polutanata.
 *
 * Pravilo pokrivenosti: dan stanice (red dnevne statistike) je „pokriven“ kad ima satna
 * merenja za bar 75 % sati lokalnog dana (18 od 24 h; 18 od 23 h i 19 od 25 h na dane
 * prelaska na letnje/zimsko vreme). Kraći dan se prikazuje šrafiran („nepotpun dan“) i NE
 * ulazi u brojeve, udele, „Najlošiji dan“ ni medijane. Današnji dan je uvek nepotpun.
 */

import { PARAMETER_LABELS, THRESHOLDS_1H, type CategoryRank, type Parameter } from '@shared/aqi';
import type { DailyStatRecord } from '@shared/contracts';
import { addDays, daysBetween, todayLocal } from '@shared/time';

import { isCoveredStat } from '@/lib/coverage';
import type { DayCategoryCounts } from '@/components/charts/NetworkTrendChart';
import { formatDayShort, formatInt, formatPercent, pluralSr } from '@/lib/format';
import { lensLabel, type Lens } from '@/lib/insights';
import { median } from '@/lib/scale';
import type { StationView } from '@/lib/stations';

/** Dužina prozora trenda (API čuva 30 dana; današnji dan je deo prozora i nepotpun je). */
export const TREND_DAYS = 30;

/** Dužina perioda poređenja udela „Zagađen“ ili lošije: poslednjih 15 završenih dana prema prethodnih 15. */
export const COMPARE_DAYS = 15;

/** Prag „lošeg dana“ u sažecima: kategorija „Zagađen“ (3) ili lošija. */
export const ALERT_RANK: CategoryRank = 3;

export interface TrendWindow {
  /** Današnji lokalni dan (Europe/Belgrade), `YYYY-MM-DD`. */
  today: string;
  /** Prvi dan prozora (uključivo). */
  fromDay: string;
  /** Svi dani prozora, najstariji prvi; poslednji je `today`. */
  days: string[];
  /**
   * Završeni dani za poređenje dva perioda od `COMPARE_DAYS` (juče i 2 × 15 − 1 dana pre toga),
   * najstariji prvi. Počinju dan pre prozora, pa se dnevna statistika učitava od `compareDays[0]`.
   */
  compareDays: string[];
}

/** Prozor poslednjih `length` dana zaključno sa današnjim (lokalno vreme). */
export function trendWindow(now: Date, length = TREND_DAYS): TrendWindow {
  const today = todayLocal(now);
  const fromDay = addDays(today, -(length - 1));
  return {
    today,
    fromDay,
    days: daysBetween(fromDay, today),
    compareDays: daysBetween(addDays(today, -2 * COMPARE_DAYS), addDays(today, -1)),
  };
}

// Pravilo pokrivenosti dana stanice (koriste ga i dnevni grafikon stanice i Sinhronizacija).
export { dayLengthHours, isCoveredStat, MIN_DAY_COVERAGE, minCoveredHours } from '@/lib/coverage';

/**
 * Završeni dani prozora za koje baza nema NIJEDAN red dnevne statistike (nijedna stanica,
 * nijedan polutant): istorija tog dana nije učitana (Sinhronizacija → „Dopuni nedostajuće
 * dane“). To nije „nema merenja“ – kad je dan učitan, a stanica nema red, stanica nije merila.
 * Računa se iz CELE mreže (ne iz okruga ni sočiva), jer se istorija učitava za sve stanice.
 */
export function notLoadedDays(stats: readonly Pick<DailyStatRecord, 'day'>[], days: readonly string[], today: string): Set<string> {
  const loaded = new Set<string>();
  for (const stat of stats) loaded.add(stat.day);
  return new Set(days.filter((day) => day !== today && !loaded.has(day)));
}

/**
 * Dnevna statistika u opsegu stranice: samo stanice iz `stationIds` (null = sve) i, za
 * sočivo polutanta, samo taj polutant. Za „Najlošiji“ ostaju svi polutanti.
 */
export function scopeDailyStats(stats: readonly DailyStatRecord[], stationIds: ReadonlySet<string> | null, lens: Lens): DailyStatRecord[] {
  return stats.filter((stat) => (lens === 'worst' || stat.parameter === lens) && (stationIds === null || stationIds.has(stat.station_id)));
}

/**
 * Broj stanica po kategoriji po danu (najgora dnevna kategorija stanice) kroz sočivo i okrug,
 * samo iz POKRIVENIH dana stanica. Stanice koje su tog dana merile, ali kraće od 75 % sati,
 * broje se u `short` (nisu u `counts` ni u `total`). Današnji dan je ceo nepotpun i prikazuje
 * se šrafiran, pa se za njega broje sve stanice sa merenjem (sažeci ga ionako preskaču).
 */
export function scopedDayCounts(
  stats: readonly DailyStatRecord[],
  days: string[],
  stationIds: ReadonlySet<string> | null,
  lens: Lens,
  today: string | null = null,
): DayCategoryCounts[] {
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const covered = days.map(() => new Map<string, CategoryRank>());
  const seen = days.map(() => new Set<string>());
  for (const stat of stats) {
    const index = dayIndex.get(stat.day);
    if (index === undefined || !isFiniteNumber(stat.categoryMax)) continue;
    if (lens !== 'worst' && stat.parameter !== lens) continue;
    if (stationIds !== null && !stationIds.has(stat.station_id)) continue;
    seen[index].add(stat.station_id);
    if (stat.day !== today && !isCoveredStat(stat)) continue;
    const rank = clampRank(stat.categoryMax);
    const ranks = covered[index];
    ranks.set(stat.station_id, Math.max(ranks.get(stat.station_id) ?? 0, rank) as CategoryRank);
  }
  return days.map((day, index) => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const rank of covered[index].values()) counts[rank]++;
    const total = covered[index].size;
    return { day, counts, total, short: seen[index].size - total };
  });
}

function clampRank(value: number): CategoryRank {
  return Math.min(5, Math.max(0, Math.round(Number.isFinite(value) ? value : 0))) as CategoryRank;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Sažetak trenda mreže
// ---------------------------------------------------------------------------

export interface TrendWorstDay {
  day: string;
  /** Stanice u kategoriji `ALERT_RANK` ili lošijoj. */
  count: number;
  /** Stanice sa podacima tog dana. */
  total: number;
  share: number;
}

export interface TrendSummary {
  /** Završeni dani sa bar jednim pokrivenim danom stanice (bez današnjeg). */
  completeDays: number;
  /** Završeni dani u kojima je bar jedna stanica (pokriven dan) bila „Zagađen“ ili lošije. */
  alertDays: number;
  /** Završeni dan sa najvećim udelom stanica „Zagađen“ ili lošije (null kad takvog nema). */
  worst: TrendWorstDay | null;
  /** Dani stanica u završenim danima kraći od 75 % sati – nisu uračunati. */
  shortStationDays: number;
}

/** Broj stanica u kategoriji `alertRank` ili lošijoj. */
function alertCount(row: DayCategoryCounts, alertRank: number): number {
  return row.counts.slice(alertRank).reduce((sum, value) => sum + value, 0);
}

/**
 * Sažetak 30 dana iz broja stanica po kategoriji (pokriveni dani stanica, vidi
 * `scopedDayCounts`); današnji, nepotpun dan se ne računa.
 */
export function trendSummary(rows: readonly DayCategoryCounts[], today: string, alertRank: number = ALERT_RANK): TrendSummary {
  let completeDays = 0;
  let alertDays = 0;
  let shortStationDays = 0;
  let worst: TrendWorstDay | null = null;
  for (const row of rows) {
    if (row.day === today) continue;
    shortStationDays += row.short ?? 0;
    if (row.total === 0) continue;
    completeDays++;
    const count = alertCount(row, alertRank);
    if (count === 0) continue;
    alertDays++;
    const share = count / row.total;
    if (!worst || share > worst.share || (share === worst.share && count > worst.count)) worst = { day: row.day, count, total: row.total, share };
  }
  return { completeDays, alertDays, worst, shortStationDays };
}

// ---------------------------------------------------------------------------
// Udeo dana stanica „Zagađen“ ili lošije: poslednjih 15 prema prethodnih 15 dana
// ---------------------------------------------------------------------------

export interface PollutedPeriod {
  /** Prvi i poslednji dan perioda (uključivo). */
  from: string;
  to: string;
  /** Broj dana u periodu. */
  days: number;
  /** Dani perioda sa bar jednim pokrivenim danom stanice. */
  daysWithData: number;
  /** Pokriveni dani stanica u periodu. */
  stationDays: number;
  /** Od toga u kategoriji „Zagađen“ ili lošijoj. */
  polluted: number;
  /** `polluted / stationDays` ili null kad u periodu nema pokrivenih dana stanica. */
  share: number | null;
}

export interface PollutedDay {
  day: string;
  /** Udeo pokrivenih stanica „Zagađen“ ili lošije tog dana, ili null kad nema pokrivenih. */
  share: number | null;
  /** Pokrivene stanice tog dana. */
  total: number;
  /** Stanice sa kraćim (nepokrivenim) danom. */
  short: number;
}

export interface PollutedComparison {
  /** Poslednjih `COMPARE_DAYS` završenih dana (do juče). */
  recent: PollutedPeriod;
  /** `COMPARE_DAYS` dana pre toga. */
  previous: PollutedPeriod;
  /** recent.share − previous.share (udeo 0–1), ili null kad poređenje nije pouzdano. */
  delta: number | null;
  /** Udeo po danu (oba perioda, najstariji prvi) – za traku dana. */
  daily: PollutedDay[];
}

function pollutedPeriod(rows: readonly DayCategoryCounts[], alertRank: number): PollutedPeriod {
  let stationDays = 0;
  let polluted = 0;
  let daysWithData = 0;
  for (const row of rows) {
    if (row.total === 0) continue;
    daysWithData++;
    stationDays += row.total;
    polluted += alertCount(row, alertRank);
  }
  return {
    from: rows[0]?.day ?? '',
    to: rows[rows.length - 1]?.day ?? '',
    days: rows.length,
    daysWithData,
    stationDays,
    polluted,
    share: stationDays > 0 ? polluted / stationDays : null,
  };
}

/**
 * Udeo dana stanica (pokrivenih, vidi `isCoveredStat`) u kategoriji „Zagađen“ ili lošijoj:
 * poslednjih `period` završenih dana prema `period` dana pre toga. Za razliku od „dana sa bar
 * jednom zagađenom stanicom“ (skoro uvek ~100 % u mreži od 60 stanica), ovaj udeo se pomera.
 * `rows` su brojevi po danu iz `scopedDayCounts` (današnji dan se preskače). Poređenje (`delta`)
 * postoji samo kad oba perioda imaju podatke za bar polovinu dana.
 */
export function pollutedComparison(
  rows: readonly DayCategoryCounts[],
  today: string,
  period = COMPARE_DAYS,
  alertRank: number = ALERT_RANK,
): PollutedComparison {
  const complete = rows.filter((row) => row.day !== today);
  const recentRows = complete.slice(-period);
  const previousRows = complete.slice(-2 * period, -period);
  const recent = pollutedPeriod(recentRows, alertRank);
  const previous = pollutedPeriod(previousRows, alertRank);
  const enough = (p: PollutedPeriod) => p.share !== null && p.daysWithData >= Math.ceil(period / 2);
  const delta = enough(recent) && enough(previous) ? recent.share! - previous.share! : null;
  const daily = [...previousRows, ...recentRows].map((row) => ({
    day: row.day,
    share: row.total > 0 ? alertCount(row, alertRank) / row.total : null,
    total: row.total,
    short: row.short ?? 0,
  }));
  return { recent, previous, delta, daily };
}

export interface PollutedInsight {
  /** Poslednji završen dan sa pokrivenim podacima (obično juče). */
  latest: { day: string; share: number; count: number; total: number } | null;
  /** Prosek dnevnih udela završenih dana sa podacima (visina stubova u proseku) ili null. */
  average: number | null;
  /** Broj završenih dana sa podacima u proseku. */
  days: number;
}

/** Udeo stanica „Zagađen“ ili lošije za rečenicu ispod „Trend mreže“ (pokriveni dani stanica). */
export function pollutedInsight(rows: readonly DayCategoryCounts[], today: string, alertRank: number = ALERT_RANK): PollutedInsight {
  const withData = rows.filter((row) => row.day !== today && row.total > 0);
  const shares = withData.map((row) => alertCount(row, alertRank) / row.total);
  const last = withData[withData.length - 1];
  return {
    latest: last ? { day: last.day, share: shares[shares.length - 1], count: alertCount(last, alertRank), total: last.total } : null,
    average: shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : null,
    days: shares.length,
  };
}

/**
 * „Udeo stanica „Zagađen“ ili lošije: juče 24 %, prosek 29 završenih dana 31 %.“ – kad juče
 * nema pokrivenih podataka, navodi se poslednji dan koji ih ima. Null kad nema podataka.
 */
export function pollutedSentence(insight: PollutedInsight, today: string, alertLabel: string): string | null {
  if (!insight.latest || insight.average === null) return null;
  const yesterday = addDays(today, -1);
  const when = insight.latest.day === yesterday ? 'juče' : `poslednji dan sa podacima (${formatDayShort(insight.latest.day)})`;
  const average =
    insight.days > 1
      ? `, prosek ${formatInt(insight.days)} ${pluralSr(insight.days, 'završenog dana', 'završena dana', 'završenih dana')} ${formatPercent(insight.average)}`
      : '';
  return `Udeo stanica „${alertLabel}“ ili lošije: ${when} ${formatPercent(insight.latest.share)}${average}.`;
}

// ---------------------------------------------------------------------------
// Kalendar: stanice × dani
// ---------------------------------------------------------------------------

export interface DayCell {
  /** Najviša satna vrednost polutanta koji određuje kategoriju dana (µg/m³) ili null. */
  value: number | null;
  /** Dnevni prosek istog polutanta ili null. */
  avg: number | null;
  /** Dnevna kategorija (kategorija najviše satne vrednosti) ili null kad nema merenja. */
  rank: CategoryRank | null;
  /** Polutant ćelije (za „Najlošiji“ onaj koji daje najgoru kategoriju). */
  parameter: Parameter | null;
  /** Broj satnih merenja u danu (nepotpun dan ih ima manje od 24). */
  hours: number;
  /**
   * Završen dan sa merenjem kraćim od 75 % sati (nijedan polutant nema pokriven dan): ćelija se
   * prikazuje šrafirana i ne ulazi u brojeve. Današnji dan je nepotpun ceo (kolona), ne ovde.
   */
  short: boolean;
}

const EMPTY_CELL: DayCell = { value: null, avg: null, rank: null, parameter: null, hours: 0, short: false };

/** Da li stat `b` „pobeđuje“ stat `a` za isti dan: lošija kategorija, pa bliže sledećem pragu. */
function worse(a: DailyStatRecord, b: DailyStatRecord): boolean {
  const rankA = clampRank(a.categoryMax);
  const rankB = clampRank(b.categoryMax);
  if (rankA !== rankB) return rankB > rankA;
  const ratio = (stat: DailyStatRecord, rank: number) => stat.maxValue / (THRESHOLDS_1H[stat.parameter]?.[Math.min(rank, 4)] || 1);
  return ratio(b, rankB) > ratio(a, rankA);
}

/**
 * Ćelije po stanici (Map stationId → ćelije poravnate sa `days`). Za sočivo polutanta
 * ćelija je taj polutant; za „Najlošiji“ polutant sa najgorom dnevnom kategorijom među
 * POKRIVENIM redovima (vidi `isCoveredStat`). Završen dan bez ijednog pokrivenog reda
 * prikazuje najgori kraći red i ima `short: true`. Današnji dan (`today`) bira među svima.
 */
export function stationDayCells(stats: readonly DailyStatRecord[], days: string[], lens: Lens, today: string | null = null): Map<string, DayCell[]> {
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const picked = new Map<string, Array<{ stat: DailyStatRecord; covered: boolean } | null>>();
  for (const stat of stats) {
    if (lens !== 'worst' && stat.parameter !== lens) continue;
    const index = dayIndex.get(stat.day);
    if (index === undefined || !isFiniteNumber(stat.categoryMax)) continue;
    let row = picked.get(stat.station_id);
    if (!row) {
      row = days.map(() => null);
      picked.set(stat.station_id, row);
    }
    const covered = stat.day === today || isCoveredStat(stat);
    const current = row[index];
    // Pokriven red uvek pobeđuje kraći; među istima – lošija kategorija, pa bliže pragu.
    if (!current || (covered && !current.covered) || (covered === current.covered && worse(current.stat, stat))) row[index] = { stat, covered };
  }
  const result = new Map<string, DayCell[]>();
  for (const [stationId, row] of picked) {
    result.set(
      stationId,
      row.map((entry) =>
        entry
          ? {
              value: isFiniteNumber(entry.stat.maxValue) ? entry.stat.maxValue : null,
              avg: isFiniteNumber(entry.stat.avgValue) ? entry.stat.avgValue : null,
              rank: clampRank(entry.stat.categoryMax),
              parameter: entry.stat.parameter,
              hours: entry.stat.hours,
              short: !entry.covered,
            }
          : EMPTY_CELL,
      ),
    );
  }
  return result;
}

export interface CalendarRow {
  id: string;
  view: StationView;
  cells: DayCell[];
  /** Završeni pokriveni dani (bez današnjeg i bez kraćih dana). */
  daysWithData: number;
  /** Završeni pokriveni dani u kategoriji `ALERT_RANK` ili lošijoj. */
  alertDays: number;
  /** Prosečna dnevna kategorija završenih pokrivenih dana (za redosled) ili null. */
  meanRank: number | null;
  /** Završeni dani sa merenjem kraćim od 75 % sati (prikazani šrafirano, nisu uračunati). */
  shortDays: number;
}

export interface CalendarMatrix {
  rows: CalendarRow[];
  /** Stanice iz opsega bez ijednog dana statistike u prozoru (nisu prikazane). */
  missing: number;
}

/**
 * Matrica „Kalendar · 30 dana“: stanice opsega × dani prozora. Brojevi i redosled računaju
 * samo završene pokrivene dane (današnji i kraći dani su prikazani, ali se ne broje).
 * Redosled: najviše dana u kategoriji „Zagađen“ ili lošijoj, pa viša prosečna kategorija,
 * pa naziv. Stanice bez ijednog dana statistike se izostavljaju (broje se u `missing`).
 */
export function calendarMatrix(
  stats: readonly DailyStatRecord[],
  days: string[],
  views: readonly StationView[],
  lens: Lens,
  today: string | null = null,
): CalendarMatrix {
  const cells = stationDayCells(stats, days, lens, today);
  const rows: CalendarRow[] = [];
  let missing = 0;
  for (const view of views) {
    const row = cells.get(view.id);
    if (!row || row.every((cell) => cell.rank === null)) {
      missing++;
      continue;
    }
    const counted = row.filter((cell, index) => cell.rank !== null && !cell.short && days[index] !== today);
    const ranks = counted.map((cell) => cell.rank as CategoryRank);
    rows.push({
      id: view.id,
      view,
      cells: row,
      daysWithData: ranks.length,
      alertDays: ranks.filter((rank) => rank >= ALERT_RANK).length,
      meanRank: ranks.length ? ranks.reduce<number>((sum, rank) => sum + rank, 0) / ranks.length : null,
      shortDays: row.filter((cell, index) => cell.short && days[index] !== today).length,
    });
  }
  rows.sort(
    (a, b) =>
      b.alertDays - a.alertDays ||
      (b.meanRank ?? -1) - (a.meanRank ?? -1) ||
      a.view.station.name.localeCompare(b.view.station.name, 'sr-Latn'),
  );
  return { rows, missing };
}

/**
 * Rečenica sažetka kalendara: koliko stanica je imalo loš (završen, pokriven) dan i koja
 * najviše, npr. „… najviše Bor (18 od 27 pokrivenih dana).“ – imenilac su pokriveni dani te stanice.
 */
export function calendarSentence(rows: readonly CalendarRow[], alertLabel: string): string | null {
  if (rows.length === 0) return null;
  const affected = rows.filter((row) => row.alertDays > 0);
  if (affected.length === 0) return `Nijedna stanica nije imala završen dan u kategoriji „${alertLabel}“ ili lošijoj.`;
  const top = affected[0];
  const days = `${formatInt(top.alertDays)} od ${formatInt(top.daysWithData)} ${pluralSr(top.daysWithData, 'pokrivenog dana', 'pokrivena dana', 'pokrivenih dana')}`;
  const lead = `${formatInt(affected.length)} ${pluralSr(affected.length, 'stanica je imala', 'stanice su imale', 'stanica je imalo')} bar jedan dan u kategoriji „${alertLabel}“ ili lošijoj`;
  return `${lead}; najviše ${top.view.station.name} (${days}).`;
}

// ---------------------------------------------------------------------------
// Okruzi: skala „dumbbell“ prikaza
// ---------------------------------------------------------------------------

export interface DumbbellBand {
  rank: CategoryRank;
  from: number;
  to: number;
}

export interface DumbbellScale {
  /** Kraj ose (µg/m³), „okrugao“ broj iznad najveće vrednosti. */
  max: number;
  /** SEPA pragovi polutanta unutar ose (granica između `rank` i `rank + 1`). */
  thresholds: Array<{ value: number; rank: CategoryRank }>;
  /** Pojasevi kategorija isečeni na osu (za traku u boji iznad grafikona). */
  bands: DumbbellBand[];
}

/** „Okrugao“ kraj ose: korak 5 do 50, 10 do 200, 25 do 500, pa 50. */
export function roundAxisMax(value: number): number {
  const target = Math.max(1, value);
  const step = target <= 20 ? 2 : target <= 50 ? 5 : target <= 200 ? 10 : target <= 500 ? 25 : 50;
  return Math.ceil(target / step) * step;
}

/**
 * Osa u µg/m³ za „dumbbell“: od 0 do zaokružene vrednosti iznad najveće vrednosti (+12 %),
 * a najmanje malo iza prvog SEPA praga, da granica „Dobar“ uvek bude vidljiva. Kad je sledeći
 * prag blizu (do 30 % iza zaokruženog kraja), osa se završava na pragu.
 */
export function dumbbellScale(parameter: Parameter, values: ReadonlyArray<number | null>): DumbbellScale {
  const limits = THRESHOLDS_1H[parameter];
  const finite = values.filter(isFiniteNumber);
  const top = finite.length ? Math.max(...finite) : 0;
  const needed = Math.max(top * 1.12, limits[0] * 1.2);
  const rounded = roundAxisMax(needed);
  // Kad je sledeći SEPA prag blizu, osa se završava baš na njemu (kraj ose = granica kategorije).
  const next = limits.find((limit) => limit >= Math.max(top * 1.04, limits[0] * 1.2));
  const max = next !== undefined && next <= rounded * 1.3 ? Math.max(next, roundAxisMax(top * 1.04)) : rounded;
  const thresholds = limits.flatMap((value, rank) => (value < max ? [{ value, rank: rank as CategoryRank }] : []));
  const bands: DumbbellBand[] = [];
  let from = 0;
  for (let rank = 0; rank <= 5 && from < max; rank++) {
    const to = rank < limits.length ? Math.min(limits[rank], max) : max;
    bands.push({ rank: rank as CategoryRank, from, to });
    from = to;
  }
  return { max, thresholds, bands };
}

/**
 * Natpis polutanta okruga: za „Najlošiji“ se okruzi porede po PM10 (vidi `resolveLensParameter`).
 * Bez tvrdnje da je to najčešći dominantni polutant – to zavisi od dana i nije provereno.
 */
export function dumbbellLensNote(lens: Lens, parameter: Parameter): string | null {
  return lens === 'worst' ? `Za sočivo „${lensLabel(lens)}“ okruzi se porede po ${PARAMETER_LABELS[parameter]}; izaberite polutant za drugi prikaz.` : null;
}

/**
 * Medijana dnevnih proseka stanica po danu (za skicu „tipičan dnevni nivo“) – samo pokriveni
 * dani stanica (prosek iz 3 sata nije dnevni prosek); null kad nema podataka.
 */
export function dailyMedianSeries(stats: readonly DailyStatRecord[], days: string[], parameter: Parameter): Array<number | null> {
  const perDay = new Map<string, number[]>();
  for (const stat of stats) {
    if (stat.parameter !== parameter || !isFiniteNumber(stat.avgValue) || !isCoveredStat(stat)) continue;
    const list = perDay.get(stat.day) ?? [];
    list.push(stat.avgValue);
    perDay.set(stat.day, list);
  }
  return days.map((day) => median(perDay.get(day) ?? []));
}

/** Najgora kategorija u opsegu po danu (najviša dnevna kategorija bilo koje stanice) ili null. */
export function dayWorstRanks(rows: readonly DayCategoryCounts[]): Array<CategoryRank | null> {
  return rows.map((row) => {
    for (let rank = 5; rank >= 0; rank--) if ((row.counts[rank] ?? 0) > 0) return rank as CategoryRank;
    return null;
  });
}

export interface WeekCompare {
  /** Prosek poslednjih 7 završenih dana. */
  last: number;
  /** Prosek 7 dana pre toga. */
  previous: number;
  delta: number;
}

/**
 * Poslednjih 7 završenih dana prema prethodnih 7 (današnji, nepotpun dan se preskače).
 * Svaka nedelja mora imati bar 4 dana sa vrednošću, inače null.
 */
export function weekOverWeek(series: ReadonlyArray<number | null>, days: readonly string[], today: string): WeekCompare | null {
  const complete = series.filter((_, index) => days[index] !== today);
  const mean = (values: ReadonlyArray<number | null>) => {
    const finite = values.filter(isFiniteNumber);
    return finite.length >= 4 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  };
  const last = mean(complete.slice(-7));
  const previous = mean(complete.slice(-14, -7));
  if (last === null || previous === null) return null;
  return { last, previous, delta: last - previous };
}

/** Poslednja vrednost niza (sa indeksom) koja nije null, preskačući današnji dan. */
export function lastComplete(series: ReadonlyArray<number | null>, days: readonly string[], today: string): { value: number; day: string } | null {
  for (let index = series.length - 1; index >= 0; index--) {
    const value = series[index];
    if (days[index] !== today && isFiniteNumber(value)) return { value, day: days[index] };
  }
  return null;
}

export interface WorstStationDay {
  stationId: string;
  parameter: Parameter;
  /** Najviša satna vrednost tog dana (µg/m³). */
  value: number;
  rank: CategoryRank;
}

/** Najlošija stanica opsega u danu (kategorija, pa odnos prema pragu) kroz sočivo, samo pokriveni dani, ili null. */
export function worstStationOnDay(
  stats: readonly DailyStatRecord[],
  day: string,
  stationIds: ReadonlySet<string> | null,
  lens: Lens,
): WorstStationDay | null {
  let best: DailyStatRecord | null = null;
  for (const stat of stats) {
    if (stat.day !== day || !isFiniteNumber(stat.categoryMax) || !isFiniteNumber(stat.maxValue) || !isCoveredStat(stat)) continue;
    if (lens !== 'worst' && stat.parameter !== lens) continue;
    if (stationIds !== null && !stationIds.has(stat.station_id)) continue;
    if (!best || worse(best, stat)) best = stat;
  }
  return best ? { stationId: best.station_id, parameter: best.parameter, value: best.maxValue, rank: clampRank(best.categoryMax) } : null;
}
