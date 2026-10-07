import { describe, expect, it } from 'vitest';

import { bestScore, matchScore, normalizeText } from '@/lib/search';
import { isViewName, VIEW_META, VIEW_NAMES } from '@/lib/views';

describe('normalizeText', () => {
  it('skida dijakritike i veličinu slova', () => {
    expect(normalizeText('Čačak')).toBe('cacak');
    expect(normalizeText('  Užice   Centar ')).toBe('uzice centar');
    expect(normalizeText('Đurđevo')).toBe('djurdjevo');
    expect(normalizeText('ŠABAC')).toBe('sabac');
  });
});

describe('matchScore', () => {
  it('rangira početak > početak reči > podniz > rasuto > ništa', () => {
    const prefix = matchScore('nis', 'nis izjz');
    const word = matchScore('izjz', 'nis izjz');
    const sub = matchScore('jz', 'nis izjz');
    const fuzzy = matchScore('nsz', 'nis izjz');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(matchScore('xyz', 'nis izjz')).toBe(0);
    expect(matchScore('', 'bilo sta')).toBe(1);
  });

  it('bestScore uzima najbolje polje i normalizuje tekst', () => {
    expect(bestScore('cacak', ['Stanica 1', 'Čačak'])).toBeGreaterThan(90);
    expect(bestScore('zzz', ['Stanica 1', null, undefined])).toBe(0);
    expect(bestScore('beo', [['Beograd', 2]])).toBeGreaterThan(bestScore('beo', ['Beograd']));
  });
});

describe('stranice', () => {
  it('svaka stranica ima opis, a parametar se proverava', () => {
    for (const name of VIEW_NAMES) expect(VIEW_META[name].title.length).toBeGreaterThan(0);
    expect(isViewName('mapa')).toBe(true);
    expect(isViewName('admin')).toBe(false);
    expect(isViewName(null)).toBe(false);
  });
});
