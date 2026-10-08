import { classify, THRESHOLDS_1H } from '@shared/aqi';
import { parseSnapshotRecord } from '@shared/aggregate';
import { describe, expect, it } from 'vitest';

import okruzi from '@/data/okruzi.json';
import type { GeoCollection, Ring } from '@/lib/geo';
import { municipalityPosition } from '@/lib/stations';

import { buildDemoCore, buildDemoSyncRuns, buildSpecs, SMOG_PM10_MEDIAN, smogRamp, type DemoCore } from './fixture';

/** Različita doba dana (UTC): oblik epizode ne sme da zavisi od sata u kom se demo otvori. */
const TIMES = ['2026-10-07T02:30:00Z', '2026-10-07T09:10:00Z', '2026-10-07T13:45:00Z', '2026-10-07T18:20:00Z', '2026-10-07T22:05:00Z'];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sveže stanice (snimak u poslednjih 6 h): PM10 i najgora kategorija iz snimka. */
function freshSnapshots(core: DemoCore, now: Date) {
  return core.snapshots
    .filter((snapshot) => now.getTime() - new Date(snapshot.observedAt).getTime() <= 6 * 3_600_000)
    .map((snapshot) => {
      const { values } = parseSnapshotRecord(snapshot);
      return { pm10: values.PM10?.v ?? null, rank: snapshot.category };
    });
}

/** Rastojanje po velikom krugu, km. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Tačka u prstenu poligona (ray casting: paran/neparan broj preseka zraka ka istoku). */
function insideRing(ring: Ring, point: { lat: number; lon: number }): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Najmanje rastojanje tačke od ivice prstena (km, ravna aproksimacija oko tačke). */
function borderDistanceKm(ring: Ring, point: { lat: number; lon: number }): number {
  const kmLat = 111.2;
  const kmLon = kmLat * Math.cos((point.lat * Math.PI) / 180);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const a = { x: (ax - point.lon) * kmLon, y: (ay - point.lat) * kmLat };
    const dx = (bx - point.lon) * kmLon - a.x;
    const dy = (by - point.lat) * kmLat - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return min;
}

describe('demo fixture – podrazumevani skup', () => {
  it('26 stanica, sve jasno označene kao demo; scenario `default` je isti skup', () => {
    const now = new Date(TIMES[0]);
    const core = buildDemoCore(now);
    expect(core.stations).toHaveLength(26);
    for (const station of core.stations) expect(station.name).toMatch(/^Demo stanica /);
    expect(buildDemoCore(now, 'default')).toEqual(core);
    expect(buildDemoSyncRuns(now)[0].stationsSeen).toBe(26);
  });

  it('scenario `late` i `empty` ne menjaju oblik podataka (isti specs)', () => {
    expect(buildSpecs('late')).toEqual(buildSpecs());
    expect(buildSpecs('empty')).toEqual(buildSpecs());
  });
});

describe('scenario `smog` – izmišljena epizoda smoga', () => {
  it('rampa po satima unazad: poslednja 24 h vrhunac, slabije do 96 h, ranije ništa', () => {
    expect(smogRamp(0)).toBe(1);
    expect(smogRamp(23)).toBe(1);
    expect(smogRamp(24)).toBeLessThan(1);
    expect(smogRamp(24)).toBeGreaterThan(smogRamp(48));
    expect(smogRamp(48)).toBeGreaterThan(smogRamp(72));
    expect(smogRamp(72)).toBeGreaterThan(0);
    expect(smogRamp(96)).toBe(0);
    expect(smogRamp(500)).toBe(0);
  });

  it.each(TIMES)('u %s: medijana PM10 svežih stanica ≈ 300 (±20 %), bar 70 % stanica je „Veoma zagađen“ ili „Opasan“', (iso) => {
    const now = new Date(iso);
    const core = buildDemoCore(now, 'smog');
    const fresh = freshSnapshots(core, now);
    expect(fresh.length).toBeGreaterThanOrEqual(24);
    const pm10 = fresh.map((s) => s.pm10).filter((v): v is number => v !== null);
    const med = median(pm10);
    expect(med).toBeGreaterThanOrEqual(SMOG_PM10_MEDIAN * 0.8);
    expect(med).toBeLessThanOrEqual(SMOG_PM10_MEDIAN * 1.2);
    // Medijana je iznad poslednjeg SEPA praga za PM10 → najjača izmaglica.
    expect(med).toBeGreaterThan(THRESHOLDS_1H.PM10[4]);
    expect(classify('PM10', med)).toBe(5);
    const severe = fresh.filter((s) => s.rank >= 4).length;
    expect(severe / fresh.length).toBeGreaterThanOrEqual(0.7);
    // Nije cela mreža ista: ravnica ostaje ispod „Veoma zagađen“ (mešovite kategorije).
    expect(fresh.some((s) => s.rank <= 3)).toBe(true);
  });

  it('isti broj i nazivi stanica kao podrazumevani demo (menja se samo vazduh)', () => {
    const now = new Date(TIMES[1]);
    const smog = buildDemoCore(now, 'smog');
    const base = buildDemoCore(now);
    expect(smog.stations.map((s) => s.name)).toEqual(base.stations.map((s) => s.name));
    const smogMedian = median(freshSnapshots(smog, now).map((s) => s.pm10 ?? 0));
    const baseMedian = median(freshSnapshots(base, now).map((s) => s.pm10 ?? 0));
    expect(smogMedian).toBeGreaterThan(baseMedian * 3);
  });
});

