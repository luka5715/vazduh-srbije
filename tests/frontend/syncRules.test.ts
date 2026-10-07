import { describe, expect, it } from 'vitest';

import type { DailyStatRecord, SyncRunRecord } from '@shared/contracts';
import { SYNC_ALREADY_RUNNING } from '@shared/syncNotes';
import { addDays } from '@shared/time';

import { dataErrorMessage, describeDataError, describeSyncError } from '@/lib/errors';

import {
  coverageGapsText,
  formatDayRanges,
  hasActiveRun,
  historyCoverage,
  historyWindowStart,
  isRemoteRunActive,
  isRunAbandoned,
  isRunInvalid,
  pickLastSuccessfulSync,
  refreshDecision,
  remoteRunOf,
  RUNNING_GRACE_MINUTES,
  shouldAutoSync,
  validRuns,
} from '@/lib/syncRules';

const NOW = new Date('2026-10-07T09:30:00Z');
const MINUTE = 60_000;

function run(overrides: Partial<SyncRunRecord> & { minutesAgo?: number } = {}): SyncRunRecord {
  const { minutesAgo = 1, ...rest } = overrides;
  const startedAt = new Date(NOW.getTime() - minutesAgo * MINUTE);
  return {
    id: `run-${minutesAgo}-${rest.kind ?? 'sync'}-${rest.status ?? 'running'}`,
    kind: 'sync',
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    windowFrom: new Date(startedAt.getTime() - 36 * 60 * MINUTE).toISOString(),
    windowTo: startedAt.toISOString(),
    stationsSeen: 0,
    observationsSeen: 0,
    rowsWritten: 0,
    message: null,
    ...rest,
  };
}

describe('isRemoteRunActive', () => {
  it('sveža `running` sinhronizacija bez sopstvenog posla = posao druge sesije', () => {
    const runs = [run({ minutesAgo: 1 }), run({ minutesAgo: 70, status: 'ok' })];
    expect(isRemoteRunActive(runs, null, NOW)).toBe(true);
    expect(remoteRunOf(runs, NOW)?.id).toBe(runs[0].id);
  });

  it('sopstveni posao u toku nije „druga sesija“', () => {
    const runs = [run({ minutesAgo: 1 })];
    expect(isRemoteRunActive(runs, { kind: 'sync' }, NOW)).toBe(false);
  });

  it('napušten red (stariji od tolerancije) se više ne prati', () => {
    const runs = [run({ minutesAgo: RUNNING_GRACE_MINUTES + 1 })];
    expect(isRunAbandoned(runs[0], NOW)).toBe(true);
    expect(isRemoteRunActive(runs, null, NOW)).toBe(false);
  });

  it('završen najnoviji red (ok ili greška) – nema praćenja', () => {
    expect(isRemoteRunActive([run({ status: 'ok' })], null, NOW)).toBe(false);
    expect(isRemoteRunActive([run({ status: 'error' })], null, NOW)).toBe(false);
    expect(isRemoteRunActive([], null, NOW)).toBe(false);
  });

  it('istorija druge sesije (najnoviji red je `backfill` u toku) se takođe prati', () => {
    const runs = [run({ kind: 'backfill', minutesAgo: 0.5 }), run({ minutesAgo: 30, status: 'ok' })];
    expect(isRemoteRunActive(runs, null, NOW)).toBe(true);
  });

  it('najnovija sinhronizacija u toku iza završenog `backfill` reda se prati', () => {
    const runs = [run({ kind: 'backfill', status: 'ok', minutesAgo: 0.5 }), run({ minutesAgo: 2 })];
    expect(remoteRunOf(runs, NOW)?.kind).toBe('sync');
  });
});

