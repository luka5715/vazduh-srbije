import { describe, expect, it } from 'vitest';

import type { CategoryRank, Parameter } from '@shared/aqi';
import type { SnapshotValues, StationRecord, StationSnapshotRecord } from '@shared/contracts';

import { createProjection, SERBIA_BBOX } from '@/lib/geo';
import { buildStationViews, type StationView } from '@/lib/stations';

import { mapFrame, mapGeometry } from './geometry';
import { buildMarkers, markerCategoryLabel, MIN_MARKER_DISTANCE, neighborInDirection, summarizeMarkers } from './markers';

const NOW = new Date('2026-10-07T09:30:00Z');
const HOUR = 3_600_000;
const projection = createProjection(SERBIA_BBOX, 600, 12);

interface Spec {
  id: string;
  name: string;
  municipality: string;
  lat?: number;
  lon?: number;
  values?: SnapshotValues;
  category?: number;
  dominant?: Parameter;
  ageHours?: number;
  noSnapshot?: boolean;
  inactive?: boolean;
}

function make(specs: Spec[]): StationView[] {
  const stations: StationRecord[] = [];
  const snapshots: StationSnapshotRecord[] = [];
  specs.forEach((spec, index) => {
    stations.push({
      id: spec.id,
      sepaId: index + 1,
      code: `S${index + 1}`,
      name: spec.name,
      municipality: spec.municipality,
      latitude: spec.lat ?? null,
      longitude: spec.lon ?? null,
      active: !spec.inactive,
      updatedAt: NOW.toISOString(),
    });
    if (spec.noSnapshot) return;
    const observedAt = new Date(NOW.getTime() - (spec.ageHours ?? 1) * HOUR).toISOString();
    snapshots.push({
      id: `snap-${spec.id}`,
      station_id: spec.id,
      observedAt,
      category: spec.category ?? 0,
      dominant: spec.dominant ?? 'PM10',
      valuesJson: JSON.stringify(spec.values ?? {}),
      seriesJson: JSON.stringify({ start: new Date(Date.parse(observedAt) - 23 * HOUR).toISOString(), values: {} }),
      updatedAt: NOW.toISOString(),
    });
  });
  return buildStationViews(stations, snapshots, NOW);
}

const at = (v: number, c: CategoryRank) => ({ v, c, t: NOW.toISOString() });

