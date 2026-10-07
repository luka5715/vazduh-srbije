/**
 * Rayfin funkcije aplikacije „Vazduh Srbije“ (Microsoft Fabric Apps).
 *
 * Funkcije rade na serveru (Fabric user data functions), pozivaju javni
 * SEPA/Kosava Open Data API i upisuju rezultat u SQL bazu aplikacije kroz
 * tipizirani klijent `ctx.getDataClient()`. Frontend ih poziva kao
 * `client.functions.<ime>.invoke({...})`; tipovi u ./types.ts se generišu
 * automatski (`node scripts/typegen.mjs` ili `npx rayfin dev`).
 */
import { UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';

import type { VazduhSchema } from '../../data/schema.js';
import type { BackfillResult, SyncResult } from './shared/contracts.js';
import { runBackfill, runSync } from './sync.js';

const udf = new UserDataFunctions();

/**
 * Preuzima satna merenja svih aktivnih stanica za poslednjih `hoursBack` sati
 * (3–168, podrazumevano 36; početak prozora se vraća na lokalnu ponoć), osvežava
 * stanice (i deaktivira one kojih više nema u API-ju), snimke trenutnog stanja i
 * dnevnu statistiku za dane koje prozor pokriva.
 */
udf.func(
  'syncAirQuality',
  async (hoursBack: number, ctx: RayfinContext<VazduhSchema>): Promise<SyncResult> => {
    return runSync(ctx, hoursBack);
  },
  [],
);

/**
 * Računa dnevnu statistiku za jedan lokalni dan (YYYY-MM-DD, Europe/Belgrade)
 * unutar 30 dana koje API čuva. Frontend poziva dan po dan za učitavanje istorije.
 */
udf.func(
  'backfillDay',
  async (day: string, ctx: RayfinContext<VazduhSchema>): Promise<BackfillResult> => {
    return runBackfill(ctx, day);
  },
  [],
);