describe('scenario `beograd` – gusta gradska mreža', () => {
  const isBeograd = (name: string) => /^Demo stanica Beograd \d{1,2}$/.test(name);

  it('33 izmišljene beogradske stanice: gust centar (8 u 4,5 km), prsten do 15 km, razmak ≥ 2,2 km, sve u Gradu Beogradu; ostatak mreže nepromenjen', () => {
    const now = new Date(TIMES[3]);
    const core = buildDemoCore(now, 'beograd');
    expect(core.stations).toHaveLength(57);
    const beograd = core.stations.filter((s) => isBeograd(s.name));
    expect(beograd).toHaveLength(33);
    expect(new Set(beograd.map((s) => s.code)).size).toBe(33);
    for (const station of beograd) {
      expect(station.code).toMatch(/^DEMO-\d{3}$/);
      expect(municipalityPosition(station.municipality)?.okrug).toBe('Grad Beograd');
    }
    const centre = { lat: 44.81, lon: 20.46 };
    const points = beograd.map((s) => ({ lat: s.latitude as number, lon: s.longitude as number }));
    const fromCentre = points.map((point) => distanceKm(centre, point));
    expect(fromCentre.filter((d) => d <= 4.5)).toHaveLength(8);
    expect(fromCentre.filter((d) => d > 4.5)).toHaveLength(25);
    expect(Math.max(...fromCentre)).toBeLessThanOrEqual(15);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) expect(distanceKm(points[i], points[j])).toBeGreaterThanOrEqual(2.2);
    }
    // Ostale stanice su iste kao u podrazumevanom demou; dnevnik broji 57 stanica.
    const others = (c: DemoCore) => c.stations.filter((s) => !/Beograd/.test(s.name)).map((s) => s.name);
    expect(others(core)).toEqual(others(buildDemoCore(now)));
    expect(buildDemoSyncRuns(now, core.stations.length)[0].stationsSeen).toBe(57);
  });

  it('sve 33 stanice su unutar granice Grada Beograda iz okruzi.json, bar 1,5 km od nje (uvećan okrug pomera tačku do ~2 km)', () => {
    const feature = (okruzi as GeoCollection).features.find((entry) => entry.properties.name === 'Grad Beograd')!;
    expect(feature.geometry.type).toBe('Polygon');
    const ring = feature.geometry.coordinates[0] as Ring;
    const beograd = buildDemoCore(new Date(TIMES[3]), 'beograd').stations.filter((s) => isBeograd(s.name));
    expect(beograd).toHaveLength(33);
    for (const station of beograd) {
      const point = { lat: station.latitude as number, lon: station.longitude as number };
      expect(insideRing(ring, point), station.name).toBe(true);
      expect(borderDistanceKm(ring, point), station.name).toBeGreaterThanOrEqual(1.5);
    }
    // Provera same provere: centar Pančeva je van Grada Beograda.
    expect(insideRing(ring, { lat: 44.87, lon: 20.64 })).toBe(false);
  });

  it.each(TIMES)('u %s: beogradske stanice su mešovitih kategorija (bar dve) i sve sveže', (iso) => {
    const now = new Date(iso);
    const core = buildDemoCore(now, 'beograd');
    const ids = new Set(core.stations.filter((s) => isBeograd(s.name)).map((s) => s.id));
    const ranks = core.snapshots.filter((s) => ids.has(s.station_id)).map((s) => s.category);
    expect(ranks).toHaveLength(33);
    expect(new Set(ranks).size).toBeGreaterThanOrEqual(2);
    expect(freshSnapshots(core, now).length).toBeGreaterThanOrEqual(33);
  });

  it.each([TIMES[3], TIMES[4]])('u %s (veče / ponoć): bar tri beogradske stanice su „Zagađen“ – grupa na mapi dobija oreol', (iso) => {
    const now = new Date(iso);
    const core = buildDemoCore(now, 'beograd');
    const ids = new Set(core.stations.filter((s) => isBeograd(s.name)).map((s) => s.id));
    const ranks = core.snapshots.filter((s) => ids.has(s.station_id)).map((s) => s.category);
    expect(ranks.filter((rank) => rank >= 3).length).toBeGreaterThanOrEqual(3);
    expect(ranks.filter((rank) => rank >= 3).length).toBeLessThan(15);
  });
});
