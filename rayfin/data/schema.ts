import { DailyStat } from './DailyStat.js';
import { Station } from './Station.js';
import { StationSnapshot } from './StationSnapshot.js';
import { SyncRun } from './SyncRun.js';

/**
 * Šema aplikacije Vazduh Srbije. Svaki entitet mora biti i u tipu i u nizu:
 * tip daje tipizirani klijent (`client.data.<Entitet>`), niz registruje entitet
 * kod Rayfin CLI-ja koji generiše SQL šemu i GraphQL API.
 */
export type VazduhSchema = {
  Station: Station;
  DailyStat: DailyStat;
  StationSnapshot: StationSnapshot;
  SyncRun: SyncRun;
};

export { DailyStat, Station, StationSnapshot, SyncRun };

export const schema = [Station, DailyStat, StationSnapshot, SyncRun];