describe('buildMarkers', () => {
  const views = make([
    { id: 'nis', name: 'Niš', municipality: 'Niš', lat: 43.32, lon: 21.9, values: { PM10: at(130, 3), NO2: at(20, 1) }, category: 3 },
    { id: 'kv', name: 'Kraljevo', municipality: 'Kraljevo', values: { PM10: at(30, 1) }, category: 1 },
    { id: 'kv2', name: 'Kraljevo 2', municipality: 'Kraljevo', values: { PM10: at(10, 0) }, category: 0 },
    { id: 'old', name: 'Stara', municipality: 'Niš', lat: 43.5, lon: 21.7, values: { PM10: at(40, 1) }, category: 1, ageHours: 30 },
    { id: 'none', name: 'Bez', municipality: 'Niš', lat: 43.1, lon: 21.5, noSnapshot: true },
    { id: 'nowhere', name: 'Nepoznata', municipality: 'Nema takve opštine', values: { PM10: at(10, 0) } },
  ]);

  it('razvrstava oznake: tačna, približna, zastarela, bez podataka; bez pozicije se izostavlja', () => {
    const markers = buildMarkers(views, projection, { lens: 'worst' });
    const byId = Object.fromEntries(markers.map((m) => [m.id, m]));
    expect(markers).toHaveLength(5);
    expect(byId.nis.kind).toBe('exact');
    expect(byId.nis.rank).toBe(3);
    expect(byId.nis.alert).toBe(true);
    expect(byId.kv.kind).toBe('approx');
    expect(byId.old.kind).toBe('stale');
    expect(byId.old.rank).toBeNull();
    expect(byId.none.kind).toBe('none');
    expect(markerCategoryLabel(byId.old)).toBe('Bez svežih podataka');
  });

  it('boji po sočivu: polutant koji stanica ne meri daje sivu oznaku', () => {
    const markers = buildMarkers(views, projection, { lens: 'NO2' });
    const byId = Object.fromEntries(markers.map((m) => [m.id, m]));
    expect(byId.nis.rank).toBe(1);
    expect(byId.nis.alert).toBe(false);
    expect(byId.kv.kind).toBe('none');
    expect(byId.kv.label).toContain('polutant se ne meri');
  });

  it('razmiče stanice na istoj tački (centar okruga) i ređa ih od severa ka jugu', () => {
    const markers = buildMarkers(views, projection, { lens: 'worst' });
    const kv = markers.find((m) => m.id === 'kv')!;
    const kv2 = markers.find((m) => m.id === 'kv2')!;
    const dx = ((kv.xPct - kv2.xPct) / 100) * projection.width;
    const dy = ((kv.yPct - kv2.yPct) / 100) * projection.height;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(15);
    for (let i = 1; i < markers.length; i++) expect(markers[i].yPct).toBeGreaterThanOrEqual(markers[i - 1].yPct);
  });

  it('gust skup (pet stanica u istom centru okruga + jedna tačna) – nijedan par nije preklopljen', () => {
    const crowd = make([
      ...['A', 'B', 'C', 'D', 'E'].map((name) => ({ id: name, name: `Kraljevo ${name}`, municipality: 'Kraljevo', values: { PM10: at(10, 0) } })),
      { id: 'x', name: 'Tačna', municipality: 'Kraljevo', lat: 43.72, lon: 20.69, values: { PM10: at(10, 0) } },
    ]);
    const markers = buildMarkers(crowd, projection, { lens: 'worst' });
    for (let i = 0; i < markers.length; i++)
      for (let j = i + 1; j < markers.length; j++)
        expect(Math.hypot(markers[i].x - markers[j].x, markers[i].y - markers[j].y)).toBeGreaterThan(MIN_MARKER_DISTANCE - 1);
  });

  it('bliske stanice sa tačnim koordinatama razmiče duž njihove ose (istok ostaje istok)', () => {
    const close = make([
      { id: 'w', name: 'Zapad', municipality: 'Niš', lat: 43.32, lon: 21.9, values: { PM10: at(10, 0) } },
      { id: 'e', name: 'Istok', municipality: 'Niš', lat: 43.32, lon: 21.95, values: { PM10: at(10, 0) } },
    ]);
    const [a, b] = buildMarkers(close, projection, { lens: 'worst' }).sort((m, n) => m.x - n.x);
    expect(a.id).toBe('w');
    expect(b.id).toBe('e');
    expect(b.x - a.x).toBeGreaterThan(25);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1);
  });

  it('prigušuje stanice van izabranog okruga i broji ih posebno u legendi', () => {
    const markers = buildMarkers(views, projection, { lens: 'worst', okrug: 'Raški okrug' });
    const dimmed = markers.filter((m) => m.dimmed).map((m) => m.id).sort();
    expect(dimmed).toEqual(['nis', 'none', 'old']);
    const summary = summarizeMarkers(markers);
    expect(summary.dimmed).toBe(3);
    expect(summary.byRank).toEqual([1, 1, 0, 0, 0, 0]);
    expect(summary.approx).toBe(2);
    expect(summary.stale).toBe(0);
  });
});

describe('mapGeometry', () => {
  it('ima okruge, mrežu stepeni i razmernik od ~50 km', () => {
    const geometry = mapGeometry();
    expect(geometry.districts.length).toBeGreaterThan(20);
    expect(geometry.graticule.some((line) => line.axis === 'lat' && line.label === '44°')).toBe(true);
    expect(geometry.graticule.some((line) => line.axis === 'lon' && line.label === '20°')).toBe(true);
    expect(geometry.scaleBarPct).toBeGreaterThan(5);
    expect(geometry.scaleBarPct).toBeLessThan(30);
  });
});