describe('neispravni redovi dnevnika (isRunInvalid)', () => {
  const forgedRunning = run({ id: 'forged', minutesAgo: 0, startedAt: '2099-01-01T00:00:00Z' });
  const forgedOk = run({ id: 'forged-ok', status: 'ok', startedAt: NOW.toISOString(), finishedAt: '2099-01-01T00:00:00Z' });

  it('početak ili završetak više od 5 min u budućnosti, nepoznata vrsta/status i nečitljivo vreme', () => {
    expect(isRunInvalid(forgedRunning, NOW)).toBe(true);
    expect(isRunInvalid(forgedOk, NOW)).toBe(true);
    expect(isRunInvalid(run({ kind: 'nesto' as SyncRunRecord['kind'] }), NOW)).toBe(true);
    expect(isRunInvalid(run({ status: 'gotovo' as SyncRunRecord['status'] }), NOW)).toBe(true);
    expect(isRunInvalid(run({ startedAt: 'nije datum' }), NOW)).toBe(true);
    expect(isRunInvalid(run({ status: 'ok', finishedAt: 'nije datum' }), NOW)).toBe(true);
    // Mala razlika satova (2 min) je dozvoljena.
    expect(isRunInvalid(run({ minutesAgo: -2 }), NOW)).toBe(false);
    expect(isRunInvalid(run({ minutesAgo: 3 }), NOW)).toBe(false);
  });

  it('red iz 2099. ne blokira automatsko osvežavanje i ne glumi posao druge sesije', () => {
    const runs = [forgedRunning, run({ id: 'old-ok', status: 'ok', minutesAgo: 120, finishedAt: new Date(NOW.getTime() - 118 * MINUTE).toISOString() })];
    expect(validRuns(runs, NOW).map((r) => r.id)).toEqual(['old-ok']);
    expect(remoteRunOf(runs, NOW)).toBeNull();
    expect(hasActiveRun(runs, NOW)).toBe(false);
    expect(shouldAutoSync(new Date(NOW.getTime() - 118 * MINUTE), runs, NOW)).toBe(true);
  });

  it('„Osveženo pre …“ preskače red iz budućnosti i uzima najnoviji ispravan', () => {
    const real = run({ id: 'real', status: 'ok', minutesAgo: 30, finishedAt: new Date(NOW.getTime() - 28 * MINUTE).toISOString() });
    expect(pickLastSuccessfulSync(forgedOk, [forgedOk, real], NOW)?.id).toBe('real');
    expect(pickLastSuccessfulSync(real, [real], NOW)?.id).toBe('real');
    expect(pickLastSuccessfulSync(forgedOk, [forgedOk], NOW)).toBeNull();
    // `backfill` nije sinhronizacija trenutnog stanja.
    expect(pickLastSuccessfulSync(null, [run({ kind: 'backfill', status: 'ok' })], NOW)).toBeNull();
  });
});

describe('automatsko osvežavanje i dugme „Osveži“', () => {
  const lastSync = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MINUTE);

  it('pravilo od 65 min: staro i niko ne radi → da; svež red druge sesije ili skorašnja sinhronizacija → ne', () => {
    expect(shouldAutoSync(null, [], NOW)).toBe(true);
    expect(shouldAutoSync(lastSync(66), [], NOW)).toBe(true);
    expect(shouldAutoSync(lastSync(60), [], NOW)).toBe(false);
    expect(shouldAutoSync(lastSync(90), [run({ minutesAgo: 2 })], NOW)).toBe(false);
    // Napušten red ne blokira.
    expect(shouldAutoSync(lastSync(90), [run({ minutesAgo: RUNNING_GRACE_MINUTES + 1 })], NOW)).toBe(true);
  });

  it('„Osveži“: posao druge sesije → ne pokreće novi; < 15 min → samo čitanje baze; inače sinhronizacija', () => {
    const remote = run({ minutesAgo: 1 });
    expect(refreshDecision(lastSync(5), [remote], NOW)).toEqual({ kind: 'remote', run: remote });
    expect(refreshDecision(lastSync(10), [], NOW)).toEqual({ kind: 'recent', lastSync: lastSync(10) });
    expect(refreshDecision(lastSync(16), [], NOW)).toEqual({ kind: 'sync' });
    expect(refreshDecision(null, [], NOW)).toEqual({ kind: 'sync' });
  });
});

