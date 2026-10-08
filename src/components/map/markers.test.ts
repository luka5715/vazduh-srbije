import { describe, expect, it } from 'vitest';

import type { CategoryRank, Parameter } from '@shared/aqi';
import type { SnapshotValues, StationRecord, StationSnapshotRecord } from '@shared/contracts';

import { buildDemoCore } from '@/demo/fixture';
import { createProjection, SERBIA_BBOX } from '@/lib/geo';
import { okrugOf } from '@/lib/insights';
import { buildStationViews, type StationView } from '@/lib/stations';

import { districtBounds, FOCUS_MIN_KM, FOCUS_PADDING, mapFrame, mapGeometry, unitsToKm } from './geometry';
import {
  buildMarkers,
  buildMarks,
  CLUSTER_DISC_PX,
  CLUSTER_MIN,
  CLUSTER_SHIFT_KM,
  clusterNote,
  LABEL_GAP_PX,
  LABEL_MARGIN_PX,
  LABEL_STEPS_PX,
  labelCandidates,
  labelPlacement,
  MARKER_DOT_PX,
  MARKER_GAP_PX,
  markerCategoryLabel,
  markerSpacing,
  markInFrame,
  MIN_MARKER_DISTANCE,
  neighborInDirection,
  spacingNote,
  summarizeMarkers,
  type LabelFrame,
  type MapCluster,
  type MapMark,
} from './markers';

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

describe('razmak tačaka iz piksela (markerSpacing)', () => {
  it('prečnik tačke + 2 px preračunat u jedinice okvira; bez mere rezervni razmak', () => {
    // Puna mapa na telefonu (okvir 600 jedinica na 326 px): 14 px → 25,8 jedinica.
    expect(markerSpacing(600, 326, MARKER_DOT_PX.full)).toBeCloseTo(((MARKER_DOT_PX.full + MARKER_GAP_PX) * 600) / 326, 6);
    // Šira mapa → manji razmak u jedinicama (tačke se manje pomeraju sa pravog mesta).
    expect(markerSpacing(600, 700)).toBeLessThan(markerSpacing(600, 344));
    expect(markerSpacing(600, 0)).toBe(MIN_MARKER_DISTANCE);
    expect(markerSpacing(0, 300)).toBe(MIN_MARKER_DISTANCE);
  });

  it('natpis legende: gornja granica u celim km, ničega kad ništa nije pomereno', () => {
    expect(spacingNote(0)).toBeNull();
    expect(spacingNote(0.01)).toBeNull();
    expect(spacingNote(0.4)).toBe('Preklopljene stanice su razmaknute (do 1 km).');
    expect(spacingNote(12.2)).toBe('Preklopljene stanice su razmaknute (do 13 km).');
  });
});

