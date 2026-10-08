/**
 * Sloj podataka frontenda. Dve implementacije:
 *  - `RayfinDataService` – GraphQL data API + Fabric funkcije preko tipiziranog klijenta;
 *  - `DemoDataService`   – determinističke demo vrednosti bez backenda (VITE_SERVICE_MODE=demo).
 *
 * U `rayfin` režimu NIKAD ne prikazujemo demo podatke, ni kao zamenu pri grešci.
 */

import type {
  BackfillResult,
  DailyStatRecord,
  StationRecord,
  StationSnapshotRecord,
  SyncResult,
  SyncRunRecord,
} from '@shared/contracts';

import { isDemoMode } from './bootstrap';
import { DemoDataService } from './DemoDataService';
import { getRayfinClient } from './rayfinClient';
import { RayfinDataService } from './RayfinDataService';

export interface DataService {
  readonly mode: 'rayfin' | 'demo';
  /** Sve stanice (jedna strana do 1000 redova – mreža ima ~60 stanica). */
  listStations(): Promise<StationRecord[]>;
  /** Snimci trenutnog stanja, jedan po stanici. */
  listSnapshots(): Promise<StationSnapshotRecord[]>;
  /** Dnevna statistika jedne stanice od zadatog dana (uključivo), sve strane. */
  listDailyStats(stationId: string, fromDay: string): Promise<DailyStatRecord[]>;
  /** Dnevna statistika cele mreže od zadatog dana (uključivo), sve strane. */
  listNetworkDailyStats(fromDay: string): Promise<DailyStatRecord[]>;
  /** Poslednjih `limit` sinhronizacija (svih vrsta), najnovija prva. */
  listSyncRuns(limit: number): Promise<SyncRunRecord[]>;
  /**
   * Poslednja uspešna sinhronizacija trenutnog stanja (`kind === 'sync'`, `status === 'ok'`)
   * ili null. Popunjavanje istorije (`backfill`) ne piše snimke, pa ne sme da „osveži“ prikaz.
   */
  latestSuccessfulSync(): Promise<SyncRunRecord | null>;
  /** Pokreće funkciju `syncAirQuality` (trajanje pokazuje dnevnik – `summarizeRuns`; limit funkcije 240 s). */

  runSync(hoursBack: number): Promise<SyncResult>;
  /** Pokreće funkciju `backfillDay` za jedan lokalni dan (YYYY-MM-DD). */
  runBackfill(day: string): Promise<BackfillResult>;
}

export function createDataService(): DataService {
  if (isDemoMode()) return new DemoDataService();
  return new RayfinDataService(getRayfinClient());
}
