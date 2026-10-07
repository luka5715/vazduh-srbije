/**
 * Stranice aplikacije. Fabric statički hosting nema SPA fallback, pa postoji samo ruta „/“,
 * a stranica se bira parametrom `?view=` (demo: `#/?view=mapa`).
 */

export const VIEW_NAMES = ['pregled', 'mapa', 'stanice', 'trendovi', 'sinhronizacija'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export const DEFAULT_VIEW: ViewName = 'pregled';

export interface ViewMeta {
  name: ViewName;
  /** Naslov stranice (gornja traka, paleta komandi). */
  title: string;
  /** Kratak natpis za donju navigaciju na telefonu. */
  short: string;
  /** Jedna rečenica ispod naslova. */
  description: string;
  /** Dodatne reči za pretragu u paleti komandi. */
  keywords: string;
}

export const VIEW_META: Record<ViewName, ViewMeta> = {
  pregled: {
    name: 'pregled',
    title: 'Pregled',
    short: 'Pregled',
    description: 'Stanje vazduha sada i ritam mreže u poslednja 24 sata.',
    keywords: 'pocetna stanje mreze kpi heroj',
  },
  mapa: {
    name: 'mapa',
    title: 'Mapa',
    short: 'Mapa',
    description: 'Stanice na mapi Srbije i detalji izabrane stanice.',
    keywords: 'karta okruzi stanica detalji',
  },
  stanice: {
    name: 'stanice',
    title: 'Stanice',
    short: 'Stanice',
    description: 'Sve stanice državne mreže sa trenutnim vrednostima.',
    keywords: 'tabela lista pretraga',
  },
  trendovi: {
    name: 'trendovi',
    title: 'Trendovi',
    short: 'Trendovi',
    description: 'Poslednjih 30 dana: kategorije, kalendar i okruzi.',
    keywords: 'istorija 30 dana kalendar okruzi',
  },
  sinhronizacija: {
    name: 'sinhronizacija',
    title: 'Sinhronizacija',
    short: 'Sinhr.',
    description: 'Preuzimanje sa SEPA, dnevnik i izvor podataka.',
    keywords: 'osvezi istorija dnevnik izvor o podacima sepa',
  },
};

export function isViewName(value: unknown): value is ViewName {
  return typeof value === 'string' && (VIEW_NAMES as readonly string[]).includes(value);
}

/**
 * Parametri URL-a koji pripadaju jednoj stranici (pretraga, filter kategorije, redosled …).
 * Pišu se zamenom unosa u istoriji, pa „Nazad“ sa druge stranice vraća stranicu sa njima; pri
 * prelasku na DRUGU stranicu se uklanjaju (link Mape ne nosi pretragu Stanica).
 */
export const PAGE_PARAMS: Record<ViewName, readonly string[]> = {
  pregled: [],
  mapa: [],
  stanice: ['q', 'grupa', 'sort', 'neaktivne'],
  trendovi: [],
  sinhronizacija: [],
};

/** Parametri drugih stranica koje treba ukloniti pri prelasku na `next`. */
export function foreignPageParams(next: ViewName): string[] {
  const own = new Set(PAGE_PARAMS[next]);
  return VIEW_NAMES.flatMap((name) => PAGE_PARAMS[name]).filter((param) => !own.has(param));
}
