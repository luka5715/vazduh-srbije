/**
 * Geo matematika za SVG mapu Srbije: ekvirektangularna projekcija sa korekcijom
 * cos(lat) – dovoljno tačna za zemlju od ~4° širine, bez spoljnih biblioteka.
 */

export interface BBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Okvir Srbije (uključujući Kosovo) iz src/data/okruzi.json. */
export const SERBIA_BBOX: BBox = { west: 18.84, east: 22.99, south: 41.84, north: 46.18 };

export interface Projection {
  /** Širina crtežnog prostora (viewBox). */
  width: number;
  /** Visina crtežnog prostora, izvedena iz odnosa strana da proporcije ostanu tačne. */
  height: number;
  /** [lon, lat] → [x, y] u koordinatama viewBox-a. */
  project(lon: number, lat: number): [number, number];
}

export function createProjection(bbox: BBox = SERBIA_BBOX, width = 600, padding = 10): Projection {
  const latMid = (bbox.south + bbox.north) / 2;
  const k = Math.cos((latMid * Math.PI) / 180);
  const spanX = (bbox.east - bbox.west) * k;
  const spanY = bbox.north - bbox.south;
  const scale = (width - 2 * padding) / spanX;
  const height = Math.round(spanY * scale + 2 * padding);
  return {
    width,
    height,
    project(lon, lat) {
      return [padding + (lon - bbox.west) * k * scale, padding + (bbox.north - lat) * scale];
    },
  };
}

export type Ring = Array<[number, number] | number[]>;

/** Jedan zatvoren prsten koordinata → SVG `d` putanja (zaokruženo na 0,1). */
export function ringToPath(ring: Ring, projection: Projection): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    const [x, y] = projection.project(lon, lat);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d ? `${d}Z` : '';
}

export interface GeoFeature {
  type: 'Feature';
  properties: { name: string; alt?: string; centroid?: [number, number] | number[] };
  geometry:
    | { type: 'Polygon'; coordinates: Ring[] }
    | { type: 'MultiPolygon'; coordinates: Ring[][] };
}

export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

/** Sve prstenove jednog okruga spaja u jednu putanju (rupe rade uz fill-rule evenodd). */
export function featureToPath(feature: GeoFeature, projection: Projection): string {
  const { geometry } = feature;
  const rings: Ring[] = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.map((ring) => ringToPath(ring, projection)).join('');
}

/** Okruzi na Kosovu i Metohiji (nema SEPA stanica; crtaju se bledo). */
export function isKosovoDistrict(name: string): boolean {
  return /kosov|prizren|pećki/i.test(name);
}