describe('mapFrame', () => {
  const geometry = mapGeometry();
  const { width, height } = geometry.projection;

  it('bez veličine ili istog odnosa strana vraća osnovni okvir', () => {
    expect(mapFrame(geometry, 0, 0).vb).toEqual({ x: 0, y: 0, w: width, h: height });
    expect(mapFrame(geometry, 300, 300 / geometry.aspect).vb).toEqual({ x: 0, y: 0, w: width, h: height });
  });

  it('viši kontejner proširuje okvir gore i dole, zemlja ostaje u sredini, mreža se nastavlja', () => {
    const frame = mapFrame(geometry, 350, 700);
    expect(frame.vb.w).toBe(width);
    expect(frame.vb.h / frame.vb.w).toBeCloseTo(2, 5);
    expect(frame.vb.y).toBeCloseTo(-(frame.vb.h - height) / 2, 5);
    const lats = frame.graticule.filter((line) => line.axis === 'lat').map((line) => line.label);
    expect(lats.length).toBeGreaterThan(geometry.graticule.filter((line) => line.axis === 'lat').length);
    for (const line of frame.graticule) {
      expect(line.pct).toBeGreaterThanOrEqual(0);
      expect(line.pct).toBeLessThanOrEqual(100);
    }
  });

  it('širi kontejner proširuje okvir levo i desno; razmernik se smanjuje srazmerno', () => {
    const frame = mapFrame(geometry, 800, 560);
    expect(frame.vb.h).toBe(height);
    expect(frame.vb.x).toBeLessThan(0);
    expect(frame.scaleBarPct).toBeCloseTo((geometry.scaleBarPct * width) / frame.vb.w, 5);
  });
});

describe('neighborInDirection', () => {
  // Krst oko centra + jedna dijagonalna tačka.
  const points = [
    { id: 'c', x: 100, y: 100 },
    { id: 'n', x: 102, y: 40 },
    { id: 's', x: 96, y: 170 },
    { id: 'e', x: 160, y: 104 },
    { id: 'w', x: 30, y: 98 },
    { id: 'ne', x: 150, y: 50 },
  ];

  it('bira najbližu tačku u pravcu strelice', () => {
    expect(neighborInDirection(points, 'c', 'up')).toBe('n');
    expect(neighborInDirection(points, 'c', 'down')).toBe('s');
    expect(neighborInDirection(points, 'c', 'right')).toBe('e');
    expect(neighborInDirection(points, 'c', 'left')).toBe('w');
  });

  it('van kupe traži u poluravni, a na ivici vraća null', () => {
    expect(neighborInDirection(points, 'n', 'right')).toBe('ne');
    // Jedina tačka „gore“ je daleko u stranu (van kupe) – i dalje je dostupna.
    expect(neighborInDirection([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: -10 }], 'a', 'up')).toBe('b');
    expect(neighborInDirection(points, 'e', 'right')).toBeNull();
    expect(neighborInDirection(points, 'nepoznat', 'up')).toBe('c');
  });
});

describe('neaktivne stanice na mapi', () => {
  it('oznaka je „zastarela“, a natpis kaže da je stanica neaktivna', () => {
    const views = make([
      { id: 'a', name: 'Aktivna', municipality: 'Niš', lat: 43.32, lon: 21.9, values: { PM10: at(30, 1) }, category: 1 },
      { id: 'b', name: 'Ugašena', municipality: 'Bor', lat: 44.07, lon: 22.1, values: { PM10: at(90, 3) }, category: 3, inactive: true },
    ]);
    const markers = buildMarkers(views, projection, { lens: 'worst' });
    const off = markers.find((marker) => marker.id === 'b')!;
    expect(off.kind).toBe('stale');
    expect(off.rank).toBeNull();
    expect(off.alert).toBe(false);
    expect(off.label).toBe('Ugašena, neaktivna stanica (SEPA ju je ugasila)');
    expect(markerCategoryLabel(off)).toBe('Neaktivna');
    expect(markerCategoryLabel(markers.find((marker) => marker.id === 'a')!)).toBe('Prihvatljiv');
  });
});