describe('pokrivenost istorije (historyCoverage)', () => {
  const TODAY = '2026-10-07';
  /** Red dnevne statistike: stanica, dan (dana pre danas), broj sati. */
  function stat(station: number, daysAgo: number, hours: number, parameter: DailyStatRecord['parameter'] = 'PM10') {
    return { station_id: `s${station}`, day: addDays(TODAY, -daysAgo), hours, parameter };
  }
  /** 10 stanica sa punim danima za sve dane osim izuzetaka. */
  function network(exceptions: (daysAgo: number, station: number) => number | null) {
    const rows = [];
    for (let daysAgo = 1; daysAgo <= 30; daysAgo++) {
      for (let station = 0; station < 10; station++) {
        const hours = exceptions(daysAgo, station);
        if (hours !== null) rows.push(stat(station, daysAgo, hours));
      }
    }
    return rows;
  }

  it('potpun dan = ≥ 80 % stanica sa ≥ 18 h; rupe se dopunjavaju od najstarijeg', () => {
    const stats = network((daysAgo, station) => {
      if (daysAgo === 3 || daysAgo === 4) return null; // nije učitano
      if (daysAgo === 10) return station < 5 ? 24 : 6; // 5/10 punih → delimičan
      if (daysAgo === 12) return station < 8 ? 24 : null; // 8/10 = 80 % → potpun
      if (daysAgo === 30) return 7; // rub zadržavanja izvora: samo deo dana
      return 24;
    });
    // Današnji dan i dan pre prozora se ne računaju.
    stats.push(stat(0, 0, 10), stat(0, 31, 24));
    const coverage = historyCoverage(stats, TODAY);
    expect(historyWindowStart(TODAY)).toBe('2026-09-07');
    expect(coverage.days).toHaveLength(30);
    expect(coverage.days[0].day).toBe('2026-09-07');
    expect(coverage.days.at(-1)?.day).toBe('2026-10-06');
    expect(coverage.stations).toBe(10);
    expect(coverage.completeDays).toBe(26);
    expect(coverage.incomplete).toEqual(['2026-09-07', '2026-09-27', '2026-10-03', '2026-10-04']);
    expect(coverage.missing).toEqual(['2026-10-03', '2026-10-04']);
    expect(coverage.days.find((d) => d.day === '2026-09-27')).toMatchObject({ status: 'partial', complete: 5, reported: 10 });
    expect(coverage.oldestIncompleteExpiresInDays).toBe(0);
    expect(coverageGapsText(coverage)).toBe('Nedostaju 03.–04. 10.; delimični 07. 09., 27. 09.');
  });

  it('najbolji polutant stanice odlučuje; prazna baza = svih 30 dana nedostaje', () => {
    const stats = [stat(1, 2, 6, 'PM10'), stat(1, 2, 20, 'NO2')];
    expect(historyCoverage(stats, TODAY).days.find((d) => d.day === addDays(TODAY, -2))?.status).toBe('complete');
    const empty = historyCoverage([], TODAY);
    expect(empty.completeDays).toBe(0);
    expect(empty.incomplete).toHaveLength(30);
    expect(empty.missing).toHaveLength(30);
    expect(empty.oldestIncompleteExpiresInDays).toBe(0);
    const full = historyCoverage(network(() => 24), TODAY);
    expect(full.incomplete).toEqual([]);
    expect(full.oldestIncompleteExpiresInDays).toBeNull();
    expect(coverageGapsText(full)).toBe('Svih 30 prošlih dana je u bazi.');
  });

  it('dan od 25 h (prelazak na zimsko vreme) traži 19 h – isto pravilo kao Trendovi', () => {
    // 25. 10. 2026. ima 25 sati: 18 h tada nije 75 % dana.
    const today = '2026-10-27';
    const rows = (hours: number) => Array.from({ length: 10 }, (_, station) => ({ station_id: `s${station}`, day: '2026-10-25', hours, parameter: 'PM10' as const }));
    const status = (hours: number) => historyCoverage(rows(hours), today).days.find((d) => d.day === '2026-10-25')?.status;
    expect(status(18)).toBe('partial');
    expect(status(19)).toBe('complete');
  });

  it('rasponi dana: uzastopni dani, prelaz meseca, ostatak kao broj dana', () => {
    expect(formatDayRanges(['2026-10-04', '2026-10-03'])).toBe('03.–04. 10.');
    expect(formatDayRanges(['2026-09-30', '2026-10-01', '2026-10-05'])).toBe('30. 09.–01. 10., 05. 10.');
    expect(formatDayRanges(['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07', '2026-09-08'])).toBe('01. 09., 03. 09., 05. 09. i još 2 dana');
    expect(formatDayRanges([])).toBe('');
  });
});

describe('greške čitanja i sinhronizacije', () => {
  it('401/403 pri čitanju podataka (kartica vraćena posle više sati) daje savet o sesiji', () => {
    expect(describeDataError(new Error('GraphQL request failed: 401 Unauthorized'))).toMatchObject({ title: 'Sesija nije važeća', known: true });
    expect(dataErrorMessage('HTTP 403 Forbidden')).toBe('Sesija nije važeća. Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).');
    expect(dataErrorMessage(new TypeError('Failed to fetch'))).toMatch(/^Nema veze sa Rayfin API-jem\./);
    // Ostalo ostaje sirova poruka.
    expect(dataErrorMessage('Cannot query field "foo"')).toBe('Cannot query field "foo"');
  });

  it('odbijen drugi posao i vremenski limit sinhronizacije', () => {
    expect(describeSyncError(`${SYNC_ALREADY_RUNNING} (pokrenuta pre 2 min u drugoj sesiji).`).title).toBe('Sinhronizacija je već u toku');
    expect(describeSyncError('Vremenski limit sinhronizacije: https://x/stations').title).toBe('Funkcija nije završila u roku');
  });
});
