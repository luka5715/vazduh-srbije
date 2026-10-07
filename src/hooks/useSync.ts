import { useCallback, useEffect, useRef, useState } from 'react';

import type { SyncResult } from '@shared/contracts';
import { isAlreadyRunningError, summarizeSyncWarnings } from '@shared/syncNotes';
import { todayLocal } from '@shared/time';

import { describeDataError, describeSyncError, errorMessage } from '@/lib/errors';
import { formatInt, pluralSr, stationsNoun } from '@/lib/format';
import { historyCoverage, historyWindowStart, HISTORY_DAYS } from '@/lib/syncRules';
import type { DataService } from '@/services/dataService';

export const SYNC_HOURS_BACK = 36;
/** Koliko prošlih dana „Dopuni nedostajuće dane“ proverava (= koliko izvor čuva). */
export const BACKFILL_DAYS = HISTORY_DAYS;

export type SyncActivity =
  | { kind: 'sync'; startedAt: Date; auto: boolean }
  | {
      kind: 'backfill';
      startedAt: Date;
      /** Provera koji dani nedostaju (pre prvog dana); `days` je tada prazan, `total` 0. */
      planning: boolean;
      /** Dani koji se dopunjavaju, od najstarijeg. */
      days: string[];
      day: string;
      index: number;
      total: number;
      okDays: number;
      failedDays: number;
      stopping: boolean;
    };

/**
 * Ton ishoda (boja i ikona obaveštenja): `partial` – posao je uspeo, ali bez dela stanica;
 * `stopped` – korisnik je zaustavio istoriju; `info` – ništa nije pokrenuto (posao druge
 * sesije, skorašnja sinhronizacija, istorija je već potpuna).
 */
export type OutcomeTone = 'ok' | 'partial' | 'error' | 'stopped' | 'info';

export interface SyncOutcome {
  kind: 'sync' | 'backfill';
  /** Posao je završen kako je traženo (za `info`/`stopped`/`error` false). */
  ok: boolean;
  tone: OutcomeTone;
  title: string;
  detail?: string;
  at: Date;
}

export interface SyncControls {
  /** Trenutni posao ili null; nikad dva istovremeno. */
  activity: SyncActivity | null;
  /** Ishod poslednjeg posla (za toast i panel). */
  outcome: SyncOutcome | null;
  dismissOutcome: () => void;
  busy: boolean;
  startSync: (options?: { auto?: boolean }) => Promise<void>;
  /**
   * „Dopuni nedostajuće dane“: proverava pokrivenost istorije u bazi i učitava dan po dan
   * samo dane koji nisu potpuni, od najstarijeg (njih izvor prvi briše). Zaustavljanje pa
   * ponovno pokretanje zato zaista nastavlja – potpuni dani se preskaču. `days` zaobilazi proveru.
   */
  startBackfill: (options?: { days?: string[] }) => Promise<void>;
  stopBackfill: () => void;
  /** Obaveštenje bez posla (npr. „Sinhronizacija je već u toku“ iz dugmeta „Osveži“). */
  notify: (outcome: Omit<SyncOutcome, 'at'>) => void;
}

/** Ishod uspešne sinhronizacije: „Podaci su osveženi“ ili „Osveženo delimično: X od Y stanica“. */
export function syncSuccessOutcome(result: SyncResult): Omit<SyncOutcome, 'at'> {
  const summary = summarizeSyncWarnings(result.warnings);
  const seen = result.stationsSeen;
  const observations = `${formatInt(result.observationsSeen)} ${pluralSr(result.observationsSeen, 'merenje', 'merenja', 'merenja')}`;
  const snapshots = `${formatInt(result.snapshotsWritten)} ${pluralSr(result.snapshotsWritten, 'snimak', 'snimka', 'snimaka')}`;
  if (summary.partial) {
    const missing = summary.failedStations + summary.skippedStations;
    const okStations = Math.max(0, seen - missing);
    const reasons: string[] = [];
    if (summary.failedStations) {
      reasons.push(`${formatInt(summary.failedStations)} ${stationsNoun(summary.failedStations)} bez odgovora izvora`);
    }
    if (summary.skippedStations) {
      reasons.push(`${formatInt(summary.skippedStations)} ${pluralSr(summary.skippedStations, 'preskočena', 'preskočene', 'preskočeno')} zbog vremenskog limita`);
    }
    return {
      kind: 'sync',
      ok: true,
      tone: 'partial',
      title: `Osveženo delimično: ${formatInt(okStations)} od ${formatInt(seen)} ${stationsNoun(seen)}`,
      detail: `${reasons.join(', ')}; te stanice zadržavaju ranije podatke. ${observations}, ${snapshots}.`,
    };
  }
  const stations = `${formatInt(seen)} ${stationsNoun(seen)}`;
  // Ostala upozorenja (npr. demo napomena) se prikazuju rečima, ne kao broj.
  const notes = result.warnings.length ? ` ${result.warnings.slice(0, 2).join(' ')}` : '';
  return { kind: 'sync', ok: true, tone: 'ok', title: 'Podaci su osveženi', detail: `${stations}, ${observations}, ${snapshots}.${notes}` };
}

/**
 * Posle završenog posla: ponovo učitava podatke i može da zameni ishod (npr. sinhronizacija je
 * uspela, ali izvor nema novih sati – „Podaci su osveženi“ bi lagalo).
 */
export type SyncCompleteHandler = (outcome: Omit<SyncOutcome, 'at'>) => void | Promise<void | Omit<SyncOutcome, 'at'>>;

/**
 * Pokretanje Fabric funkcija iz UI: jedna sinhronizacija ili petlja dopunjavanja
 * istorije dan po dan (sa napretkom i zaustavljanjem). Po završetku zove `onComplete`
 * da se podaci ponovo učitaju; posao se na ekranu završava tek kad stignu novi podaci.
 */
