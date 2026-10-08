/**
 * Naslov i rečenica heroja Sinhronizacije za svako stanje (`SyncState`): čist modul bez
 * komponenti, da bi se tekstovi testirali bez provajdera (`heroHeadline.test.ts`) i da
 * `SyncHero.tsx` izvozi samo komponentu (react-refresh).
 */
import type { ReactNode } from 'react';

import { describeSyncError } from '@/lib/errors';
import { formatDateTime, formatDayMonth, formatHourInterval, formatRelative, formatTime, isSameLocalDay } from '@/lib/format';
import { LIVE_HOURS, liveStatus } from '@/lib/stations';
import { MIN_GAP_MINUTES, STALE_MINUTES } from '@/lib/syncRules';

import { backfillEtaText, expectedSyncDuration, FUNCTION_LIMIT_MS, syncWindowText, type DurationExpectation, type SyncState } from './runModel';

export interface Headline {
  lead: string;
  word: string;
  /** Boja podvlačenja i tačke (token). */
  tone: string;
  sub: ReactNode;
}

export interface HeadlineContext {
  lastSync: Date | null;
  now: Date;
  mode: 'rayfin' | 'demo';
  /** Sinhronizacija u toku je automatsko osvežavanje. */
  auto: boolean;
  /** Izmerena trajanja iz dnevnika – tekst nikad ne obećava trajanje koje podaci ne potvrđuju. */
  expectation: DurationExpectation;
  /** Broj dana koje dopunjavanje u toku učitava (null dok se proverava šta nedostaje). */
  backfillDays: number | null;
}

/** Naslov i rečenica heroja za stanje sinhronizacije. */
export function headlineOf(state: SyncState, { lastSync, now, mode, auto, expectation, backfillDays }: HeadlineContext): Headline {
  const lastOk = lastSync ? `Poslednja uspešna sinhronizacija ${formatRelative(lastSync, now)} (${formatDateTime(lastSync)}).` : '';
  const usual = expectedSyncDuration(expectation);
  switch (state.kind) {
    case 'syncing':
      return {
        lead: 'Preuzimanje sa SEPA je',
        word: 'u toku',
        tone: 'var(--accent)',
        sub: auto
          ? `Automatsko osvežavanje pri otvaranju: podaci su bili stariji od ${STALE_MINUTES} min ili je SEPA po očekivanju objavila nov sat. Funkcija radi na serveru i obično traje ${usual}.`
          : `Funkcija syncAirQuality radi na serveru i obično traje ${usual} (limit ${FUNCTION_LIMIT_MS / 1000} s).`,
      };
    case 'backfilling':
      return {
        lead: 'Dopunjava se',
        word: 'istorija',
        tone: 'var(--accent)',
        sub: `Samo dani koji u bazi nedostaju, od najstarijeg, ${backfillEtaText(expectation, backfillDays)}. Možete prekinuti u svakom trenutku – sledeće dopunjavanje nastavlja od prvog dana koji još nedostaje.`,
      };
    case 'remote-running':
      return {
        lead: 'Sinhronizacija je',
        word: 'u toku',
        tone: 'var(--accent)',
        sub: `Pokrenuta je ${formatRelative(state.run.startedAt, now)} iz druge sesije i obično traje ${usual}. ${lastOk}`,
      };
    case 'empty':
      return {
        lead: 'Baza je još',
        word: 'prazna',
        tone: 'var(--accent)',
        sub: `Prvo preuzimanje povlači satne vrednosti za ${syncWindowText()} sa svih aktivnih stanica i obično traje ${usual}.`,
      };
    case 'never-ok': {
      const { title, hint } = describeSyncError(state.run.message ?? 'Nepoznata greška');
      return { lead: 'Sinhronizacija još', word: 'nije uspela', tone: 'var(--danger)', sub: `${title}. ${hint}` };
    }
    case 'failed': {
      const { title, hint } =
        state.status === 'abandoned'
          ? { title: 'Funkcija nije upisala završetak', hint: 'Verovatno je prekinuta na limitu od 240 s.' }
          : describeSyncError(state.run.message ?? 'Nepoznata greška');
      return { lead: 'Poslednji pokušaj', word: 'nije uspeo', tone: 'var(--danger)', sub: `${title}. ${hint} ${lastOk}` };
    }
    case 'stale':
      return {
        lead: 'Podaci',
        word: 'kasne',
        tone: 'var(--warn)',
        sub: `${lastOk} To je duže od ${STALE_MINUTES} min – osvežite ih ručno${mode === 'rayfin' ? ' (pri sledećem otvaranju aplikacija to radi sama)' : ''}.`,
      };
    case 'sepa-late': {
      const latest = state.latestObservedAt;
      if (!latest) {
        return {
          lead: 'SEPA',
          word: 'kasni',
          tone: 'var(--warn)',
          sub: `Sinhronizacija je uspela, ali u bazi još nema merenja nijedne aktivne stanice. ${lastOk}`,
        };
      }
      const end = new Date(latest.getTime() + 3_600_000);
      const endText = isSameLocalDay(end, now) ? formatTime(end) : `${formatTime(end)} (${formatDayMonth(end)})`;
      return {
        lead: 'SEPA',
        word: 'kasni',
        tone: 'var(--warn)',
        // Starost od KRAJA intervala (`liveStatus().ageText`) – ista kao u čipu ljuske i pločici „Najnoviji sat u bazi“.
        sub: `Sinhronizacija je uspela, ali nema novih merenja od ${endText} – poslednji sat u bazi je ${formatHourInterval(latest)}, ${liveStatus(latest, now).ageText}. Izvor obično objavljuje sa kašnjenjem od 1–${LIVE_HOURS} h; nova merenja stižu sledećom sinhronizacijom. ${lastOk}`,
      };
    }
    case 'fresh': {
      // Pravilo iz `shouldAutoSync`: prag od 65 min ILI ranije, čim SEPA po očekivanju objavi nov sat.
      const rule = `kad su podaci stariji od ${STALE_MINUTES} min – ili ranije, čim SEPA po očekivanju objavi nov sat (najviše jednom u ${MIN_GAP_MINUTES} min)`;
      return {
        lead: 'Podaci su',
        word: 'sveži',
        tone: 'var(--ok)',
        sub: mode === 'demo' ? `${lastOk} U Fabric-u se aplikacija pri otvaranju sama osvežava ${rule}.` : `${lastOk} Pri otvaranju aplikacija sama osvežava podatke ${rule}.`,
      };
    }
  }
}
