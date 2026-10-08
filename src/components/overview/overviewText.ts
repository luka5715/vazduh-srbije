/**
 * Čiste pomoćne funkcije stranice Pregled: rečenice heroja (srpska gramatika), položaj
 * vrednosti na SEPA skali, „do sledeće kategorije“ i sažetak ritma mreže. Bez React-a.
 */

import { CATEGORIES, PARAMETER_LABELS, type CategoryRank, type Parameter } from '@shared/aqi';

import { formatDelta, formatInt, pluralSr, roundConcentration } from '@/lib/format';
import { lensLabel, thresholdsFor, type DominantDrivers, type DriverCount, type Lens, type LensDistribution } from '@/lib/insights';

/** Broj stanica u rang-listi „Najzagađenije stanice“. */
export const WORST_LIMIT = 8;

/** „stanica“ posle „od N“ (genitiv): od 1 stanice, od 3 stanice, od 25 stanica, od 21 stanice. */
export function stationsGenitive(count: number): string {
  return pluralSr(count, 'stanice', 'stanice', 'stanica');
}

export interface Headline {
  /** Uvod naslova, npr. „Vazduh je uglavnom“. */
  lead: string;
  /** Reč kategorije (dobija podvlačenje u boji izmaglice), npr. „umeren“. */
  word: string;
  /** Kategorija naslova (za rečenicu „Uglavnom zbog …“). */
  rank: CategoryRank;
}

/**
 * Udeo svežih stanica u kategorijama LOŠIJIM od dominantne od kojeg naslov nosi dva stanja
 * („umeren do zagađen“): „najčešće umeren“ uz 42 od 87 stanica u „Zagađen“ ili gore umanjuje stanje.
 */
export const TWO_STATE_SHARE = 0.4;

/**
 * Naslov heroja iz broja stanica po kategoriji i dominantne kategorije (najčešća, pri
 * jednakom broju lošija – isto kao `--haze`). Kad je bar `TWO_STATE_SHARE` stanica u lošijim
 * kategorijama od dominantne, naslov ima dva stanja: „Vazduh je umeren do“ + „zagađen“
 * (najbrojnija lošija kategorija, pri jednakom broju lošija); `rank` je ta lošija kategorija,
 * pa boja reči i rečenica „zbog …“ opisuju nju. Obrnuto (dominantna loša, mnoge bolje) ostaje
 * jedno stanje – „najčešće zagađen“ ne umanjuje stanje. Inače prilog prati udeo dominantne:
 * sve stanice → „svuda“, bar polovina → „uglavnom“, manje → „najčešće“. Sa jednom ili dve
 * stanice (mali okrug) naslov broji stanice umesto priloga – „svuda“ za jednu stanicu laže:
 * „Na jedinoj stanici vazduh je …“, „Na obe stanice …“, „Na jednoj od dve stanice …“ (lošija).
 */
export function heroHeadline(counts: readonly number[], dominant: CategoryRank | null): Headline | null {
  const reporting = counts.reduce((sum, count) => sum + count, 0);
  if (dominant === null || reporting === 0) return null;
  if (reporting <= 2) {
    const worst = counts.reduce((max, count, rank) => (count > 0 ? rank : max), 0) as CategoryRank;
    const word = CATEGORIES[worst].label.toLowerCase();
    if (reporting === 1) return { lead: 'Na jedinoj stanici vazduh je', word, rank: worst };
    return { lead: counts[worst] === 2 ? 'Na obe stanice vazduh je' : 'Na jednoj od dve stanice vazduh je', word, rank: worst };
  }
  const dominantWord = CATEGORIES[dominant].label.toLowerCase();
  let worse = 0;
  let worseMode: CategoryRank | null = null;
  for (let rank = dominant + 1; rank < counts.length; rank++) {
    worse += counts[rank];
    if (counts[rank] > 0 && (worseMode === null || counts[rank] >= counts[worseMode])) worseMode = rank as CategoryRank;
  }
  if (worseMode !== null && worse / reporting >= TWO_STATE_SHARE) {
    return { lead: `Vazduh je ${dominantWord} do`, word: CATEGORIES[worseMode].label.toLowerCase(), rank: worseMode };
  }
  const share = counts[dominant] / reporting;
  const adverb = share >= 0.999 ? 'svuda' : share >= 0.5 ? 'uglavnom' : 'najčešće';
  return { lead: `Vazduh je ${adverb}`, word: dominantWord, rank: dominant };
}

