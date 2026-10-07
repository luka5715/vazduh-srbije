import {
  authenticated,
  boolean,
  date,
  decimal,
  entity,
  int,
  text,
  uuid,
} from '@microsoft/rayfin-core';

/**
 * Automatska merna stanica državne mreže za praćenje kvaliteta vazduha
 * (Agencija za zaštitu životne sredine, SEPA). Red se puni iz Kosava Open Data
 * API-ja (GET /stations?active=true) pri svakoj sinhronizaciji.
 *
 * `id` je deterministički UUID v5 izveden iz `sepaId`, pa je upsert idempotentan.
 */
@entity()
@authenticated(['read', 'create', 'update'])
export class Station {
  @uuid() id!: string;
  /** station_id iz Kosava API-ja (npr. 37). */
  @int({ unique: true }) sepaId!: number;
  /** EEA/SEPA šifra stanice (npr. RS1056A). */
  @text({ max: 32 }) code!: string;
  @text({ max: 200 }) name!: string;
  @text({ max: 120, optional: true }) municipality?: string;
  /** WGS84 koordinate ako ih API vrati; inače null (frontend koristi centar okruga). */
  @decimal({ precision: 9, scale: 6, optional: true }) latitude?: number;
  @decimal({ precision: 9, scale: 6, optional: true }) longitude?: number;
  @boolean({ default: true }) active!: boolean;
  /** Početak najnovijeg sata za koji postoji merenje (UTC). */
  @date({ optional: true }) lastObservationAt?: Date;
  @date() updatedAt!: Date;
}
