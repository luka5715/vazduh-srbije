import {
  authenticated,
  date,
  entity,
  int,
  one,
  text,
  uuid,
} from '@microsoft/rayfin-core';

import { Station } from './Station.js';

/**
 * Trenutno stanje jedne stanice: najnovija satna vrednost svakog polutanta i
 * poslednja 24 sata, upakovano kao JSON da bi pregled cele mreže bio jedan upit.
 * Jedan red po stanici; `id` = UUID v5 od `snapshot|${sepaId}`.
 *
 * valuesJson: { "PM10": { "v": 48.3, "t": "2026-10-06T15:00:00.000Z", "c": 2 }, ... }
 * seriesJson: { "start": "2026-10-05T16:00:00.000Z", "values": { "PM10": [null, 12.1, ...24] } }
 */
@entity()
@authenticated(['read', 'create', 'update'])
export class StationSnapshot {
  @uuid() id!: string;
  @uuid() station_id!: string;
  @one(() => Station) station?: Station;
  /** Početak najnovijeg sata sa merenjem (UTC). */
  @date() observedAt!: Date;
  /** Najgora SEPA kategorija među trenutnim vrednostima (0-5). */
  @int({ min: 0, max: 5 }) category!: number;
  /** Polutant koji određuje kategoriju (npr. PM10). */
  @text({ max: 8 }) dominant!: string;
  @text({ max: 2000 }) valuesJson!: string;
  @text({ max: 4000 }) seriesJson!: string;
  @date() updatedAt!: Date;
}
