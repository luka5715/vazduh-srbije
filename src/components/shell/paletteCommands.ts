/**
 * Čista logika palete komandi: rezultati za upit (stanice, filteri i prikaz, stranice),
 * ocena poklapanja bez obzira na dijakritike i opsezi za isticanje pogođenog dela naziva.
 * Bez React-a – testirano u `paletteCommands.test.ts`.
 */

import { LENSES, lensLabel, okrugLabel, okrugOf, type Lens } from '@/lib/insights';
import { bestScore, normalizeText } from '@/lib/search';
import type { StationView } from '@/lib/stations';
import { VIEW_META, VIEW_NAMES, type ViewName } from '@/lib/views';

/** Ocena od koje je poklapanje „pravo“ (početak teksta ili reči, podniz). */
export const STRONG_SCORE = 40;
/** Najviše stanica u rezultatima (lista se skroluje). */
export const MAX_STATIONS = 40;
/** Najviše nedavno otvorenih stanica. */
export const MAX_RECENT = 4;

export type PaletteAction =
  | { type: 'station'; stationId: string }
  | { type: 'page'; view: ViewName }
  | { type: 'okrug'; okrug: string | null }
  | { type: 'lens'; lens: Lens }
  | { type: 'theme' }
  | { type: 'refresh' };

export type PaletteGroupKey = 'recent' | 'stations' | 'actions' | 'pages';

export interface PaletteItem {
  key: string;
  group: PaletteGroupKey;
  title: string;
  subtitle: string;
  action: PaletteAction;
  /** Stanica (za vrednost i čip kategorije) ili null. */
  view: StationView | null;
  /** Opseg naslova koji odgovara upitu (za isticanje) ili null. */
  highlight: [number, number] | null;
  /** Izabrana/aktivna opcija (trenutni okrug, sočivo, stranica). */
  current?: boolean;
  score: number;
}

export interface PaletteGroup {
  key: PaletteGroupKey;
  label: string;
  items: PaletteItem[];
}

export const GROUP_LABELS: Record<PaletteGroupKey, string> = {
  recent: 'Nedavno otvorene',
  stations: 'Stanice',
  actions: 'Filteri i prikaz',
  pages: 'Idi na stranicu',
};

export interface PaletteContext {
  query: string;
  views: StationView[];
  okrugs: string[];
  okrug: string | null;
  lens: Lens;
  view: ViewName;
  theme: 'light' | 'dark';
  /** Id-jevi nedavno otvorenih stanica (najnovija prva). */
  recentIds: string[];
}

/**
 * Opseg (početak, kraj) u ORIGINALNOM tekstu koji odgovara normalizovanom upitu („cac“ u
 * „Čačak“ → [0, 3]). Normalizacija ide znak po znak (đ → dj, bez kvačica), pa se indeksi
 * vraćaju na izvorne znakove. Null kad upit nije podniz (npr. rasuto poklapanje).
 */
export function highlightRange(text: string, query: string): [number, number] | null {
  const q = normalizeText(query);
  if (!q) return null;
  let normalized = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    let mapped = /\s/.test(char) ? ' ' : char.toLowerCase();
    mapped = mapped === 'đ' ? 'dj' : mapped.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (let k = 0; k < mapped.length; k++) {
      normalized += mapped[k];
      origin.push(index);
    }
  }
  const at = normalized.indexOf(q);
  if (at < 0) return null;
  return [origin[at], origin[at + q.length - 1] + 1];
}

function stationItems(context: PaletteContext): PaletteItem[] {
  const q = normalizeText(context.query);
  const items = context.views.map((view): PaletteItem => {
    const okrug = okrugOf(view);
    const subtitle = [view.station.code, view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ');
    const score = q
      ? bestScore(q, [[view.station.name, 1.25], [view.station.code, 1.1], view.station.municipality, okrug ? okrugLabel(okrug) : null])
      : 1;
    return {
      key: `station-${view.id}`,
      group: 'stations',
      title: view.station.name,
      subtitle,
      action: { type: 'station', stationId: view.id },
      view,
      highlight: q ? highlightRange(view.station.name, context.query) : null,
      score,
    };
  });
  const matched = items.filter((item) => item.score > 0);
  // Rasuta poklapanja (slova redom) samo kad nema nijednog pravog.
  const strong = matched.filter((item) => item.score >= STRONG_SCORE);
  const list = q && strong.length > 0 ? strong : matched;
  return list.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'sr-Latn')).slice(0, MAX_STATIONS);
}

function pageItems(context: PaletteContext): PaletteItem[] {
  const q = normalizeText(context.query);
  return VIEW_NAMES.map((name): PaletteItem => {
    const meta = VIEW_META[name];
    return {
      key: `page-${name}`,
      group: 'pages',
      title: meta.title,
      subtitle: meta.description,
      action: { type: 'page', view: name },
      view: null,
      highlight: q ? highlightRange(meta.title, context.query) : null,
      current: name === context.view,
      score: q ? bestScore(q, [[meta.title, 1.2], meta.keywords, meta.description]) : 1,
    };
  }).filter((item) => (q ? item.score >= STRONG_SCORE : true));
}

/**
 * Filteri i prikaz: okrug (samo uz upit koji ga pogađa; „Svi okruzi“ i kad je filter aktivan),
 * sočivo polutanta, tema i osvežavanje. Bez upita se nudi samo uklanjanje aktivnog filtera.
 */
