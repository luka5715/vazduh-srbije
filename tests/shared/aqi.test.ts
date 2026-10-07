import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  categoryOf,
  classify,
  normalizeParameter,
  PARAMETERS,
  THRESHOLDS_1H,
  worstCategory,
  type Parameter,
} from '@shared/aqi';

/** SEPA 1-hour thresholds (µg/m³) as published for the national index — the reference table. */
const SEPA_1H: Record<Parameter, readonly [number, number, number, number, number]> = {
  SO2: [20, 40, 125, 190, 275],
  PM10: [15, 45, 120, 195, 270],
  O3: [60, 100, 120, 160, 180],
  NO2: [10, 25, 60, 100, 150],
  'PM2.5': [5, 15, 50, 90, 140],
};

describe('@shared/aqi thresholds', () => {
  it('matches the SEPA 1-hour table exactly for all five parameters', () => {
    expect(THRESHOLDS_1H).toEqual(SEPA_1H);
    expect(PARAMETERS).toEqual(['PM10', 'PM2.5', 'NO2', 'SO2', 'O3']);
  });

  it('thresholds are strictly increasing per parameter', () => {
    for (const parameter of PARAMETERS) {
      const limits = THRESHOLDS_1H[parameter];
      for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeGreaterThan(limits[i - 1]);
    }
  });

  it('has six categories with the SEPA labels in rank order', () => {
    expect(CATEGORIES.map((c) => c.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      'Dobar',
      'Prihvatljiv',
      'Umeren',
      'Zagađen',
      'Veoma zagađen',
      'Izuzetno zagađen',
    ]);
    for (const category of CATEGORIES) {
      expect(category.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(category.colorDark).toMatch(/^#[0-9a-f]{6}$/);
      expect(category.ink).toMatch(/^#[0-9a-f]{6}$/);
      expect(category.advice.length).toBeGreaterThan(5);
    }
  });
});

describe('classify', () => {
  it('treats every boundary as inclusive (value == limit stays in the lower category)', () => {
    for (const parameter of PARAMETERS) {
      const limits = SEPA_1H[parameter];
      limits.forEach((limit, index) => {
        expect(classify(parameter, limit)).toBe(index);
        expect(classify(parameter, limit + 0.1)).toBe(index + 1);
      });
    }
  });

  it('puts zero and tiny values in category 0 and huge values in category 5', () => {
    for (const parameter of PARAMETERS) {
      expect(classify(parameter, 0)).toBe(0);
      expect(classify(parameter, 0.01)).toBe(0);
      expect(classify(parameter, 10_000)).toBe(5);
    }
  });

  it('reproduces the categories recorded in the Niš daily export', () => {
    // (parameter, daily max, category rank) rows from nis-daily-max.json
    const samples: Array<[Parameter, number, number]> = [
      ['PM10', 48.3, 2],
      ['PM10', 44.9, 1],
      ['PM10', 140.6, 3],
      ['PM10', 238.8, 4],
      ['PM2.5', 12.9, 1],
      ['PM2.5', 56.7, 3],
      ['NO2', 103.7, 4],
      ['NO2', 27.9, 2],
      ['SO2', 7.3, 0],
      ['SO2', 39.3, 1],
      ['O3', 123.4, 3],
      ['O3', 90.1, 1],
      ['O3', 112.2, 2],
    ];
    for (const [parameter, value, rank] of samples) expect(classify(parameter, value)).toBe(rank);
  });
});

describe('categoryOf', () => {
  it('clamps and rounds the rank', () => {
    expect(categoryOf(-3).rank).toBe(0);
    expect(categoryOf(2.4).rank).toBe(2);
    expect(categoryOf(2.5).rank).toBe(3);
    expect(categoryOf(99).rank).toBe(5);
    expect(categoryOf(3).label).toBe('Zagađen');
  });
});

describe('worstCategory', () => {
  it('returns null when there are no usable values', () => {
    expect(worstCategory({})).toBeNull();
    expect(worstCategory({ PM10: Number.NaN, NO2: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('picks the parameter with the highest category', () => {
    expect(worstCategory({ PM10: 10, NO2: 70, SO2: 5 })).toEqual({ rank: 3, dominant: 'NO2' });
    expect(worstCategory({ PM10: 300, 'PM2.5': 20 })).toEqual({ rank: 5, dominant: 'PM10' });
  });

  it('breaks ties by closeness to the next threshold (ratio to the category limit)', () => {
    // Both category 2: PM10 100/120 = 0.83 vs NO2 30/60 = 0.5 → PM10 dominates.
    expect(worstCategory({ PM10: 100, NO2: 30 })).toEqual({ rank: 2, dominant: 'PM10' });
    // Both category 2: NO2 59/60 = 0.98 beats PM10 50/120 = 0.42.
    expect(worstCategory({ PM10: 50, NO2: 59 })).toEqual({ rank: 2, dominant: 'NO2' });
  });

  it('keeps the first parameter in PARAMETERS order on an exact ratio tie', () => {
    // PM10 120/120 = 1 and NO2 60/60 = 1, both rank 2 → PM10 comes first in PARAMETERS.
    expect(worstCategory({ PM10: 120, NO2: 60 })).toEqual({ rank: 2, dominant: 'PM10' });
    // Same ratio tie but given in the opposite key order: result must not depend on object order.
    expect(worstCategory({ NO2: 60, PM10: 120 })).toEqual({ rank: 2, dominant: 'PM10' });
  });

  it('in category 5 compares against the top (index 4) threshold', () => {
    // PM10 540/270 = 2.0 vs SO2 600/275 = 2.18 → SO2 dominates.
    expect(worstCategory({ PM10: 540, SO2: 600 })).toEqual({ rank: 5, dominant: 'SO2' });
  });

  it('ignores undefined entries', () => {
    expect(worstCategory({ PM10: undefined, O3: 65 })).toEqual({ rank: 1, dominant: 'O3' });
  });
});

describe('normalizeParameter', () => {
  it('accepts the Kosava parameter codes', () => {
    expect(normalizeParameter('PM10')).toBe('PM10');
    expect(normalizeParameter('PM2.5')).toBe('PM2.5');
    expect(normalizeParameter('NO2')).toBe('NO2');
    expect(normalizeParameter('SO2')).toBe('SO2');
    expect(normalizeParameter('O3')).toBe('O3');
  });

  it('normalises case, spaces, underscores and dashes', () => {
    expect(normalizeParameter('pm10')).toBe('PM10');
    expect(normalizeParameter('PM_10')).toBe('PM10');
    expect(normalizeParameter('PM 10')).toBe('PM10');
    expect(normalizeParameter('PM2_5')).toBe('PM2.5');
    expect(normalizeParameter('pm25')).toBe('PM2.5');
    expect(normalizeParameter('PM 2.5')).toBe('PM2.5');
    expect(normalizeParameter('pm-2.5')).toBe('PM2.5');
    expect(normalizeParameter(' no2 ')).toBe('NO2');
    expect(normalizeParameter('o3')).toBe('O3');
  });

  it('rejects unknown codes and non-strings', () => {
    expect(normalizeParameter('CO')).toBeNull();
    expect(normalizeParameter('PM1')).toBeNull();
    expect(normalizeParameter('C6H6')).toBeNull();
    expect(normalizeParameter('')).toBeNull();
    expect(normalizeParameter(10)).toBeNull();
    expect(normalizeParameter(null)).toBeNull();
    expect(normalizeParameter(undefined)).toBeNull();
    expect(normalizeParameter({ code: 'PM10' })).toBeNull();
  });
});
