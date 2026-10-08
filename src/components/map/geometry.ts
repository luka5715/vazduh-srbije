/**
 * Geometrija mape Srbije (jednom po učitavanju): projekcija, putanje okruga, mreža
 * meridijana/paralela i razmera. Čiste vrednosti bez React-a.
 *
 * Okvir mape (`mapFrame`) može biti viši ili širi od same zemlje (npr. panel koji se
 * rasteže uz susedne panele): tada se viewBox proširi oko zemlje, a mreža stepeni se
 * nastavlja preko celog okvira – višak prostora izgleda kao deo instrumenta, ne kao rupa.
 */

import okruzi from '@/data/okruzi.json';
import { createProjection, featureToPath, isKosovoDistrict, SERBIA_BBOX, type GeoCollection, type Projection } from '@/lib/geo';

/** Širina crtežnog prostora (viewBox); visina sledi iz odnosa strana. */
export const MAP_WIDTH = 600;
const MAP_PADDING = 12;
/** 1° geografske širine ≈ 111,2 km. */
export const KM_PER_DEGREE = 111.2;
const SCALE_BAR_KM = 50;

export interface DistrictShape {
  /** Naziv okruga – isti kao u `opstine-okrug.json` (`okrugOf`). */
  name: string;
  d: string;
  kosovo: boolean;
}

export interface GraticuleLine {
  key: string;
  /** Natpis (npr. „44°“) i pozicija u procentima okvira mape. */
  label: string;
  axis: 'lat' | 'lon';
  /** Koordinata u viewBox jedinicama (y za paralelu, x za meridijan). */
  at: number;
  pct: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapGeometry {
  projection: Projection;
  districts: DistrictShape[];
  /** Mreža za osnovni okvir (samo zemlja). */
  graticule: GraticuleLine[];
  /** Dužina 50 km u procentima širine osnovnog okvira (za razmernik). */
  scaleBarPct: number;
  /** Odnos širina / visina zemlje. */
  aspect: number;
  /** Jedinice viewBox-a po stepenu geografske dužine / širine. */
  unitsPerLon: number;
  unitsPerLat: number;
}

export interface MapFrame {
  /** viewBox okvira (može izlaziti van [0, širina] × [0, visina] zemlje). */
  vb: ViewBox;
  graticule: GraticuleLine[];
  /** Dužina 50 km u procentima širine okvira. */
  scaleBarPct: number;
}

let cached: MapGeometry | null = null;

/** Geometrija mape (računa se jednom, pri prvom crtanju). */
export function mapGeometry(): MapGeometry {
  if (cached) return cached;
  const projection = createProjection(SERBIA_BBOX, MAP_WIDTH, MAP_PADDING);
  const districts = (okruzi as GeoCollection).features.map((feature) => ({
    name: feature.properties.name,
    d: featureToPath(feature, projection),
    kosovo: isKosovoDistrict(feature.properties.name),
  }));

  const [x0, y0] = projection.project(SERBIA_BBOX.west, SERBIA_BBOX.north);
  const [x1] = projection.project(SERBIA_BBOX.west + 1, SERBIA_BBOX.north);
  const [, y1] = projection.project(SERBIA_BBOX.west, SERBIA_BBOX.north - 1);
  const partial = { projection, unitsPerLon: x1 - x0, unitsPerLat: y1 - y0 };
  const base = buildFrame(partial, { x: 0, y: 0, w: projection.width, h: projection.height });

  cached = {
    ...partial,
    districts,
    graticule: base.graticule,
    scaleBarPct: base.scaleBarPct,
    aspect: projection.width / projection.height,
  };
  return cached;
}

/**
 * Okvir mape za kontejner zadate veličine (px): viewBox istog odnosa strana kao kontejner,
 * sa zemljom u sredini, i mreža stepeni preko celog okvira. Bez veličine → osnovni okvir.
 */
export function mapFrame(geometry: MapGeometry, width: number, height: number): MapFrame {
  const { width: w, height: h } = geometry.projection;
  if (!(width > 0) || !(height > 0)) return { vb: { x: 0, y: 0, w, h }, graticule: geometry.graticule, scaleBarPct: geometry.scaleBarPct };
  const ratio = width / height;
  // Zanemarljiva razlika (zaokruživanje piksela) → osnovni okvir, bez treptanja mreže.
  if (Math.abs(ratio - geometry.aspect) < 0.004) return mapFrame(geometry, 0, 0);
  const vb =
    ratio < geometry.aspect
      ? { x: 0, y: -(w / ratio - h) / 2, w, h: w / ratio }
      : { x: -(h * ratio - w) / 2, y: 0, w: h * ratio, h };
  return buildFrame(geometry, vb);
}

/** Dužina u viewBox jedinicama → kilometri (projekcija čuva razmeru po obe ose). */
export function unitsToKm(geometry: Pick<MapGeometry, 'unitsPerLat'>, units: number): number {
  return (units / geometry.unitsPerLat) * KM_PER_DEGREE;
}

function buildFrame(geometry: Pick<MapGeometry, 'projection' | 'unitsPerLon' | 'unitsPerLat'>, vb: ViewBox): MapFrame {
  const { projection, unitsPerLon, unitsPerLat } = geometry;
  const [ox, oy] = projection.project(SERBIA_BBOX.west, SERBIA_BBOX.north);
  const latAt = (y: number) => SERBIA_BBOX.north - (y - oy) / unitsPerLat;
  const lonAt = (x: number) => SERBIA_BBOX.west + (x - ox) / unitsPerLon;

  const graticule: GraticuleLine[] = [];
  for (let lat = Math.ceil(latAt(vb.y + vb.h)); lat <= Math.floor(latAt(vb.y)); lat++) {
    const y = oy + (SERBIA_BBOX.north - lat) * unitsPerLat;
    graticule.push({ key: `lat${lat}`, label: `${lat}°`, axis: 'lat', at: y, pct: ((y - vb.y) / vb.h) * 100 });
  }
  for (let lon = Math.ceil(lonAt(vb.x)); lon <= Math.floor(lonAt(vb.x + vb.w)); lon++) {
    const x = ox + (lon - SERBIA_BBOX.west) * unitsPerLon;
    graticule.push({ key: `lon${lon}`, label: `${lon}°`, axis: 'lon', at: x, pct: ((x - vb.x) / vb.w) * 100 });
  }

  // Projekcija čuva razmeru po obe ose: 50 km = 50 / 111,2 stepena širine.
  const scaleBarPct = (((SCALE_BAR_KM / KM_PER_DEGREE) * unitsPerLat) / vb.w) * 100;
  return { vb, graticule, scaleBarPct };
}