function actionItems(context: PaletteContext): PaletteItem[] {
  const q = normalizeText(context.query);
  const items: PaletteItem[] = [];
  if (context.okrug) {
    const score = q ? bestScore(q, ['svi okruzi', 'ukloni filter okruga', 'okrug']) : 1;
    if (score >= STRONG_SCORE || !q)
      items.push({
        key: 'okrug-all',
        group: 'actions',
        title: 'Svi okruzi',
        subtitle: `Ukloni filter: ${okrugLabel(context.okrug)}`,
        action: { type: 'okrug', okrug: null },
        view: null,
        highlight: q ? highlightRange('Svi okruzi', context.query) : null,
        score: score + 5,
      });
  }
  if (!q) return items;
  for (const name of context.okrugs) {
    const label = okrugLabel(name);
    const score = bestScore(q, [label, 'filter okrug']);
    if (score < STRONG_SCORE) continue;
    const count = context.views.filter((view) => okrugOf(view) === name).length;
    items.push({
      key: `okrug-${name}`,
      group: 'actions',
      title: `Filtriraj: ${label}`,
      subtitle: `Prikaži samo stanice ovog okruga (${count}) na svim stranicama`,
      action: { type: 'okrug', okrug: name },
      view: null,
      highlight: highlightRange(`Filtriraj: ${label}`, context.query),
      current: name === context.okrug,
      score,
    });
  }
  for (const lens of LENSES) {
    const label = lensLabel(lens);
    const score = bestScore(q, [[label, 1.1], 'socivo polutant', lens === 'worst' ? 'najlosiji ukupno' : lens]);
    if (score < STRONG_SCORE) continue;
    items.push({
      key: `lens-${lens}`,
      group: 'actions',
      title: `Sočivo: ${label}`,
      subtitle: lens === 'worst' ? 'Boje prema najlošijem polutantu stanice' : `Boje mape, tabele i toplotnih mapa prema ${label}`,
      action: { type: 'lens', lens },
      view: null,
      highlight: highlightRange(`Sočivo: ${label}`, context.query),
      current: lens === context.lens,
      score,
    });
  }
  const themeTitle = context.theme === 'dark' ? 'Svetla tema' : 'Tamna tema';
  const themeScore = bestScore(q, [themeTitle, 'tema boje izgled svetla tamna']);
  if (themeScore >= STRONG_SCORE)
    items.push({
      key: 'theme',
      group: 'actions',
      title: themeTitle,
      subtitle: 'Promeni temu prikaza',
      action: { type: 'theme' },
      view: null,
      highlight: highlightRange(themeTitle, context.query),
      score: themeScore,
    });
  const refreshScore = bestScore(q, ['Osveži podatke', 'sinhronizacija sepa azuriraj']);
  if (refreshScore >= STRONG_SCORE)
    items.push({
      key: 'refresh',
      group: 'actions',
      title: 'Osveži podatke',
      subtitle: 'Preuzmi najnovija merenja sa SEPA',
      action: { type: 'refresh' },
      view: null,
      highlight: highlightRange('Osveži podatke', context.query),
      score: refreshScore,
    });
  return items.sort((a, b) => b.score - a.score);
}

/**
 * Grupe rezultata. Bez upita: nedavno otvorene, stranice, filteri, sve stanice (abecedno).
 * Sa upitom: stanice (najbolje poklapanje prvo), filteri i prikaz, stranice.
 */
export function paletteResults(context: PaletteContext): PaletteGroup[] {
  const q = normalizeText(context.query);
  const groups: PaletteGroup[] = [];
  const push = (key: PaletteGroupKey, items: PaletteItem[]) => {
    if (items.length) groups.push({ key, label: GROUP_LABELS[key], items });
  };
  if (!q) {
    const byId = new Map(context.views.map((view) => [view.id, view]));
    const recent = context.recentIds
      .map((id) => byId.get(id))
      .filter((view): view is StationView => Boolean(view))
      .slice(0, MAX_RECENT)
      .map((view): PaletteItem => {
        const okrug = okrugOf(view);
        return {
          key: `recent-${view.id}`,
          group: 'recent',
          title: view.station.name,
          subtitle: [view.station.code, view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · '),
          action: { type: 'station', stationId: view.id },
          view,
          highlight: null,
          score: 1,
        };
      });
    push('recent', recent);
    push('pages', pageItems(context));
    push('actions', actionItems(context));
    push('stations', stationItems(context));
    return groups;
  }
  const stations = stationItems(context);
  const actions = actionItems(context);
  const pages = pageItems(context);
  // Rasuta poklapanja stanica (slova redom) samo kad nijedna druga grupa nema pravo poklapanje.
  const looseStations = stations.length > 0 && stations.every((item) => item.score < STRONG_SCORE);
  push('stations', looseStations && (actions.length > 0 || pages.length > 0) ? [] : stations);
  push('actions', actions);
  push('pages', pages);
  return groups;
}

/** Ravna lista opcija (redosled navigacije strelicama). */
export function flattenGroups(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((group) => group.items);
}

/** Dodaje stanicu na početak liste nedavno otvorenih (bez duplikata, najviše `limit`). */
export function pushRecent(recent: string[], stationId: string, limit = 6): string[] {
  return [stationId, ...recent.filter((id) => id !== stationId)].slice(0, limit);
}
