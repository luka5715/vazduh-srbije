/**
 * Geometrija mape Srbije (jednom po učitavanju): projekcija, putanje i okviri okruga, mreža
 * meridijana/paralela i razmera. Čiste vrednosti bez React-a.
 *
 * Okvir mape (`mapFrame`) može biti viši ili širi od same zemlje (npr. panel koji se
 * rasteže uz susedne panele): tada se viewBox proširi oko zemlje, a mreža stepeni se
 * nastavlja preko celog okvira – višak prostora izgleda kao deo instrumenta, ne kao rupa.
 *
 * Uvećan okrug (`mapFrame` sa `focus`): okvir je pravougaonik okruga sa po 12 % ivice sa svake
 * strane (najmanje `FOCUS_MIN_KM`, da i mali okrug pokaže okolinu), proširen duž jedne ose na
 * odnos strana kontejnera. Mreža i razmernik se prilagođavaju: ispod 1,5° raspona linije idu
 * na pola stepena („44,5°“), a razmernik bira najveću od 50/20/10/5 km koja stane u ~35 %
 * širine okvira.
 */

import okruzi from '@/data/okruzi.json';
import { createProjection, featureBounds, featureToPath, isKosovoDistrict, SERBIA_BBOX, type GeoCollection, type Projection } from '@/lib/geo';
import { formatNumber } from '@/lib/format';

/** Širina crtežnog prostora (viewBox); visina sledi iz odnosa strana. */
export const MAP_WIDTH = 600;
const MAP_PADDING = 12;
/** 1° geografske širine ≈ 111,2 km. */
export const KM_PER_DEGREE = 111.2;
/** Dužine razmernika (km), od najveće: bira se prva koja stane u `SCALE_BAR_MAX_SHARE` širine okvira. */
export const SCALE_BAR_STEPS_KM: readonly number[] = [50, 20, 10, 5];
const SCALE_BAR_MAX_SHARE = 0.35;
/** Ivica oko uvećanog okruga, udeo njegove širine/visine sa svake strane. */
export const FOCUS_PADDING = 0.12;
/** Najmanja širina i visina uvećanog okvira (km) – mali okrug i dalje pokazuje susede. */
export const FOCUS_MIN_KM = 60;
/** Ispod ovog raspona stepeni (po užoj osi okvira) mreža ide na pola stepena. */
export const FINE_GRATICULE_SPAN = 1.5;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DistrictShape {
  /** Naziv okruga – isti kao u `opstine-okrug.json` (`okrugOf`). */
  name: string;
  d: string;
  kosovo: boolean;
  /** Pravougaonik okruga u viewBox jedinicama (za uvećan prikaz). */
  bounds: ViewBox;
}

export interface GraticuleLine {
  key: string;
  /** Natpis (npr. „44°“ ili „44,5°“) i pozicija u procentima okvira mape. */
  label: string;
  axis: 'lat' | 'lon';
  /** Koordinata u viewBox jedinicama (y za paralelu, x za meridijan). */
  at: number;
  pct: number;
}

