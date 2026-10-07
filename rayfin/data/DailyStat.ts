import {
  authenticated,
  date,
  decimal,
  entity,
  int,
  one,
  set,
  text,
  uuid,
} from '@microsoft/rayfin-core';

import { Station } from './Station.js';

/**
 * Dnevna statistika jednog polutanta na jednoj stanici (lokalni dan, Europe/Belgrade),
 * izračunata iz satnih srednjih vrednosti SEPA/Kosava API-ja (µg/m³).
 * Ovo je dugoročna istorija aplikacije: API čuva samo poslednjih 30 dana,
 * a ova tabela raste svakom sinhronizacijom.
 *
 * `id` = UUID v5 od `daily|${sepaId}|${parameter}|${day}` (idempotentan upsert).
 */
@entity()
@authenticated(['read', 'create', 'update'])
export class DailyStat {
  @uuid() id!: string;
  @uuid() station_id!: string;
  @one(() => Station) station?: Station;
  @set('PM10', 'PM2.5', 'NO2', 'SO2', 'O3')
  parameter!: 'PM10' | 'PM2.5' | 'NO2' | 'SO2' | 'O3';
  /** Lokalni dan u formatu YYYY-MM-DD (Europe/Belgrade). */
  @text({ max: 10 }) day!: string;
  @decimal({ precision: 10, scale: 2 }) avgValue!: number;
  @decimal({ precision: 10, scale: 2 }) maxValue!: number;
  @decimal({ precision: 10, scale: 2 }) minValue!: number;
  /** Lokalni sat (0-23) u kome je izmeren dnevni maksimum. */
  @int({ min: 0, max: 23 }) maxHour!: number;
  /** Broj satnih merenja koja su ušla u statistiku (0-25; dan prelaska na zimsko vreme ima 25 sati). */
  @int({ min: 0, max: 25 }) hours!: number;
  /** SEPA kategorija (0 Dobar … 5 Izuzetno zagađen) dnevnog maksimuma. */
  @int({ min: 0, max: 5 }) categoryMax!: number;
  @date() updatedAt!: Date;
}
