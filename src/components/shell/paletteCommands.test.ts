import { describe, expect, it } from 'vitest';

import type { StationRecord, StationSnapshotRecord } from '@shared/contracts';

import { buildStationViews } from '@/lib/stations';

import { flattenGroups, highlightRange, paletteResults, pushRecent, type PaletteContext } from './paletteCommands';

const NOW = new Date('2026-10-07T09:30:00Z');

function station(id: string, name: string, municipality: string, code: string): StationRecord {
  return { id, sepaId: 1, code, name, municipality, latitude: null, longitude: null, active: true, updatedAt: NOW.toISOString() };
}

function snapshot(id: string, pm10: number): StationSnapshotRecord {
  const t = '2026-10-07T08:00:00Z';
  return {
    id: `snap-${id}`,
    station_id: id,
    observedAt: t,
    category: pm10 > 45 ? 2 : 1,
    dominant: 'PM10',
    valuesJson: JSON.stringify({ PM10: { v: pm10, t, c: pm10 > 45 ? 2 : 1 } }),
    seriesJson: JSON.stringify({ start: '2026-10-06T09:00:00Z', values: { PM10: Array.from({ length: 24 }, () => pm10) } }),
    updatedAt: NOW.toISOString(),
  };
}

const VIEWS = buildStationViews(
  [station('nis', 'Niš IZJZ', 'Niš', 'NI-01'), station('cacak', 'Čačak', 'Čačak', 'CA-01'), station('bor', 'Bor Gradski park', 'Bor', 'BO-02')],
  [snapshot('nis', 60), snapshot('cacak', 30), snapshot('bor', 20)],
  NOW,
);

const base: PaletteContext = {
  query: '',
  views: VIEWS,
  okrugs: ['Borski okrug', 'Moravički okrug', 'Nišavski okrug'],
  okrug: null,
  lens: 'worst',
  view: 'pregled',
  theme: 'dark',
  recentIds: [],
};

describe('highlightRange', () => {
  it('vraća opseg u originalnom tekstu i kad upit nema kvačice', () => {
    expect(highlightRange('Čačak', 'cac')).toEqual([0, 3]);
    expect(highlightRange('Demo stanica Čačak 1', 'CACAK')).toEqual([13, 18]);
    expect(highlightRange('Đurđevo', 'djurdj')).toEqual([0, 4]);
    expect(highlightRange('Niš IZJZ', 'xyz')).toBeNull();
    expect(highlightRange('Niš', '  ')).toBeNull();
  });
});

describe('paletteResults', () => {
  it('bez upita: stranice pa sve stanice abecedno; nedavne na vrhu', () => {
    const groups = paletteResults({ ...base, recentIds: ['bor', 'nepostoji'] });
    expect(groups.map((group) => group.key)).toEqual(['recent', 'pages', 'stations']);
    expect(groups[0].items.map((item) => item.title)).toEqual(['Bor Gradski park']);
    expect(groups[2].items.map((item) => item.title)).toEqual(['Bor Gradski park', 'Čačak', 'Niš IZJZ']);
    expect(groups[1].items.find((item) => item.current)?.title).toBe('Pregled');
  });

  it('aktivni filter okruga se nudi za uklanjanje', () => {
    const groups = paletteResults({ ...base, okrug: 'Nišavski okrug' });
    const action = groups.find((group) => group.key === 'actions')?.items[0];
    expect(action?.action).toEqual({ type: 'okrug', okrug: null });
  });

  it('upit bez kvačica: stanica prva, pa filter okruga', () => {
    const groups = paletteResults({ ...base, query: 'nis' });
    expect(groups[0].key).toBe('stations');
    expect(groups[0].items.map((item) => item.title)).toEqual(['Niš IZJZ']);
    expect(groups[0].items[0].highlight).toEqual([0, 3]);
    const actions = groups.find((group) => group.key === 'actions')?.items ?? [];
    expect(actions.map((item) => item.action)).toContainEqual({ type: 'okrug', okrug: 'Nišavski okrug' });
  });

  it('šifra, opština i okrug kao polja pretrage', () => {
    const titles = (query: string) => (paletteResults({ ...base, query }).find((group) => group.key === 'stations')?.items ?? []).map((item) => item.title);
    expect(titles('bo-02')).toEqual(['Bor Gradski park']);
    expect(titles('moravicki')).toEqual(['Čačak']);
  });

  it('sočivo, tema i osvežavanje kao komande', () => {
    const actions = (query: string) => flattenGroups(paletteResults({ ...base, query })).map((item) => item.action);
    expect(actions('pm10')).toContainEqual({ type: 'lens', lens: 'PM10' });
    // „pm“ rasuto pogađa „Pomoravski“, ali pravo poklapanje sočiva ima prednost.
    expect(paletteResults({ ...base, query: 'pm' }).map((group) => group.key)).toEqual(['actions']);
    expect(actions('tema')).toContainEqual({ type: 'theme' });
    expect(actions('osvezi')).toContainEqual({ type: 'refresh' });
    expect(actions('stanice')).toContainEqual({ type: 'page', view: 'stanice' });
    expect(flattenGroups(paletteResults({ ...base, query: 'qqqq' }))).toHaveLength(0);
  });
});

describe('pushRecent', () => {
  it('stavlja stanicu na početak bez duplikata i skraćuje listu', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });
});