export interface MapGeometry {
  projection: Projection;
  districts: DistrictShape[];
  /** Mreža za osnovni okvir (samo zemlja). */
  graticule: GraticuleLine[];
  /** Dužina razmernika (50 km) u procentima širine osnovnog okvira. */
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
  /** Dužina razmernika u procentima širine okvira. */
  scaleBarPct: number;
  /** Dužina razmernika u km (50 na celoj mapi; 20/10/5 na uvećanom okrugu). */
  scaleBarKm: number;
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
    bounds: featureBounds(feature, projection),
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

/** Pravougaonik okruga u viewBox jedinicama; null za nepoznat naziv. */
export function districtBounds(geometry: Pick<MapGeometry, 'districts'>, name: string): ViewBox | null {
  return geometry.districts.find((district) => district.name === name)?.bounds ?? null;
}

/**
 * Okvir mape za kontejner zadate veličine (px): viewBox istog odnosa strana kao kontejner,
 * sa zemljom u sredini, i mreža stepeni preko celog okvira. Bez veličine → osnovni okvir.
 * Sa `focus` (pravougaonik okruga, `districtBounds`) okvir je uvećan okrug sa ivicom.
 */
export function mapFrame(geometry: MapGeometry, width: number, height: number, focus: ViewBox | null = null): MapFrame {
  const { width: w, height: h } = geometry.projection;
  const measured = width > 0 && height > 0;
  if (focus) return buildFrame(geometry, focusFrame(geometry, focus, measured ? width / height : geometry.aspect));
  if (!measured) return { vb: { x: 0, y: 0, w, h }, graticule: geometry.graticule, scaleBarPct: geometry.scaleBarPct, scaleBarKm: SCALE_BAR_STEPS_KM[0] };
  const ratio = width / height;
  // Zanemarljiva razlika (zaokruživanje piksela) → osnovni okvir, bez treptanja mreže.
  if (Math.abs(ratio - geometry.aspect) < 0.004) return mapFrame(geometry, 0, 0);
  const vb =
    ratio < geometry.aspect
      ? { x: 0, y: -(w / ratio - h) / 2, w, h: w / ratio }
      : { x: -(h * ratio - w) / 2, y: 0, w: h * ratio, h };
  return buildFrame(geometry, vb);
}

/** Okvir uvećanog okruga: ivica od `FOCUS_PADDING`, najmanje `FOCUS_MIN_KM`, pa odnos strana kontejnera. */
function focusFrame(geometry: Pick<MapGeometry, 'unitsPerLat'>, focus: ViewBox, ratio: number): ViewBox {
  const minSize = kmToUnits(geometry, FOCUS_MIN_KM);
  let w = Math.max(focus.w * (1 + 2 * FOCUS_PADDING), minSize);
  let h = Math.max(focus.h * (1 + 2 * FOCUS_PADDING), minSize);
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  return { x: focus.x + focus.w / 2 - w / 2, y: focus.y + focus.h / 2 - h / 2, w, h };
}

/** Dužina u viewBox jedinicama → kilometri (projekcija čuva razmeru po obe ose). */
export function unitsToKm(geometry: Pick<MapGeometry, 'unitsPerLat'>, units: number): number {
  return (units / geometry.unitsPerLat) * KM_PER_DEGREE;
}

/** Kilometri → viewBox jedinice. */
export function kmToUnits(geometry: Pick<MapGeometry, 'unitsPerLat'>, km: number): number {
  return (km / KM_PER_DEGREE) * geometry.unitsPerLat;
}

/** „44°“, „44,5°“ – natpis linije mreže. */
function degreeLabel(degrees: number): string {
  return `${formatNumber(degrees, 1)}°`;
}

function buildFrame(geometry: Pick<MapGeometry, 'projection' | 'unitsPerLon' | 'unitsPerLat'>, vb: ViewBox): MapFrame {
  const { projection, unitsPerLon, unitsPerLat } = geometry;
  const [ox, oy] = projection.project(SERBIA_BBOX.west, SERBIA_BBOX.north);
  const latAt = (y: number) => SERBIA_BBOX.north - (y - oy) / unitsPerLat;
  const lonAt = (x: number) => SERBIA_BBOX.west + (x - ox) / unitsPerLon;

  // Uvećan okvir (uži od 1,5° po bilo kojoj osi) dobija gušću mrežu – na pola stepena.
  const step = Math.min(vb.h / unitsPerLat, vb.w / unitsPerLon) < FINE_GRATICULE_SPAN ? 0.5 : 1;
  const graticule: GraticuleLine[] = [];
  for (let lat = Math.ceil(latAt(vb.y + vb.h) / step) * step; lat <= latAt(vb.y) + 1e-9; lat += step) {
    const y = oy + (SERBIA_BBOX.north - lat) * unitsPerLat;
    graticule.push({ key: `lat${lat}`, label: degreeLabel(lat), axis: 'lat', at: y, pct: ((y - vb.y) / vb.h) * 100 });
  }
  for (let lon = Math.ceil(lonAt(vb.x) / step) * step; lon <= lonAt(vb.x + vb.w) + 1e-9; lon += step) {
    const x = ox + (lon - SERBIA_BBOX.west) * unitsPerLon;
    graticule.push({ key: `lon${lon}`, label: degreeLabel(lon), axis: 'lon', at: x, pct: ((x - vb.x) / vb.w) * 100 });
  }

  // Projekcija čuva razmeru po obe ose: N km = N / 111,2 stepena širine.
  const scaleBarKm = SCALE_BAR_STEPS_KM.find((km) => kmToUnits(geometry, km) / vb.w <= SCALE_BAR_MAX_SHARE) ?? SCALE_BAR_STEPS_KM[SCALE_BAR_STEPS_KM.length - 1];
  const scaleBarPct = (kmToUnits(geometry, scaleBarKm) / vb.w) * 100;
  return { vb, graticule, scaleBarPct, scaleBarKm };
}