/** „na obe stanice“, „na sve 3 stanice“, „na svih 18 stanica“. */
function onAllStations(count: number): string {
  if (count === 2) return 'na obe stanice';
  return pluralSr(count, `na svih ${formatInt(count)} stanica`, `na sve ${formatInt(count)} stanice`, `na svih ${formatInt(count)} stanica`);
}

/** „PM2.5 i NO₂“, „PM10, PM2.5 i NO₂“. */
function joinLabels(parameters: readonly Parameter[]): string {
  const labels = parameters.map((parameter) => PARAMETER_LABELS[parameter]);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} i ${labels[labels.length - 1]}`;
}

/**
 * Šta određuje kategoriju naslova (iz `dominantDrivers`, nikad unapred zadato):
 * „Uglavnom zbog NO₂ – na 12 od 18 stanica u kategoriji „Umeren“.“ Bez stanica ili bez
 * poznatog dominantnog polutanta → null.
 */
export function driverSentence({ stations, drivers }: DominantDrivers, rank: CategoryRank): string | null {
  if (stations === 0 || drivers.length === 0) return null;
  const scope = `u kategoriji „${CATEGORIES[rank].label}“`;
  const top = drivers[0];
  const tied = drivers.filter((entry) => entry.count === top.count);
  const of = (count: number) => `${formatInt(count)} od ${formatInt(stations)} ${stationsGenitive(stations)}`;
  if (tied.length > 1) {
    return `Podjednako zbog ${joinLabels(tied.map((entry) => entry.parameter))} – po ${of(top.count)} ${scope}.`;
  }
  const label = PARAMETER_LABELS[top.parameter];
  if (stations === 1) return `Kategoriju „${CATEGORIES[rank].label}“ određuje ${label}.`;
  if (top.count === stations) return `Zbog ${label} – ${onAllStations(stations)} ${scope}.`;
  if (top.count / stations >= 0.5) return `Uglavnom zbog ${label} – na ${of(top.count)} ${scope}.`;
  // Ostale stanice mogu biti bez poznatog dominantnog polutanta – tada nema „zatim …“.
  const next: DriverCount | undefined = drivers[1];
  return next
    ? `Najčešće zbog ${label} – na ${of(top.count)} ${scope}; zatim ${PARAMETER_LABELS[next.parameter]} (${formatInt(next.count)}).`
    : `Najčešće zbog ${label} – na ${of(top.count)} ${scope}.`;
}

/**
 * Raspodela kroz izabrano sočivo, uz heroj koji uvek opisuje sve polutante:
 * „Po SO₂: 22 dobar, 1 prihvatljiv, 1 umeren · 1 bez vrednosti“. Za „Najlošiji“ → null.
 */
export function lensSentence(lens: Lens, { counts, reporting, missing }: LensDistribution): string | null {
  if (lens === 'worst') return null;
  const label = lensLabel(lens);
  if (reporting === 0) return `Po ${label}: nijedna sveža stanica nema vrednost.`;
  const parts = counts
    .map((count, rank) => (count > 0 ? `${formatInt(count)} ${CATEGORIES[rank].label.toLowerCase()}` : null))
    .filter((part): part is string => part !== null);
  return `Po ${label}: ${parts.join(', ')}${missing > 0 ? ` · ${formatInt(missing)} bez vrednosti` : ''}`;
}

/**
 * Da li rečenica raspodele samo ponavlja naslov: jedna ili dve stanice iste kategorije
 * („Na jedinoj stanici vazduh je zagađen“ već kaže sve). Tada heroj prikazuje samo „zbog …“.
 */
export function distributionRepeatsHeadline(counts: readonly number[]): boolean {
  const reporting = counts.reduce((sum, count) => sum + count, 0);
  return reporting > 0 && reporting <= 2 && counts.filter((count) => count > 0).length === 1;
}

/**
 * Rečenica raspodele: „Na 19 od 25 stanica vazduh je umeren, na 6 prihvatljiv.“
 * Najviše tri kategorije (najbrojnije prve, pri jednakom broju lošija), ostatak kao „na još N“.
 */
export function distributionSentence(counts: readonly number[]): string {
  const reporting = counts.reduce((sum, count) => sum + count, 0);
  if (reporting === 0) return 'Nijedna stanica trenutno nema sveže podatke.';
  const ordered = counts
    .map((count, rank) => ({ count, rank }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  if (ordered.length === 1) {
    const only = ordered[0];
    return `Na ${reporting === 1 ? 'jedinoj' : `svih ${formatInt(reporting)}`} ${reporting === 1 ? 'stanici' : stationsGenitive(reporting)} sa svežim podacima vazduh je ${CATEGORIES[only.rank].label.toLowerCase()}.`;
  }
  const shown = ordered.slice(0, 3);
  const rest = ordered.slice(3).reduce((sum, entry) => sum + entry.count, 0);
  const parts = shown.map((entry, index) =>
    index === 0
      ? `Na ${formatInt(entry.count)} od ${formatInt(reporting)} ${stationsGenitive(reporting)} vazduh je ${CATEGORIES[entry.rank].label.toLowerCase()}`
      : `na ${formatInt(entry.count)} ${CATEGORIES[entry.rank].label.toLowerCase()}`,
  );
  if (rest > 0) parts.push(`na još ${formatInt(rest)} u ostalim kategorijama`);
  return `${parts.join(', ')}.`;
}

/**
 * Red sa jednim mestom za Tab (traka uživo): sledeći indeks za ←/→ (bez prelaska preko ivice,
 * kao na mapi), Home/End za prvu i poslednju stavku; null kad taster ne pomera fokus.
 */
export function rovingIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Napomena o zastarelim stanicama koje nisu uračunate u stanje mreže (ili null). */
export function staleNote(stale: number): string | null {
  if (stale <= 0) return null;
  return `${formatInt(stale)} ${pluralSr(stale, 'stanica bez svežih podataka nije uračunata', 'stanice bez svežih podataka nisu uračunate', 'stanica bez svežih podataka nije uračunato')}.`;
}

// ---------------------------------------------------------------------------
// SEPA skala
// ---------------------------------------------------------------------------

export interface BandPosition {
  /** Položaj 0–1 na skali sa jednakim pojasevima kategorija. */
  position: number;
  /** Vrednost je iznad poslednjeg prikazanog pojasa (traka je puna). */
  overflow: boolean;
}

/**
 * Položaj vrednosti na ordinalnoj SEPA skali polutanta: `bandCount` pojaseva iste širine
 * (Dobar, Prihvatljiv …), unutar pojasa linearno. Vrednosti različitih polutanata tako
 * postaju uporedive („koliko je visoko na skali“), a granice kategorija su ravnomerne crtice.
 */
export function bandPosition(parameter: Parameter, value: number, bandCount = 6): BandPosition {
  const count = Math.min(6, Math.max(1, Math.round(bandCount)));
  const { bands } = thresholdsFor(parameter);
  const safe = Math.max(0, value);
  for (let index = 0; index < count; index++) {
    const band = bands[index];
    const last = index === count - 1;
    if (safe <= band.to || (last && index === bands.length - 1)) {
      const span = band.to - band.from || 1;
      const fraction = Math.min(1, Math.max(0, (safe - band.from) / span));
      return { position: (index + fraction) / count, overflow: last && safe > band.to };
    }
  }
  return { position: 1, overflow: true };
}

/** Broj pojaseva za rang-listu: bar do kategorije iznad najgore prikazane, najmanje 4. */
export function bandCountFor(maxRank: number): number {
  return Math.min(6, Math.max(4, maxRank + 2));
}

export interface NextThreshold {
  /** Gornja granica trenutne kategorije, µg/m³. */
  limit: number;
  /**
   * Koliko još do sledeće (lošije) kategorije, µg/m³ – od PRIKAZANE (zaokružene) vrednosti,
   * pa se „57,5 · još 2,5 do 60“ uvek sabira.
   */
  remaining: number;
  /** Naziv sledeće kategorije. */
  nextLabel: string;
  /** Udeo vrednosti u gornjoj granici kategorije (0–1) – za mali prsten. */
  share: number;
}

/** Koliko vrednost ima do sledeće, lošije SEPA kategorije; null za „Izuzetno zagađen“. */
export function nextThreshold(parameter: Parameter, value: number, rank: CategoryRank): NextThreshold | null {
  if (rank >= 5) return null;
  const { limits } = thresholdsFor(parameter);
  const limit: number = limits[rank as 0 | 1 | 2 | 3 | 4];
  return {
    limit,
    remaining: Math.max(0, Math.round((limit - roundConcentration(value)) * 10) / 10),
    nextLabel: CATEGORIES[rank + 1].label,
    share: limit > 0 ? Math.min(1, Math.max(0, value / limit)) : 1,
  };
}

// ---------------------------------------------------------------------------
// Ritam mreže
// ---------------------------------------------------------------------------

export interface RhythmSummary {
  /** Broj stanica koje su bar jednom u 24 h bile u kategoriji `minRank` ili lošijoj. */
  stations: number;
  /** Indeks sata sa najviše takvih stanica (najnoviji pri jednakom broju) ili null. */
  peakIndex: number | null;
  peakCount: number;
}

/** Sažetak toplotne mape: koliko stanica je prešlo prag kategorije i u kom satu najviše. */
export function rhythmSummary(rows: ReadonlyArray<{ cells: ReadonlyArray<{ rank: number | null }> }>, minRank = 3): RhythmSummary {
  let stations = 0;
  const perHour: number[] = [];
  for (const row of rows) {
    let hit = false;
    row.cells.forEach((cell, index) => {
      perHour[index] = perHour[index] ?? 0;
      if (cell.rank !== null && cell.rank >= minRank) {
        perHour[index]++;
        hit = true;
      }
    });
    if (hit) stations++;
  }
  let peakIndex: number | null = null;
  let peakCount = 0;
  perHour.forEach((count, index) => {
    if (count > 0 && count >= peakCount) {
      peakCount = count;
      peakIndex = index;
    }
  });
  return { stations, peakIndex, peakCount };
}

/**
 * Zajednički početak naziva (cele reči) svih stanica mreže, npr. „Demo stanica “. Računa se
 * nad celom mrežom, pa i jedan red posle filtera okruga dobija kratak natpis na telefonu.
 */
export function sharedWordPrefix(labels: readonly string[]): string {
  if (labels.length < 2) return '';
  const split = labels.map((label) => label.split(' '));
  const words: string[] = [];
  for (let i = 0; i < split[0].length - 1; i++) {
    const word = split[0][i];
    if (split.every((parts) => parts.length > i + 1 && parts[i] === word)) words.push(word);
    else break;
  }
  return words.length ? `${words.join(' ')} ` : '';
}

/** Kratka promena prema sopstvenom proseku 24 h: „↑ 12 iznad proseka 24 h“ (iznos kao na Stanicama). */
export function deltaPhrase(delta: number, direction: 'up' | 'down' | 'flat'): { arrow: string; amount: string | null; words: string } {
  if (direction === 'flat') return { arrow: '→', amount: null, words: 'kao prosek 24 h' };
  return {
    arrow: direction === 'up' ? '↑' : '↓',
    amount: formatDelta(delta),
    words: direction === 'up' ? 'iznad proseka 24 h' : 'ispod proseka 24 h',
  };
}
