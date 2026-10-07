/**
 * SEPA indeks kvaliteta vazduha – zajednička logika za funkcije (server) i frontend.
 *
 * Pragovi su satni (1h) pragovi koje Agencija za zaštitu životne sredine (SEPA)
 * koristi za svoj kratkoročni indeks (vazduh.sepa.gov.rs). Vrednosti su u µg/m³.
 * Ovaj modul NE SME da uvozi Node.js module: koristi ga i browser.
 */

export const PARAMETERS = ['PM10', 'PM2.5', 'NO2', 'SO2', 'O3'] as const;
export type Parameter = (typeof PARAMETERS)[number];

export const UNIT = 'µg/m³';

export const PARAMETER_LABELS: Record<Parameter, string> = {
  PM10: 'PM10',
  'PM2.5': 'PM2.5',
  NO2: 'NO₂',
  SO2: 'SO₂',
  O3: 'O₃',
};

export const PARAMETER_NAMES: Record<Parameter, string> = {
  PM10: 'Suspendovane čestice do 10 µm',
  'PM2.5': 'Suspendovane čestice do 2,5 µm',
  NO2: 'Azot-dioksid',
  SO2: 'Sumpor-dioksid',
  O3: 'Ozon',
};

/**
 * Gornje granice (uključivo) satne vrednosti za kategorije 0–4.
 * Vrednost iznad poslednje granice pripada kategoriji 5.
 */
export const THRESHOLDS_1H: Record<
  Parameter,
  readonly [number, number, number, number, number]
> = {
  SO2: [20, 40, 125, 190, 275],
  PM10: [15, 45, 120, 195, 270],
  O3: [60, 100, 120, 160, 180],
  NO2: [10, 25, 60, 100, 150],
  'PM2.5': [5, 15, 50, 90, 140],
};

export type CategoryRank = 0 | 1 | 2 | 3 | 4 | 5;

export interface Category {
  rank: CategoryRank;
  key: string;
  /** Naziv kategorije po SEPA indeksu (sr-Latn). */
  label: string;
  /** Kratak savet za korisnika. */
  advice: string;
  /** Boja oznake na svetloj pozadini. */
  color: string;
  /** Boja oznake na tamnoj pozadini. */
  colorDark: string;
  /** Boja teksta koji stoji preko `color` / `colorDark`. */
  ink: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    rank: 0,
    key: 'dobar',
    label: 'Dobar',
    advice: 'Vazduh je čist. Uživajte napolju.',
    color: '#2e9e5b',
    colorDark: '#45c074',
    ink: '#06130b',
  },
  {
    rank: 1,
    key: 'prihvatljiv',
    label: 'Prihvatljiv',
    advice: 'Kvalitet vazduha je prihvatljiv za većinu ljudi.',
    color: '#7cb342',
    colorDark: '#9ccc65',
    ink: '#0b1507',
  },
  {
    rank: 2,
    key: 'umeren',
    label: 'Umeren',
    advice: 'Osetljive grupe neka smanje duže naporne aktivnosti napolju.',
    color: '#e0b000',
    colorDark: '#f2c200',
    ink: '#1a1400',
  },
  {
    rank: 3,
    key: 'zagadjen',
    label: 'Zagađen',
    advice: 'Smanjite boravak napolju; osetljive grupe neka ostanu unutra.',
    color: '#ef7d1a',
    colorDark: '#ff9440',
    ink: '#ffffff',
  },
  {
    rank: 4,
    key: 'veoma-zagadjen',
    label: 'Veoma zagađen',
    advice: 'Izbegavajte fizičke aktivnosti napolju.',
    color: '#d13b3b',
    colorDark: '#ef5c5c',
    ink: '#ffffff',
  },
  {
    rank: 5,
    key: 'izuzetno-zagadjen',
    label: 'Izuzetno zagađen',
    advice: 'Ostanite unutra i zatvorite prozore.',
    color: '#7b2c8a',
    colorDark: '#b363c4',
    ink: '#ffffff',
  },
];

export function categoryOf(rank: number): Category {
  const clamped = Math.min(5, Math.max(0, Math.round(rank)));
  return CATEGORIES[clamped];
}

/** Kategorija (0–5) satne vrednosti polutanta prema SEPA pragovima. */
export function classify(parameter: Parameter, value: number): CategoryRank {
  const limits = THRESHOLDS_1H[parameter];
  for (let i = 0; i < limits.length; i++) {
    if (value <= limits[i]) return i as CategoryRank;
  }
  return 5;
}

/**
 * Najgora kategorija među zadatim vrednostima i polutant koji je određuje.
 * Vraća `null` kad nema nijedne vrednosti.
 */
export function worstCategory(
  values: Partial<Record<Parameter, number>>,
): { rank: CategoryRank; dominant: Parameter } | null {
  let best: { rank: CategoryRank; dominant: Parameter; ratio: number } | null = null;
  for (const parameter of PARAMETERS) {
    const value = values[parameter];
    if (value === undefined || value === null || !Number.isFinite(value)) continue;
    const rank = classify(parameter, value);
    // Pri izjednačenim kategorijama pobeđuje polutant bliži sledećem pragu.
    const ratio = value / (THRESHOLDS_1H[parameter][Math.min(rank, 4)] || 1);
    if (!best || rank > best.rank || (rank === best.rank && ratio > best.ratio)) {
      best = { rank, dominant: parameter, ratio };
    }
  }
  return best ? { rank: best.rank, dominant: best.dominant } : null;
}

/** Normalizuje šifru polutanta iz API-ja ('PM2_5', 'pm25', 'PM 2.5' …) u `Parameter`. */
export function normalizeParameter(code: unknown): Parameter | null {
  if (typeof code !== 'string') return null;
  const key = code.toUpperCase().replace(/[\s_-]/g, '').replace('PM2.5', 'PM25');
  switch (key) {
    case 'PM10':
      return 'PM10';
    case 'PM25':
      return 'PM2.5';
    case 'NO2':
      return 'NO2';
    case 'SO2':
      return 'SO2';
    case 'O3':
      return 'O3';
    default:
      return null;
  }
}
