import {
  authenticated,
  date,
  entity,
  int,
  set,
  text,
  uuid,
} from '@microsoft/rayfin-core';

/**
 * Dnevnik sinhronizacija sa SEPA/Kosava API-jem (jedan red po pozivu funkcije).
 */
@entity()
@authenticated(['read', 'create', 'update'])
export class SyncRun {
  @uuid() id!: string;
  @set('sync', 'backfill') kind!: 'sync' | 'backfill';
  @set('running', 'ok', 'error') status!: 'running' | 'ok' | 'error';
  @date() startedAt!: Date;
  @date({ optional: true }) finishedAt?: Date;
  /** Vremenski prozor merenja koji je obrađen (UTC). */
  @date() windowFrom!: Date;
  @date() windowTo!: Date;
  @int({ default: 0 }) stationsSeen!: number;
  @int({ default: 0 }) observationsSeen!: number;
  @int({ default: 0 }) rowsWritten!: number;
  @text({ max: 1000, optional: true }) message?: string;
}
