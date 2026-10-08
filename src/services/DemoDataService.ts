/**
 * Demo režim (VITE_SERVICE_MODE=demo): podaci iz determinističkog fixture-a, bez mreže.
 * Funkcije „uspevaju“ posle ~800 ms sa sintetičkim rezultatom i dodaju red u dnevnik.
 * Dnevna statistika se računa lenjo, stanica po stanici, uz puštanje event loop-a.
 *
 * Istorija ima rupe kao prava baza (`demoHistoryGaps`); `runBackfill` ih popunjava. Scenariji
 * (`?demo=` u adresi, vidi `demoScenario`):
 *  - `empty` – prazna baza; posle prve sinhronizacije se puni kao prava: stanice, snimci i dnevna
 *    statistika samo za dane koje prozor sinhronizacije (`SYNC_HOURS_BACK` h) dodiruje, ostalo
 *    čeka „Dopuni nedostajuće dane“;
 *  - `late`  – SEPA kasni: sinhronizacija je uspela pre 12 min, ali najnoviji sat u bazi je
 *    `LATE_FEED_HOURS` sati stariji nego obično (stanice su i dalje sveže, ali ništa nije „uživo“);
 *  - `smog`  – izmišljena epizoda smoga (medijana PM10 ≈ 300 µg/m³, većina stanica „Veoma
 *    zagađen“/„Opasan“) – oblik podataka bira fixture (`buildDemoCore(now, 'smog')`);
 *  - `beograd` – devet stanica u beogradskom klasteru umesto dve (33 stanice ukupno).
 * Servis postoji samo u demo režimu (`createDataService` → `isDemoMode()`), pa scenariji u `rayfin`
 * režimu nisu dostupni.
 */

import type {
  BackfillResult,
  DailyStatRecord,
  StationRecord,
  StationSnapshotRecord,
  SyncResult,
  SyncRunRecord,
} from '@shared/contracts';
import { addDays, dayUtcRange, isValidDay, localDay } from '@shared/time';

import {
  buildDemoCore,
  buildDemoSyncRuns,
  dailyStatsForStation,
  demoHistoryGaps,
  isDemoGap,
  type DemoCore,
  type DemoHistoryGaps,
} from '@/demo/fixture';
import { SYNC_HOURS_BACK } from '@/hooks/useSync';
import { isRunInvalid } from '@/lib/syncRules';

import type { DataService } from './dataService';
import { demoScenario, LATE_FEED_HOURS } from './demoScenario';