export function useSync(service: DataService, onComplete: SyncCompleteHandler): SyncControls {
  const [activity, setActivity] = useState<SyncActivity | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = useCallback(
    async (result: Omit<SyncOutcome, 'at'>, reload = true) => {
      let final = result;
      if (reload) {
        try {
          final = (await onComplete(result)) ?? result;
        } catch {
          // Neuspelo ponovno čitanje prijavljuje sloj podataka (baner); ishod posla ostaje.
        }
      }
      busyRef.current = false;
      if (mounted.current) {
        setActivity(null);
        setOutcome({ ...final, at: new Date() });
      }
    },
    [onComplete],
  );

  const startSync = useCallback(
    async (options?: { auto?: boolean }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setOutcome(null);
      setActivity({ kind: 'sync', startedAt: new Date(), auto: options?.auto ?? false });
      try {
        const result = await service.runSync(SYNC_HOURS_BACK);
        if (result.ok) {
          await finish(syncSuccessOutcome(result));
        } else if (isAlreadyRunningError(result.error)) {
          // Server je odbio drugi posao: ponovno učitavanje donosi `running` red druge sesije,
          // pa ljuska prati njen završetak (REMOTE_POLL_MS).
          const { title, hint } = describeSyncError(result.error);
          await finish({ kind: 'sync', ok: false, tone: 'info', title, detail: hint });
        } else {
          const { title, hint } = describeSyncError(result.error ?? 'Nepoznata greška');
          await finish({ kind: 'sync', ok: false, tone: 'error', title, detail: hint });
        }
      } catch (error) {
        const { title, hint } = describeSyncError(error);
        await finish({ kind: 'sync', ok: false, tone: 'error', title, detail: hint });
      }
    },
    [finish, service],
  );

  const startBackfill = useCallback(
    async (options?: { days?: string[] }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      stopRef.current = false;
      setOutcome(null);
      const startedAt = new Date();
      const base = { kind: 'backfill' as const, startedAt, okDays: 0, failedDays: 0, stopping: false };
      setActivity({ ...base, planning: true, days: [], day: '', index: 0, total: 0 });

      let days = options?.days;
      if (!days) {
        try {
          const today = todayLocal();
          const stats = await service.listNetworkDailyStats(historyWindowStart(today));
          days = historyCoverage(stats, today).incomplete;
        } catch (error) {
          const { title, hint } = describeDataError(error);
          await finish({ kind: 'backfill', ok: false, tone: 'error', title: 'Provera istorije nije uspela', detail: `${title}. ${hint}` }, false);
          return;
        }
      }
      const plan = [...days].sort(); // najstariji prvi: njih izvor prvi briše
      if (plan.length === 0) {
        await finish(
          { kind: 'backfill', ok: true, tone: 'info', title: 'Istorija je već potpuna', detail: `Svih ${BACKFILL_DAYS} dana je u bazi – nema šta da se dopuni.` },
          false,
        );
        return;
      }

      const total = plan.length;
      let okDays = 0;
      let failedDays = 0;
      let firstError: string | null = null;
      let processed = 0;
      for (let i = 0; i < total; i++) {
        if (stopRef.current) break;
        const day = plan[i];
        if (mounted.current) {
          setActivity((current) => ({
            ...base,
            planning: false,
            days: plan,
            day,
            index: i + 1,
            total,
            okDays,
            failedDays,
            stopping: current?.kind === 'backfill' ? current.stopping : false,
          }));
        }
        try {
          const result = await service.runBackfill(day);
          if (result.ok) okDays++;
          else {
            failedDays++;
            firstError ??= result.error ?? 'Nepoznata greška';
          }
        } catch (error) {
          failedDays++;
          firstError ??= errorMessage(error);
        }
        processed = i + 1;
      }
      const stopped = stopRef.current && processed < total;
      const failedText = `${formatInt(failedDays)} ${pluralSr(failedDays, 'dan nije uspeo', 'dana nisu uspela', 'dana nije uspelo')}`;
      const errorHint = firstError ? ` ${describeSyncError(firstError).hint}` : '';
      if (stopped) {
        await finish({
          kind: 'backfill',
          ok: false,
          tone: 'stopped',
          title: `Dopunjavanje zaustavljeno (${formatInt(okDays)} od ${formatInt(total)} dana)`,
          detail: `Sledeće dopunjavanje nastavlja od prvog dana koji još nedostaje.${failedDays ? ` ${failedText}.${errorHint}` : ''}`,
        });
      } else if (failedDays === 0) {
        await finish({ kind: 'backfill', ok: true, tone: 'ok', title: `Istorija dopunjena: ${formatInt(okDays)} od ${formatInt(total)} dana` });
      } else {
        await finish({
          kind: 'backfill',
          ok: false,
          tone: 'error',
          title: `Istorija dopunjena delimično: ${formatInt(okDays)} od ${formatInt(total)} dana`,
          detail: `${failedText}.${errorHint}`,
        });
      }
    },
    [finish, service],
  );

  const stopBackfill = useCallback(() => {
    stopRef.current = true;
    setActivity((current) => (current && current.kind === 'backfill' ? { ...current, stopping: true } : current));
  }, []);

  const notify = useCallback((next: Omit<SyncOutcome, 'at'>) => {
    if (busyRef.current) return;
    setOutcome({ ...next, at: new Date() });
  }, []);

  const dismissOutcome = useCallback(() => setOutcome(null), []);

  return { activity, outcome, dismissOutcome, busy: activity !== null, startSync, startBackfill, stopBackfill, notify };
}