describe('gust skup kao Beograd (9 stanica unutar 12 km)', () => {
  // Izmišljene koordinate po uzoru na beogradsku mrežu: sve u krugu od ~12 km.
  const belgrade = make([
    { id: 'sg', name: 'Beograd Stari grad', municipality: 'Stari grad', lat: 44.818, lon: 20.46, values: { PM10: at(30, 1) }, category: 1 },
    { id: 'vr', name: 'Beograd Vračar', municipality: 'Vračar', lat: 44.797, lon: 20.472, values: { PM10: at(35, 1) }, category: 1 },
    { id: 'nb', name: 'Beograd Novi Beograd', municipality: 'Novi Beograd', lat: 44.812, lon: 20.405, values: { PM10: at(40, 1) }, category: 1 },
    { id: 'ze', name: 'Beograd Zemun', municipality: 'Zemun', lat: 44.845, lon: 20.405, values: { PM10: at(20, 0) }, category: 0 },
    { id: 'mo', name: 'Beograd Mostar', municipality: 'Savski venac', lat: 44.802, lon: 20.455, values: { PM10: at(60, 2) }, category: 2 },
    { id: 'zb', name: 'Beograd Zeleno brdo', municipality: 'Zvezdara', lat: 44.78, lon: 20.5, values: { PM10: at(25, 1) }, category: 1 },
    { id: 'pm', name: 'Beograd Pančevački most', municipality: 'Palilula', lat: 44.823, lon: 20.49, values: { PM10: at(45, 1) }, category: 1 },
    { id: 'bo', name: 'Beograd Borča', municipality: 'Palilula', lat: 44.87, lon: 20.45, values: { PM10: at(15, 0) }, category: 0 },
    { id: 'ov', name: 'Beograd Ovča', municipality: 'Palilula', lat: 44.87, lon: 20.53, values: { PM10: at(18, 0) }, category: 0 },
  ]);
  const geometry = mapGeometry();
  const km = (units: number) => unitsToKm(geometry, units);

  function check(widthPx: number, dotPx: number) {
    const minDistance = markerSpacing(geometry.projection.width, widthPx, dotPx);
    const markers = buildMarkers(belgrade, geometry.projection, { lens: 'worst', minDistance });
    expect(markers).toHaveLength(9);
    for (let i = 0; i < markers.length; i++)
      for (let j = i + 1; j < markers.length; j++)
        expect(Math.hypot(markers[i].x - markers[j].x, markers[i].y - markers[j].y)).toBeGreaterThanOrEqual(minDistance - 0.05);
    const summary = summarizeMarkers(markers);
    expect(summary.maxShift).toBeCloseTo(Math.max(...markers.map((marker) => marker.shift)), 6);
    return { markers, maxShiftKm: km(summary.maxShift), minDistance };
  }

  it('sve stanice su u krugu od 12 km (uzorak je gust kao prava mreža)', () => {
    const points = belgrade.map((view) => geometry.projection.project(view.position!.lon, view.position!.lat));
    let maxPair = 0;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) maxPair = Math.max(maxPair, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    expect(km(maxPair)).toBeLessThan(12);
  });

  it('puna mapa na desktopu (344 px): nijedan par se ne preklapa, a najveći pomak je ≤ 21 km', () => {
    const { maxShiftKm, minDistance } = check(344, MARKER_DOT_PX.full);
    expect(km(minDistance)).toBeCloseTo(14.1, 0);
    expect(maxShiftKm).toBeLessThanOrEqual(21);
    // Rezervni razmak (30 jedinica, okvir neizmeren): opruga drži pomak ispod 26 km; samo odbijanje
    // (stari algoritam) je isti skup širilo preko 33 km.
    const fallback = summarizeMarkers(buildMarkers(belgrade, geometry.projection, { lens: 'worst' }));
    expect(km(fallback.maxShift)).toBeLessThan(26);
  });

  it('širi okvir pomera manje: 2xl desktop (420 px) ≤ 15 km, velika mapa (700 px) ≤ 8 km', () => {
    expect(check(420, MARKER_DOT_PX.full).maxShiftKm).toBeLessThanOrEqual(15);
    expect(check(700, MARKER_DOT_PX.full).maxShiftKm).toBeLessThanOrEqual(8);
  });

  it('telefon (326 px) ≤ 20 km; kompaktni pregled (280 px, tačka 9 px) ≤ 21 km', () => {
    expect(check(326, MARKER_DOT_PX.full).maxShiftKm).toBeLessThanOrEqual(20);
    expect(check(280, MARKER_DOT_PX.compact).maxShiftKm).toBeLessThanOrEqual(21);
  });

  it('usamljena stanica daleko od skupa ostaje tačno na mestu (pomak 0)', () => {
    const withNis = make([
      { id: 'nis', name: 'Niš', municipality: 'Niš', lat: 43.32, lon: 21.9, values: { PM10: at(30, 1) }, category: 1 },
      { id: 'sg', name: 'Beograd Stari grad', municipality: 'Stari grad', lat: 44.818, lon: 20.46, values: { PM10: at(30, 1) }, category: 1 },
      { id: 'vr', name: 'Beograd Vračar', municipality: 'Vračar', lat: 44.797, lon: 20.472, values: { PM10: at(35, 1) }, category: 1 },
    ]);
    const markers = buildMarkers(withNis, geometry.projection, { lens: 'worst', minDistance: markerSpacing(600, 344) });
    expect(markers.find((marker) => marker.id === 'nis')!.shift).toBe(0);
    expect(markers.find((marker) => marker.id === 'sg')!.shift).toBeGreaterThan(0);
    expect(summarizeMarkers(markers).maxShift).toBeGreaterThan(0);
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

  it('jedinice okvira → km: ceo stepen širine je 111,2 km', () => {
    const geometry = mapGeometry();
    expect(unitsToKm(geometry, geometry.unitsPerLat)).toBeCloseTo(111.2, 6);
    expect(unitsToKm(geometry, 0)).toBe(0);
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

describe('uvećan okrug (districtBounds + mapFrame sa fokusom)', () => {
  const geometry = mapGeometry();
  const km = (units: number) => unitsToKm(geometry, units);

  it('pravougaonik Grada Beograda je projekcija lon 19,97–20,84 / lat 44,24–45,08; nepoznat okrug → null', () => {
    const bounds = districtBounds(geometry, 'Grad Beograd')!;
    const [west, north] = geometry.projection.project(19.967, 45.08);
    const [east, south] = geometry.projection.project(20.839, 44.243);
    expect(bounds.x).toBeCloseTo(west, 0);
    expect(bounds.y).toBeCloseTo(north, 0);
    expect(bounds.x + bounds.w).toBeCloseTo(east, 0);
    expect(bounds.y + bounds.h).toBeCloseTo(south, 0);
    // ≈ 69 × 93 km – grad je viši nego širi.
    expect(km(bounds.w)).toBeGreaterThan(60);
    expect(km(bounds.w)).toBeLessThan(80);
    expect(km(bounds.h)).toBeGreaterThan(85);
    expect(km(bounds.h)).toBeLessThan(100);
    expect(districtBounds(geometry, 'Nepostojeći okrug')).toBeNull();
  });

  it('fokusiran okvir: ivica 12 % oko okruga, odnos strana kontejnera, okrug u sredini i ceo unutra', () => {
    const focus = districtBounds(geometry, 'Grad Beograd')!;
    const frame = mapFrame(geometry, 343, 650, focus);
    expect(frame.vb.w / frame.vb.h).toBeCloseTo(343 / 650, 5);
    // Širina je vezujuća osa (kontejner je viši nego okrug): tačno okrug + 2 × 12 %.
    expect(frame.vb.w).toBeCloseTo(focus.w * (1 + 2 * FOCUS_PADDING), 5);
    expect(frame.vb.x + frame.vb.w / 2).toBeCloseTo(focus.x + focus.w / 2, 5);
    expect(frame.vb.y + frame.vb.h / 2).toBeCloseTo(focus.y + focus.h / 2, 5);
    expect(frame.vb.x).toBeLessThan(focus.x);
    expect(frame.vb.y).toBeLessThan(focus.y);
    expect(frame.vb.x + frame.vb.w).toBeGreaterThan(focus.x + focus.w);
    expect(frame.vb.y + frame.vb.h).toBeGreaterThan(focus.y + focus.h);
    // Uvećanje ≈ 4× u odnosu na celu zemlju (600 jedinica).
    expect(geometry.projection.width / frame.vb.w).toBeCloseTo(4, 0);
    // Širok kontejner: visina je vezujuća, širina se proširuje.
    const wide = mapFrame(geometry, 700, 560, focus);
    expect(wide.vb.h).toBeCloseTo(focus.h * (1 + 2 * FOCUS_PADDING), 5);
    expect(wide.vb.w / wide.vb.h).toBeCloseTo(700 / 560, 5);
    // Bez mere kontejnera: odnos strana zemlje.
    expect(mapFrame(geometry, 0, 0, focus).vb.w / mapFrame(geometry, 0, 0, focus).vb.h).toBeCloseTo(geometry.aspect, 5);
  });

  it('mali okrug (Podunavski, ~35 km širok) dobija okvir od bar 60 km, da se vide susedi', () => {
    const focus = districtBounds(geometry, 'Podunavski okrug')!;
    expect(km(focus.w)).toBeLessThan(45);
    const frame = mapFrame(geometry, 300, 300, focus);
    expect(km(frame.vb.w)).toBeGreaterThanOrEqual(FOCUS_MIN_KM - 1e-6);
    expect(km(frame.vb.h)).toBeGreaterThanOrEqual(FOCUS_MIN_KM - 1e-6);
  });

  it('uvećan okvir: mreža na pola stepena („44,5°“) i razmernik 20 km (≤ 35 % širine); cela mapa ostaje na 1° i 50 km', () => {
    const frame = mapFrame(geometry, 343, 650, districtBounds(geometry, 'Grad Beograd'));
    const labels = frame.graticule.map((line) => line.label);
    expect(labels).toContain('44,5°');
    expect(labels).toContain('45°');
    expect(labels).toContain('20,5°');
    expect(frame.graticule.filter((line) => line.axis === 'lon').map((line) => line.label)).toEqual(['20°', '20,5°']);
    for (const line of frame.graticule) {
      expect(line.pct).toBeGreaterThanOrEqual(0);
      expect(line.pct).toBeLessThanOrEqual(100);
    }
    expect(frame.scaleBarKm).toBe(20);
    expect(frame.scaleBarPct).toBeLessThanOrEqual(35);
    expect(frame.scaleBarPct).toBeGreaterThan(20);
    // 50 km bi bilo 58 % širine – ne staje; 20 km je prva koja staje.
    expect(((50 / 20) * frame.scaleBarPct)).toBeGreaterThan(35);
    const base = mapFrame(geometry, 343, 650);
    expect(base.scaleBarKm).toBe(50);
    expect(base.graticule.every((line) => !line.label.includes(','))).toBe(true);
    expect(mapGeometry().graticule.every((line) => !line.label.includes(','))).toBe(true);
    // Najmanji okvir (60 km) i dalje nosi 20 km (33 % širine); 10 i 5 km su rezerva za manje okvire.
    const small = mapFrame(geometry, 300, 300, districtBounds(geometry, 'Podunavski okrug'));
    expect(small.scaleBarKm).toBe(20);
    expect(small.scaleBarPct).toBeLessThanOrEqual(35);
    // Visina okruga (~60 km + ivica) je vezujuća, pa je okvir ~74 km širok: 20 km ≈ 27 %.
    expect(small.scaleBarPct).toBeGreaterThan(20);
  });

  it('markInFrame: centar u okviru, uz umanjenje za ivicu', () => {
    const vb = { x: 100, y: 100, w: 200, h: 100 };
    expect(markInFrame({ x: 150, y: 150 }, vb)).toBe(true);
    expect(markInFrame({ x: 99, y: 150 }, vb)).toBe(false);
    expect(markInFrame({ x: 105, y: 150 }, vb, 10)).toBe(false);
    expect(markInFrame({ x: 300, y: 200 }, vb)).toBe(true);
    expect(markInFrame({ x: 300, y: 200 }, vb, 1)).toBe(false);
  });
});

describe('grupe stanica (buildMarks) – 33 izmišljene beogradske stanice (`?demo=beograd`)', () => {
  // Uveče (20:20 po Beogradu): nekoliko stanica je „Zagađen“, pa grupa ima oreol.
  const EVENING = new Date('2026-10-07T18:20:00Z');
  const core = buildDemoCore(EVENING, 'beograd');
  const views = buildStationViews(core.stations, core.snapshots, EVENING);
  const geometry = mapGeometry();
  const { projection } = geometry;
  const km = (units: number) => unitsToKm(geometry, units);
  const belgrade = views.filter((view) => okrugOf(view) === 'Grad Beograd');
  const clustersOf = (marks: ReturnType<typeof buildMarks>) => marks.filter((mark): mark is MapCluster => mark.type === 'cluster');
  const focus = districtBounds(geometry, 'Grad Beograd')!;

  it('fixture: 33 stanice Grada Beograda među 57', () => {
    expect(views).toHaveLength(57);
    expect(belgrade).toHaveLength(33);
  });

  it('cela mapa (343 px): bez grupisanja pomak do ~44 km; sa grupisanjem JEDNA grupa „Grad Beograd · 33“ u težištu, nijedna druga', () => {
    const minDistance = markerSpacing(projection.width, 343, MARKER_DOT_PX.full);
    const stage1 = summarizeMarkers(buildMarkers(views, projection, { lens: 'worst', minDistance }));
    expect(km(stage1.maxShift)).toBeGreaterThan(30);
    expect(km(stage1.maxShift)).toBeLessThan(50);

    const marks = buildMarks(views, projection, { lens: 'worst', minDistance });
    const clusters = clustersOf(marks);
    expect(clusters).toHaveLength(1);
    const [cluster] = clusters;
    expect(cluster.id).toBe('cluster:Grad Beograd');
    expect(cluster.okrug).toBe('Grad Beograd');
    expect(cluster.count).toBe(33);
    expect(cluster.members).toHaveLength(33);
    expect(cluster.byRank.reduce((sum, count) => sum + count, 0) + cluster.unranked).toBe(33);
    expect(cluster.byRank[3]).toBeGreaterThan(0);
    expect(cluster.alert).toBe(true);
    expect(cluster.dimmed).toBe(false);
    expect(cluster.rank).toBe(cluster.byRank.indexOf(Math.max(...cluster.byRank)));
    expect(cluster.label).toMatch(/^Grad Beograd · 33 stanice · (Prihvatljiv \d+, )?Umeren \d+, Zagađen \d+ — dodir otvara okrug$/);
    // Težište pravih položaja (grupa nema suseda koji bi je pomerio).
    const points = belgrade.map((view) => projection.project(view.position!.lon, view.position!.lat));
    expect(cluster.x).toBeCloseTo(points.reduce((sum, [x]) => sum + x, 0) / points.length, 3);
    expect(cluster.y).toBeCloseTo(points.reduce((sum, [, y]) => sum + y, 0) / points.length, 3);
    expect(cluster.shift).toBeLessThan(0.01);
    // 24 pojedinačne stanice + grupa; nijedna beogradska nije sama.
    expect(marks).toHaveLength(views.length - 33 + 1);
    expect(marks.some((mark) => mark.type === 'station' && okrugOf(mark.view) === 'Grad Beograd')).toBe(false);
    // Preostale tačke su razmaknute i od grupe (disk 28 px prema tački 12 px).
    const clusterRadius = (minDistance / 2) * (CLUSTER_DISC_PX.full / MARKER_DOT_PX.full);
    for (const mark of marks) {
      if (mark.type === 'cluster') continue;
      expect(Math.hypot(mark.x - cluster.x, mark.y - cluster.y)).toBeGreaterThanOrEqual(clusterRadius + minDistance / 2 - 0.05);
    }
    // Legenda: članovi grupe se broje kao stanice (traka ostaje N/N), napomena imenuje okrug.
    const summary = summarizeMarkers(marks);
    expect(summary.clusters).toEqual([{ okrug: 'Grad Beograd', count: 33 }]);
    expect(summary.clustered).toBe(33);
    expect(summary.byRank.reduce((sum, count) => sum + count, 0)).toBe(views.filter((view) => view.position && !view.stale && view.category).length);
    expect(summary.alert).toBeGreaterThanOrEqual(cluster.byRank[3]);
    expect(summary.maxShift).toBeLessThan(stage1.maxShift);
    expect(clusterNote(summary.clusters)).toBe('Gust okrug (Grad Beograd · 33) je prikazan kao grupa stanica; dodir otvara okrug.');
    expect(clusterNote([])).toBeNull();
    expect(clusterNote([{ okrug: 'Grad Beograd', count: 33 }, { okrug: 'Nišavski okrug', count: 5 }])).toBe(
      'Gusti okruzi (Grad Beograd · 33, Nišavski okrug · 5) su prikazani kao grupe stanica; dodir otvara okrug.',
    );
  });

  it('ista grupa na telefonu (326 px), na 2xl desktopu (420 px) i u kompaktnom pregledu (280 px, tačka 9 px)', () => {
    for (const [widthPx, dotPx] of [[326, MARKER_DOT_PX.full], [420, MARKER_DOT_PX.full], [280, MARKER_DOT_PX.compact]] as const) {
      const marks = buildMarks(views, projection, { lens: 'worst', minDistance: markerSpacing(projection.width, widthPx, dotPx) });
      const clusters = clustersOf(marks);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(33);
    }
  });

  it('uvećan okrug (4×): nema grupe, 33 tačke sa pomakom ≤ 2 km; ostatak zemlje je van okvira, susedi u okviru prigušeni', () => {
    for (const [widthPx, heightPx, dotPx] of [[343, 650, MARKER_DOT_PX.full], [326, 468, MARKER_DOT_PX.full], [280, 400, MARKER_DOT_PX.compact]] as const) {
      const frame = mapFrame(geometry, widthPx, heightPx, focus);
      const minDistance = markerSpacing(frame.vb.w, widthPx, dotPx);
      expect(km(minDistance)).toBeLessThan(4);
      const marks = buildMarks(views, projection, { lens: 'worst', minDistance, okrug: 'Grad Beograd' });
      expect(clustersOf(marks)).toHaveLength(0);
      const own = marks.filter((mark) => mark.type === 'station' && !mark.dimmed);
      expect(own).toHaveLength(33);
      expect(km(Math.max(...marks.map((mark) => mark.shift)))).toBeLessThanOrEqual(2);
      const framed = marks.filter((mark) => markInFrame(mark, frame.vb));
      expect(framed.filter((mark) => !mark.dimmed)).toHaveLength(33);
      expect(framed.length).toBeLessThan(marks.length);
      expect(framed.every((mark) => mark.type === 'station')).toBe(true);
    }
  });

  it('izabrani okrug se ne grupiše ni na celoj mapi (grupa bi otvarala već otvoren okrug)', () => {
    const marks = buildMarks(views, projection, { lens: 'worst', minDistance: markerSpacing(projection.width, 343), okrug: 'Grad Beograd' });
    expect(clustersOf(marks)).toHaveLength(0);
    expect(marks.filter((mark) => !mark.dimmed)).toHaveLength(33);
  });

  it('grupa drugog okruga je prigušena kad je izabran neki drugi (oznaka to kaže)', () => {
    const marks = buildMarks(views, projection, { lens: 'worst', minDistance: markerSpacing(projection.width, 343), okrug: 'Nišavski okrug' });
    const [cluster] = clustersOf(marks);
    expect(cluster.count).toBe(33);
    expect(cluster.dimmed).toBe(true);
    expect(cluster.label).toContain('van izabranog okruga');
    const summary = summarizeMarkers(marks);
    expect(summary.dimmed).toBe(views.filter((view) => view.position).length - 1);
    expect(summary.byRank).toEqual([0, 0, 0, 0, 0, 0].map((_, rank) => (rank === marks.find((mark) => !mark.dimmed)!.rank ? 1 : 0)));
  });

  it('izabrana stanica ostaje u grupi (broj ostaje 33), a grupa nosi izbor i to kaže u oznaci', () => {
    const minDistance = markerSpacing(projection.width, 343);
    const selectedId = belgrade[0].id;
    const marks = buildMarks(views, projection, { lens: 'worst', minDistance, selectedId });
    const [cluster] = clustersOf(marks);
    expect(cluster.count).toBe(33);
    expect(cluster.selected).toBe(true);
    expect(cluster.members.some((member) => member.id === selectedId)).toBe(true);
    expect(marks.some((mark) => mark.id === selectedId)).toBe(false);
    expect(cluster.label).toMatch(/ · sadrži izabranu stanicu — dodir otvara okrug$/);
    // Izbor van grupe: grupa nije izabrana.
    const other = clustersOf(buildMarks(views, projection, { lens: 'worst', minDistance, selectedId: 'demo-station-9009' }))[0];
    expect(other.selected).toBe(false);
    expect(other.label).not.toContain('izabranu');
  });

  it('grupa učestvuje u navigaciji strelicama i u redosledu sever → jug kao i stanice', () => {
    const marks = buildMarks(views, projection, { lens: 'worst', minDistance: markerSpacing(projection.width, 343) });
    const [cluster] = clustersOf(marks);
    const pancevo = marks.find((mark) => mark.type === 'station' && mark.view.station.name === 'Demo stanica Pančevo 1')!;
    // Pančevo je severoistočno od Beograda: strelica „levo“ vodi do grupe.
    expect(neighborInDirection(marks, pancevo.id, 'left')).toBe(cluster.id);
    expect(neighborInDirection(marks, cluster.id, 'right')).toBe(pancevo.id);
    for (let i = 1; i < marks.length; i++) expect(marks[i].yPct).toBeGreaterThanOrEqual(marks[i - 1].yPct);
  });
  describe('natpis izabrane stanice (labelPlacement) na uvećanom okrugu', () => {
    /** Okvir mape u px: desktop 1280 (342×529), telefon 390 (324×465), desktop 1440 (408×587). */
    const SIZES = [
      [342, 529],
      [324, 465],
      [408, 587],
    ] as const;
    /** „Demo stanica Beograd 32 PM10 193“ (208 px) i kraći natpis. */
    const LABELS = [
      { width: 208, height: 23 },
      { width: 150, height: 23 },
    ];
    const framed = (widthPx: number, heightPx: number) => {
      const frame = mapFrame(geometry, widthPx, heightPx, focus);
      const minDistance = markerSpacing(frame.vb.w, widthPx, MARKER_DOT_PX.full);
      const marks = buildMarks(views, projection, { lens: 'worst', minDistance, okrug: 'Grad Beograd' }).filter((mark) => markInFrame(mark, frame.vb, 18 * (frame.vb.w / widthPx)));
      const labelFrame: LabelFrame = { vb: frame.vb, width: widthPx, height: heightPx };
      const px = (mark: Pick<MapMark, 'x' | 'y'>) => ({ x: ((mark.x - frame.vb.x) / frame.vb.w) * widthPx, y: ((mark.y - frame.vb.y) / frame.vb.h) * heightPx });
      return { marks, labelFrame, px };
    };

    it.each(SIZES)('okvir %i×%i: za svaku od 33 stanica natpis ne skriva nijednu drugu oznaku, ceo je u okviru, odmaknut najviše 32 px i najbolji među kandidatima', (widthPx, heightPx) => {
      const { marks, labelFrame, px } = framed(widthPx, heightPx);
      const own = marks.filter((mark) => mark.type === 'station' && !mark.dimmed);
      expect(own).toHaveLength(33);
      let attached = 0;
      let oldRuleHidden = 0;
      for (const selected of own) {
        for (const label of LABELS) {
          const candidates = labelCandidates(marks, selected, labelFrame, label, LABEL_GAP_PX.station);
          const best = labelPlacement(marks, selected, labelFrame, label, LABEL_GAP_PX.station);
          expect(candidates).toHaveLength(4 * 3 * LABEL_STEPS_PX.length);
          expect(best).toEqual(candidates[0]);
          expect(best.fits).toBe(true);
          expect(best.hidden).toBe(0);
          expect(best.distance).toBeLessThanOrEqual(32);
          // Najmanji odmak među položajima bez skrivenih tačaka.
          expect(best.distance).toBe(Math.min(...candidates.filter((candidate) => candidate.fits && candidate.hidden === 0).map((candidate) => candidate.distance)));
          // Nezavisna provera: natpis je u okviru i nijedan centar druge oznake nije pod njim.
          const right = best.left + label.width;
          const bottom = best.top + label.height;
          expect(best.left).toBeGreaterThanOrEqual(LABEL_MARGIN_PX);
          expect(best.top).toBeGreaterThanOrEqual(LABEL_MARGIN_PX);
          expect(right).toBeLessThanOrEqual(widthPx - LABEL_MARGIN_PX);
          expect(bottom).toBeLessThanOrEqual(heightPx - LABEL_MARGIN_PX);
          for (const other of marks) {
            if (other.id === selected.id) continue;
            const point = px(other);
            expect(point.x > best.left && point.x < right && point.y > best.top && point.y < bottom).toBe(false);
          }
          const a = px(selected);
          if (best.distance === 0) {
            attached++;
            expect(best.leader).toBeNull();
            // Uz oznaku: bliža ivica natpisa je tačno na razmaku od centra.
            if (best.side === 'right') expect(best.left).toBeCloseTo(a.x + LABEL_GAP_PX.station, 6);
            else if (best.side === 'left') expect(right).toBeCloseTo(a.x - LABEL_GAP_PX.station, 6);
            else if (best.side === 'above') expect(bottom).toBeCloseTo(a.y - LABEL_GAP_PX.station, 6);
            else expect(best.top).toBeCloseTo(a.y + LABEL_GAP_PX.station, 6);
          } else {
            // Odmaknut: spojnica od centra oznake do bliže ivice natpisa.
            const { from, to } = best.leader!;
            expect(from.x).toBeCloseTo(a.x, 6);
            expect(from.y).toBeCloseTo(a.y, 6);
            if (best.side === 'right') expect(to.x).toBeCloseTo(best.left, 6);
            else if (best.side === 'left') expect(to.x).toBeCloseTo(right, 6);
            else if (best.side === 'above') expect(to.y).toBeCloseTo(bottom, 6);
            else expect(to.y).toBeCloseTo(best.top, 6);
            expect(to.x).toBeGreaterThanOrEqual(best.left);
            expect(to.x).toBeLessThanOrEqual(right);
            expect(to.y).toBeGreaterThanOrEqual(best.top);
            expect(to.y).toBeLessThanOrEqual(bottom);
          }
          // Dosadašnje pravilo (strana samo po polovini okvira, uz tačku) bi skrivalo tačke.
          const oldSide = a.x <= widthPx / 2 ? 'right' : 'left';
          oldRuleHidden += candidates.find((candidate) => candidate.side === oldSide && candidate.align === 'center' && candidate.distance === 0)!.hidden;
        }
      }
      // Bar trećina natpisa ostaje uz samu tačku (bez spojnice); staro pravilo bi skrilo desetine tačaka.
      expect(attached).toBeGreaterThanOrEqual((own.length * LABELS.length) / 3);
      expect(oldRuleHidden).toBeGreaterThan(50);
    });
  });
});

describe('natpis izabrane stanice – pravila (labelCandidates)', () => {
  /** Osnovni okvir (cela zemlja) na `widthPx`; tačke zadate u px okvira. */
  const setup = (widthPx: number, points: Array<[id: string, xPx: number, yPx: number, type?: MapMark['type']]>) => {
    const units = 600 / widthPx;
    const frame: LabelFrame = { vb: { x: 0, y: 0, w: 600, h: (projection.height * widthPx) / 600 / (widthPx / 600) }, width: widthPx, height: (projection.height * widthPx) / 600 };
    const marks = points.map(([id, x, y, type = 'station']) => ({ id, type, x: x * units, y: y * units }));
    return { frame, marks };
  };
  const label = { width: 180, height: 23 };

  it('bez prepreka važi dosadašnje pravilo: desno u levoj polovini, levo u desnoj; natpis uz oznaku, bez spojnice', () => {
    const { frame, marks } = setup(343, [
      ['a', 60, 200],
      ['b', 300, 200],
    ]);
    const a = labelPlacement(marks, marks[0], frame, label, LABEL_GAP_PX.station);
    expect(a).toMatchObject({ side: 'right', align: 'center', distance: 0, fits: true, hidden: 0, touched: 0, leader: null });
    expect(a.left).toBeCloseTo(60 + LABEL_GAP_PX.station, 6);
    expect(a.top).toBeCloseTo(200 - label.height / 2, 6);
    const b = labelPlacement(marks, marks[1], frame, label, LABEL_GAP_PX.station);
    expect(b).toMatchObject({ side: 'left', align: 'center', distance: 0, fits: true });
    expect(b.left + label.width).toBeCloseTo(300 - LABEL_GAP_PX.station, 6);
  });

  it('natpis ne izlazi iz okvira: uz desnu ivicu ide levo, uz gornju ivicu ostaje u okviru (ne iznad)', () => {
    const { frame, marks } = setup(343, [
      ['edge', 335, 200],
      ['top', 60, 4],
    ]);
    const edge = labelPlacement(marks, marks[0], frame, label, LABEL_GAP_PX.station);
    expect(edge.side).toBe('left');
    expect(edge.fits).toBe(true);
    expect(edge.maxWidth).toBe(260);
    const top = labelPlacement(marks, marks[1], frame, label, LABEL_GAP_PX.station);
    expect(top.side).not.toBe('above');
    expect(top.fits).toBe(true);
    expect(top.top).toBeGreaterThanOrEqual(LABEL_MARGIN_PX);
  });

  it('skrivena oznaka je gora od dodirnute, a dodirnuta od slobodne strane; disk grupe je prepreka (natpis grupe ne ide preko susedne grupe)', () => {
    // Okvir od 600 px (obe strane staju). Grupa B 15 px istočno od grupe A: natpis desno bi dodirnuo
    // njen disk (poluprečnik 16 px) → ide levo iako je A u levoj polovini.
    const { frame, marks } = setup(600, [
      ['A', 300, 250, 'cluster'],
      ['B', 315, 250, 'cluster'],
    ]);
    const best = labelPlacement(marks, marks[0], frame, label, LABEL_GAP_PX.cluster);
    expect(best).toMatchObject({ side: 'left', align: 'center', distance: 0, hidden: 0, touched: 0 });
    const right = labelCandidates(marks, marks[0], frame, label, LABEL_GAP_PX.cluster).find((candidate) => candidate.side === 'right' && candidate.align === 'center' && candidate.distance === 0)!;
    expect(right).toMatchObject({ fits: true, hidden: 0, touched: 1 });
    // Tačka pod natpisom desno (1 skrivena), dve pod natpisom levo (2 skrivene), ništa iznad/ispod: bira
    // se strana bez skrivenih, a među stranama sa skrivenima desno (1) je bolje od levo (2).
    const dense = setup(600, [
      ['s', 300, 250],
      ['r1', 360, 250],
      ['l1', 230, 250],
      ['l2', 210, 250],
      ['u1', 300, 190],
      ['d1', 300, 310],
    ]);
    const candidates = labelCandidates(dense.marks, dense.marks[0], dense.frame, label, LABEL_GAP_PX.station).filter((candidate) => candidate.distance === 0 && candidate.align === 'center');
    expect(candidates.find((candidate) => candidate.side === 'right')!.hidden).toBe(1);
    expect(candidates.find((candidate) => candidate.side === 'left')!.hidden).toBe(2);
    expect(candidates.find((candidate) => candidate.side === 'above')!.hidden).toBe(0);
    expect(candidates.indexOf(candidates.find((candidate) => candidate.side === 'right')!)).toBeLessThan(candidates.indexOf(candidates.find((candidate) => candidate.side === 'left')!));
    expect(labelPlacement(dense.marks, dense.marks[0], dense.frame, label, LABEL_GAP_PX.station)).toMatchObject({ side: 'above', hidden: 0, distance: 0 });
  });

  it('kad uz oznaku svaki položaj skriva tačke, natpis se odmiče najmanje koliko treba, sa spojnicom do bliže ivice', () => {
    // Redovi tačaka kroz centar i 28 px iznad/ispod (pojasevi natpisa uz oznaku), 300 px široki.
    const points: Array<[string, number, number]> = [['s', 171, 250]];
    for (let x = 20; x <= 320; x += 10) for (const y of [222, 250, 278]) points.push([`p${x}-${y}`, x, y]);
    const { frame, marks } = setup(343, points);
    const best = labelPlacement(marks, marks[0], frame, label, LABEL_GAP_PX.station);
    expect(best.hidden).toBe(0);
    expect(best.distance).toBe(16);
    expect(['above', 'below']).toContain(best.side);
    expect(best.leader).not.toBeNull();
    expect(best.leader!.from).toEqual({ x: 171, y: 250 });
    expect(best.leader!.to.x).toBe(171);
    expect(best.leader!.to.y).toBeCloseTo(best.side === 'above' ? best.top + label.height : best.top, 6);
    // Uz oznaku bi svaka strana skrila tačke.
    for (const candidate of labelCandidates(marks, marks[0], frame, label, LABEL_GAP_PX.station).filter((candidate) => candidate.distance === 0)) expect(candidate.hidden).toBeGreaterThan(0);
  });

  it('preširok natpis za okvir: ne staje nigde, pa se skraćuje do ivice (maxWidth < širine) i ostaje u okviru', () => {
    const { frame, marks } = setup(200, [['s', 100, 150]]);
    const best = labelPlacement(marks, marks[0], frame, { width: 260, height: 23 }, LABEL_GAP_PX.station);
    expect(best.fits).toBe(false);
    expect(best.maxWidth).toBeLessThanOrEqual(200 - 2 * LABEL_MARGIN_PX);
    expect(best.maxWidth).toBeGreaterThanOrEqual(48);
    expect(best.left).toBeGreaterThanOrEqual(LABEL_MARGIN_PX);
    expect(best.left + best.maxWidth).toBeLessThanOrEqual(200 - LABEL_MARGIN_PX + 1e-6);
  });

});

describe('grupe stanica – pravilo praga', () => {
  const geometry = mapGeometry();
  const { projection } = geometry;
  const serbia = markerSpacing(projection.width, 343);

  it('okrug sa dve stanice na istoj tački se nikad ne grupiše (najmanje tri)', () => {
    const two = make([
      { id: 'a', name: 'Kraljevo A', municipality: 'Kraljevo', values: { PM10: at(10, 0) } },
      { id: 'b', name: 'Kraljevo B', municipality: 'Kraljevo', values: { PM10: at(10, 0) } },
    ]);
    const marks = buildMarks(two, projection, { lens: 'worst', minDistance: serbia });
    expect(marks.every((mark) => mark.type === 'station')).toBe(true);
    expect(marks).toHaveLength(2);
    expect(CLUSTER_MIN).toBe(3);
  });

  it('tri stanice u centru istog okruga (pomak > 5 km) su grupa sa tri člana, bez oreola kad nijedna nije Zagađen', () => {
    const three = make(['A', 'B', 'C'].map((name) => ({ id: name, name: `Kraljevo ${name}`, municipality: 'Kraljevo', values: { PM10: at(10, 0) }, category: 0 })));
    const marks = buildMarks(three, projection, { lens: 'worst', minDistance: serbia });
    expect(marks).toHaveLength(1);
    const [cluster] = marks;
    expect(cluster.type).toBe('cluster');
    if (cluster.type !== 'cluster') return;
    expect(cluster.okrug).toBe('Raški okrug');
    expect(cluster.count).toBe(3);
    expect(cluster.byRank).toEqual([3, 0, 0, 0, 0, 0]);
    expect(cluster.rank).toBe(0);
    expect(cluster.alert).toBe(false);
    expect(cluster.label).toBe('Raški okrug · 3 stanice · Dobar 3 — dodir otvara okrug');
    expect(summarizeMarkers(marks).byRank).toEqual([3, 0, 0, 0, 0, 0]);
  });

  it('retka mreža (pet stanica okruga 30+ km udaljenih) ostaje pet tačaka – prag je pomak, ne broj', () => {
    const sparse = make([
      { id: 'n1', name: 'Niš', municipality: 'Niš', lat: 43.32, lon: 21.9, values: { PM10: at(10, 0) } },
      { id: 'n2', name: 'Aleksinac', municipality: 'Niš', lat: 43.54, lon: 21.71, values: { PM10: at(10, 0) } },
      { id: 'n3', name: 'Svrljig', municipality: 'Niš', lat: 43.42, lon: 22.12, values: { PM10: at(10, 0) } },
      { id: 'n4', name: 'Gadžin Han', municipality: 'Niš', lat: 43.22, lon: 22.03, values: { PM10: at(10, 0) } },
      { id: 'n5', name: 'Merošina', municipality: 'Niš', lat: 43.28, lon: 21.72, values: { PM10: at(10, 0) } },
    ]);
    const marks = buildMarks(sparse, projection, { lens: 'worst', minDistance: markerSpacing(projection.width, 700) });
    expect(marks).toHaveLength(5);
    expect(marks.every((mark) => mark.type === 'station' && unitsToKm(geometry, mark.shift) <= CLUSTER_SHIFT_KM)).toBe(true);
  });

  it('stanice bez poznatog okruga i članovi bez kategorije: grupa broji „bez kategorije“, nepoznat okrug se ne grupiše', () => {
    const mixed = make([
      { id: 'a', name: 'Kraljevo A', municipality: 'Kraljevo', values: { PM10: at(10, 0) }, category: 0 },
      { id: 'b', name: 'Kraljevo B', municipality: 'Kraljevo', values: { PM10: at(40, 1) }, category: 1, ageHours: 30 },
      { id: 'c', name: 'Kraljevo C', municipality: 'Kraljevo', noSnapshot: true },
      { id: 'd', name: 'Kraljevo D', municipality: 'Kraljevo', values: { PM10: at(130, 3) }, category: 3 },
    ]);
    const marks = buildMarks(mixed, projection, { lens: 'worst', minDistance: serbia });
    const [cluster] = marks;
    expect(cluster.type).toBe('cluster');
    if (cluster.type !== 'cluster') return;
    expect(cluster.count).toBe(4);
    expect(cluster.unranked).toBe(2);
    expect(cluster.byRank).toEqual([1, 0, 0, 1, 0, 0]);
    // Pri jednakom broju lošija kategorija boji grupu.
    expect(cluster.rank).toBe(3);
    expect(cluster.alert).toBe(true);
    expect(cluster.label).toBe('Raški okrug · 4 stanice · Dobar 1, Zagađen 1, bez kategorije 2 — dodir otvara okrug');
    const summary = summarizeMarkers(marks);
    expect(summary.stale).toBe(1);
    expect(summary.none).toBe(1);
    // „Približna lokacija“ je vrsta oznake samo uz kategoriju (zastarela i bez podataka imaju svoje).
    expect(summary.approx).toBe(2);
    expect(summary.alert).toBe(1);
  });
});
