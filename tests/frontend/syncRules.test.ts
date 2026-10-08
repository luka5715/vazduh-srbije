import { describe, expect, it } from 'vitest';

import type { DailyStatRecord, SyncRunRecord } from '@shared/contracts';
import { addDays } from '@shared/time';

import {
  coverageGapsText,
  EXPECTED_LAG_MINUTES,
  formatDayRanges,
  hasActiveRun,
  historyCoverage,
  historyWindowStart,
  isRemoteRunActive,
  isRunAbandoned,
  isRunInvalid,
  MIN_GAP_MINUTES,
  nextHourExpected,
  pickLastSuccessfulSync,
  refreshDecision,
  remoteRunOf,
  RUNNING_GRACE_MINUTES,
  shouldAutoSync,
  STALE_MINUTES,
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

  describe('sat koji je SEPA već objavila (newestObservedAt)', () => {
    // NOW = 09:30Z. Najnoviji interval u bazi počinje pre `minutesAgoStart` min; SLEDEĆI interval
    // se završava 2 h posle tog početka, a njegova objava se očekuje EXPECTED_LAG posle toga.
    const newest = (minutesAgoStart: number) => new Date(NOW.getTime() - minutesAgoStart * MINUTE);

    it('pretpostavke su imenovane na jednom mestu i konzervativne', () => {
      expect(EXPECTED_LAG_MINUTES).toBe(20);
      expect(MIN_GAP_MINUTES).toBe(20);
      expect(MIN_GAP_MINUTES).toBeLessThan(STALE_MINUTES);
    });

    it('nextHourExpected: tačno kad se SLEDEĆI interval završio pre više od EXPECTED_LAG', () => {
      // U bazi 07:00–08:00Z (početak pre 150 min): sledeći sat 08–09Z se završio u 09:00Z, objava
      // očekivana u 09:20Z → NOW 09:30Z je posle.
      expect(nextHourExpected(newest(150), NOW)).toBe(true);
      // U bazi 08:00–09:00Z (početak pre 90 min): to je sat koji VEĆ imamo; sledeći (09–10Z) se
      // završava tek u 10:00Z → ništa novo nema. (Ranija greška: ovde je bilo `true`, pa je pravilo
      // važilo odmah posle svake sinhronizacije i auto-sync se svodio na tajmer od MIN_GAP.)
      expect(nextHourExpected(newest(90), NOW)).toBe(false);
      // Granica: početak pre 140 min → objava sledećeg tačno u 09:30 nije PRE sada (ravno).
      expect(nextHourExpected(newest(140), NOW)).toBe(false);
      expect(nextHourExpected(newest(141), NOW)).toBe(true);
      // Interval 09:00–10:00Z još traje.
      expect(nextHourExpected(newest(30), NOW)).toBe(false);
      expect(nextHourExpected(null, NOW)).toBe(false);
      expect(nextHourExpected(undefined, NOW)).toBe(false);
      expect(nextHourExpected(new Date('nije datum'), NOW)).toBe(false);
    });

    it('nextHourExpected: kad SEPA objavljuje redovno, pravilo pokreće ~1 sinhronizaciju po satu, ne svakih MIN_GAP', () => {
      // Simulacija jedne otvorene kartice tokom 24 h: SEPA objavljuje sat `lagMinutes` posle
      // njegovog kraja, kartica proverava pravilo pri svakom tihom čitanju (na 12 min, prvo u
      // `phaseMinutes`). Svaki posao donosi sve sate koje je SEPA do tada objavila; „koristan“ je
      // posao koji donese nov sat.
      const simulateDay = (lagMinutes: number, phaseMinutes: number) => {
        const day0 = new Date('2026-10-08T00:00:00Z').getTime();
        let lastSyncAt = day0 - 10 * MINUTE;
        let newestInDb = day0 - 2 * 3_600_000; // u bazi 22–23Z, SEPA je 23–00Z objavila u 00:lag
        let syncs = 0;
        let useful = 0;
        for (let t = day0 + phaseMinutes * MINUTE; t < day0 + 24 * 3_600_000; t += 12 * MINUTE) {
          if (!shouldAutoSync(new Date(lastSyncAt), [], new Date(t), new Date(newestInDb))) continue;
          syncs++;
          lastSyncAt = t;
          const published = Math.floor((t - lagMinutes * MINUTE) / 3_600_000) * 3_600_000 - 3_600_000;
          if (published > newestInDb) {
            useful++;
            newestInDb = published;
          }
        }
        return { syncs, useful };
      };
      // SEPA objavi pre pretpostavljenog roka (EXPECTED_LAG): tačno 24 posla, svaki sa novim satom,
      // bez obzira na fazu provera. (Ranija formula je davala ~59 poslova, od kojih 35 bez novog sata.)
      expect(simulateDay(15, 0)).toEqual({ syncs: 24, useful: 24 });
      expect(simulateDay(15, 5)).toEqual({ syncs: 24, useful: 24 });
      // Živi uzorak (28 min, kasnije od pretpostavke): svaki sat ipak stigne; kad provera padne
      // između očekivane i stvarne objave, MIN_GAP ograničava višak na najviše jedan posao po satu.
      expect(simulateDay(28, 5)).toEqual({ syncs: 24, useful: 24 });
      const late = simulateDay(28, 0);
      expect(late.useful).toBe(24);
      expect(late.syncs).toBeLessThanOrEqual(48);
    });

    it('grana 2: očekivan nov sat + poslednja sinhronizacija starija od MIN_GAP → da (živi slučaj: 00–01 h u 01:28)', () => {
      const live = new Date('2026-10-08T01:28:00+02:00');
      // U bazi je 23–00 h: sledeći sat 00–01 h se završio u 01:00 i očekuje se od 01:20.
      const hour23 = new Date('2026-10-07T23:00:00+02:00');
      const hour00 = new Date('2026-10-08T00:00:00+02:00');
      const synced = (minutesAgo: number) => new Date(live.getTime() - minutesAgo * MINUTE);
      // Pravilo od 65 min: sinhronizacija od pre 28 min je „sveža“ → ništa; grana 2: 00–01 h je
      // objavljen (01:00 + 20 min = 01:20 < 01:28), a 28 min > MIN_GAP → sinhronizuj.
      expect(shouldAutoSync(synced(28), [], live, hour23)).toBe(true);
      // Kad je 00–01 h VEĆ u bazi, sledeći (01–02 h) se očekuje tek u 02:20 → ne sinhronizuj.
      expect(shouldAutoSync(synced(28), [], live, hour00)).toBe(false);
      // Ispod MIN_GAP (sinhronizovano pre 15 min) → ne, ma koliko sat bio očekivan.
      expect(shouldAutoSync(synced(15), [], live, hour23)).toBe(false);
      expect(shouldAutoSync(synced(MIN_GAP_MINUTES), [], live, hour23)).toBe(false);
      expect(shouldAutoSync(synced(MIN_GAP_MINUTES + 1), [], live, hour23)).toBe(true);
      // Posao druge sesije blokira i ovu granu.
      expect(shouldAutoSync(synced(28), [run({ startedAt: synced(1).toISOString() })], live, hour23)).toBe(false);
    });

    it('grana 2 se ne pali kad sledeći sat još nije očekivan; grana 1 (65 min) važi i tada', () => {
      // Najnoviji interval 09:00–10:00Z je u toku: nema šta da se preuzme.
      expect(shouldAutoSync(lastSync(30), [], NOW, newest(30))).toBe(false);
      expect(shouldAutoSync(lastSync(66), [], NOW, newest(30))).toBe(true);
      // U bazi 08:20–09:20Z: sledeći sat se završava u 10:20Z, pa ga SEPA sigurno još nije objavila.
      expect(shouldAutoSync(lastSync(30), [], NOW, newest(70))).toBe(false);
      // U bazi 07:00–08:00Z: sledeći (08–09Z) se završio pre 30 min > EXPECTED_LAG, ali je poslednja
      // sinhronizacija mlađa od MIN_GAP → ne; starija od MIN_GAP → da.
      expect(shouldAutoSync(lastSync(19), [], NOW, newest(150))).toBe(false);
      expect(shouldAutoSync(lastSync(21), [], NOW, newest(150))).toBe(true);
    });

    it('bez newestObservedAt (null, prazna baza) važi samo pravilo od 65 min', () => {
      expect(shouldAutoSync(lastSync(30), [], NOW, null)).toBe(false);
      expect(shouldAutoSync(lastSync(64), [], NOW, null)).toBe(false);
      expect(shouldAutoSync(lastSync(66), [], NOW, null)).toBe(true);
      expect(shouldAutoSync(null, [], NOW, null)).toBe(true);
    });

    it('najviše jedna automatska sinhronizacija po MIN_GAP: odmah posle posla pravilo kaže ne', () => {
      // Sinhronizacija upravo završena, ali SEPA i dalje kasni (sat star 5 h) → čeka se MIN_GAP.
      expect(shouldAutoSync(lastSync(0), [], NOW, newest(5 * 60))).toBe(false);
      expect(shouldAutoSync(lastSync(19), [], NOW, newest(5 * 60))).toBe(false);
      expect(shouldAutoSync(lastSync(21), [], NOW, newest(5 * 60))).toBe(true);
    });
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
    // Rubni dan (danas − 30) sa delom sati je ISTEKAO: izvor ga već briše, dopuna ga ne može
    // upotpuniti, pa nije u `incomplete` (dugme „Dopuni (N)“ ga ne broji) ni u `completeDays`.
    expect(coverage.incomplete).toEqual(['2026-09-27', '2026-10-03', '2026-10-04']);
    expect(coverage.expired).toEqual(['2026-09-07']);
    expect(coverage.days[0]).toMatchObject({ day: '2026-09-07', status: 'expired', complete: 0, reported: 10 });
    expect(coverage.missing).toEqual(['2026-10-03', '2026-10-04']);
    expect(coverage.days.find((d) => d.day === '2026-09-27')).toMatchObject({ status: 'partial', complete: 5, reported: 10 });
    // Najstariji dan koji se MOŽE dopuniti (27. 09.) izvor briše za 20 dana.
    expect(coverage.oldestIncompleteExpiresInDays).toBe(20);
    expect(coverageGapsText(coverage)).toBe('Nedostaju 03.–04. 10.; delimičan 27. 09.; istekao 07. 09. – izvor ga već briše.');
  });

  it('istekao rubni dan: samo prvi dan prozora koji već ima redove; prazan prvi dan ostaje „nije učitan“', () => {
    // Samo rubni dan je delimičan: ništa za dopunu, ali 29/30, ne 30/30.
    const edgeOnly = historyCoverage(network((daysAgo) => (daysAgo === 30 ? 7 : 24)), TODAY);
    expect(edgeOnly.incomplete).toEqual([]);
    expect(edgeOnly.expired).toEqual(['2026-09-07']);
    expect(edgeOnly.completeDays).toBe(29);
    expect(edgeOnly.oldestIncompleteExpiresInDays).toBeNull();
    expect(coverageGapsText(edgeOnly)).toBe('Svih 29 dana koje izvor još čuva je u bazi; istekao 07. 09. – izvor ga već briše.');
    // Rubni dan bez ijednog reda može (delimično) da se učita još danas → `missing`, ističe za 0 dana.
    const edgeMissing = historyCoverage(network((daysAgo) => (daysAgo === 30 ? null : 24)), TODAY);
    expect(edgeMissing.incomplete).toEqual(['2026-09-07']);
    expect(edgeMissing.expired).toEqual([]);
    expect(edgeMissing.days[0].status).toBe('missing');
    expect(edgeMissing.oldestIncompleteExpiresInDays).toBe(0);
    // Delimičan dan koji NIJE rubni ostaje `partial` (može da se dopuni).
    const inner = historyCoverage(network((daysAgo) => (daysAgo === 29 ? 7 : 24)), TODAY);
    expect(inner.incomplete).toEqual(['2026-09-08']);
    expect(inner.expired).toEqual([]);
    expect(inner.oldestIncompleteExpiresInDays).toBe(1);
    // Potpun rubni dan je potpun.
    expect(historyCoverage(network(() => 24), TODAY).expired).toEqual([]);
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