const FUNCTION_DELAY_MS = 800;
const QUERY_DELAY_MS = 120;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DemoDataService implements DataService {
  readonly mode = 'demo' as const;
  private readonly now = new Date();
  private readonly scenario = demoScenario();
  /**
   * Trenutak do kog izvor ima merenja: sada, a u scenariju `late` `LATE_FEED_HOURS` sati ranije
   * (dnevnik sinhronizacija i dalje koristi stvarno vreme – sinhronizacija je sveža, izvor nije).
   */
  private readonly feedNow = this.scenario === 'late' ? new Date(this.now.getTime() - LATE_FEED_HOURS * 3_600_000) : this.now;
  /** Prazna baza dok prva sinhronizacija ne uspe (`?demo=empty`). */
  private empty = this.scenario === 'empty';
  /**
   * Prazna baza posle prve sinhronizacije: dani dnevne statistike koji postoje (prozor
   * sinhronizacije + dopunjeni dani). null = uobičajen demo (sve osim `demoHistoryGaps`).
   */
  private firstRunDays: Set<string> | null = null;
  /** Dani koje je „Dopuni nedostajuće dane“ učitao. */
  private readonly filledDays = new Set<string>();
  private core: DemoCore | null = null;
  private gapsCache: DemoHistoryGaps | null = null;
  private syncRuns: SyncRunRecord[] | null = null;
  private daily: Promise<DailyStatRecord[]> | null = null;
  private runCounter = 0;

  private get data(): DemoCore {
    if (!this.core) this.core = this.empty ? { specs: [], stations: [], snapshots: [] } : buildDemoCore(this.feedNow, this.scenario);
    return this.core;
  }

  private get gaps(): DemoHistoryGaps {
    if (!this.gapsCache) this.gapsCache = demoHistoryGaps(this.data.specs, this.now);
    return this.gapsCache;
  }

  private get runs(): SyncRunRecord[] {
    if (!this.syncRuns) this.syncRuns = this.empty ? [] : buildDemoSyncRuns(this.now, this.data.stations.length);
    return this.syncRuns;
  }

  /** Da li demo baza ima ovaj red dnevne statistike (rupe u istoriji, prazna baza). */
  private present(stat: DailyStatRecord): boolean {
    if (this.firstRunDays) return this.firstRunDays.has(stat.day);
    return !isDemoGap(stat, this.gaps, this.filledDays);
  }

  private dailyStats(): Promise<DailyStatRecord[]> {
    if (!this.daily) {
      this.daily = (async () => {
        const all: DailyStatRecord[] = [];
        for (const spec of this.data.specs) {
          all.push(...dailyStatsForStation(spec, this.feedNow, this.scenario));
          await delay(0); // pusti event loop da UI ostane odzivan
        }
        return all;
      })();
    }
    return this.daily;
  }

  async listStations(): Promise<StationRecord[]> {
    await delay(QUERY_DELAY_MS);
    return [...this.data.stations];
  }

  async listSnapshots(): Promise<StationSnapshotRecord[]> {
    await delay(QUERY_DELAY_MS);
    return [...this.data.snapshots];
  }

  async listDailyStats(stationId: string, fromDay: string): Promise<DailyStatRecord[]> {
    const all = await this.dailyStats();
    return all.filter((s) => s.station_id === stationId && s.day >= fromDay && this.present(s));
  }

  async listNetworkDailyStats(fromDay: string): Promise<DailyStatRecord[]> {
    const all = await this.dailyStats();
    return all.filter((s) => s.day >= fromDay && this.present(s));
  }

  async listSyncRuns(limit: number): Promise<SyncRunRecord[]> {
    await delay(QUERY_DELAY_MS);
    return [...this.runs]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  async latestSuccessfulSync(): Promise<SyncRunRecord | null> {
    await delay(QUERY_DELAY_MS);
    const now = new Date();
    const okSyncs = this.runs
      .filter((run) => run.kind === 'sync' && run.status === 'ok' && !isRunInvalid(run, now))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return okSyncs[0] ?? null;
  }

  async runSync(hoursBack: number): Promise<SyncResult> {
    const started = new Date();
    await delay(FUNCTION_DELAY_MS);
    const finished = new Date();
    if (this.empty) {
      // Prva sinhronizacija prazne baze: stanice i snimci, a dnevna statistika samo za dane
      // koje prozor od `SYNC_HOURS_BACK` h dodiruje (početak prozora se vraća na lokalnu ponoć
      // svog dana, pa su to 4 dana za 72 h) – kao `runSync` na serveru.
      this.empty = false;
      this.core = null;
      this.gapsCache = null;
      this.daily = null;
      const today = localDay(this.now);
      const days = new Set<string>();
      for (let day = localDay(new Date(this.now.getTime() - SYNC_HOURS_BACK * 3_600_000)); day <= today; day = addDays(day, 1)) days.add(day);
      this.firstRunDays = days;
    }
    const id = `demo-run-sync-${++this.runCounter}`;
    const stations = this.data.stations.length;
    const snapshots = this.data.snapshots.length;
    const observations = snapshots * 5 * Math.min(hoursBack, 48);
    this.runs.unshift({
      id,
      kind: 'sync',
      status: 'ok',
      startedAt: started,
      finishedAt: finished,
      windowFrom: new Date(started.getTime() - hoursBack * 3_600_000),
      windowTo: started,
      stationsSeen: stations,
      observationsSeen: observations,
      rowsWritten: stations + snapshots + snapshots * 5 * 2,
      message: 'Demo: ništa nije preuzeto sa SEPA.',
    });
    return {
      ok: true,
      syncRunId: id,
      from: new Date(started.getTime() - hoursBack * 3_600_000).toISOString(),
      to: started.toISOString(),
      stationsSeen: stations,
      stationsWritten: stations,
      observationsSeen: observations,
      snapshotsWritten: snapshots,
      dailyStatsWritten: snapshots * 5 * 2,
      durationMs: finished.getTime() - started.getTime(),
      warnings: ['Demo režim: podaci nisu stvarna merenja.'],
    };
  }

  async runBackfill(day: string): Promise<BackfillResult> {
    const started = new Date();
    await delay(FUNCTION_DELAY_MS);
    const finished = new Date();
    if (!isValidDay(day)) {
      return {
        ok: false,
        syncRunId: '',
        day,
        stationsSeen: 0,
        observationsSeen: 0,
        dailyStatsWritten: 0,
        durationMs: finished.getTime() - started.getTime(),
        warnings: [],
        error: `Neispravan dan „${day}“ (očekuje se YYYY-MM-DD).`,
      };
    }
    const id = `demo-run-backfill-${++this.runCounter}`;
    const { from, to } = dayUtcRange(day);
    // Dopunjen dan od sada postoji u demo bazi (rupe u istoriji, prazna baza posle prve sinhronizacije).
    this.filledDays.add(day);
    this.firstRunDays?.add(day);
    const rows = (await this.dailyStats()).filter((stat) => stat.day === day).length;
    this.runs.unshift({
      id,
      kind: 'backfill',
      status: 'ok',
      startedAt: started,
      finishedAt: finished,
      windowFrom: from,
      windowTo: to,
      stationsSeen: this.data.stations.length,
      observationsSeen: rows * 24,
      rowsWritten: rows,
      message: `Dan ${day} (demo)`,
    });
    return {
      ok: true,
      syncRunId: id,
      day,
      stationsSeen: this.data.stations.length,
      observationsSeen: rows * 24,
      dailyStatsWritten: rows,
      durationMs: finished.getTime() - started.getTime(),
      warnings: [],
    };
  }
}
