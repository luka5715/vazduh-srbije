/**
 * Globalno stanje aplikacije „Atmosfera“: podaci, sinhronizacija, sočivo polutanta,
 * filter okruga, izabrana stanica, paleta komandi i tema.
 *
 * Orkestracija sinhronizacije:
 *  - automatska sinhronizacija (samo `rayfin`) kad je poslednja uspešna starija od
 *    `STALE_MINUTES` i niko drugi ne sinhronizuje (`shouldAutoSync`; napušteni i neispravni
 *    redovi ne blokiraju) – pri otvaranju i ponovo posle svakog tihog osvežavanja ispod;
 *  - povratak kartice posle > 10 min i svakih 12 min dok je vidljiva: tiho ponovno čitanje
 *    baze (neuspeh se prijavljuje, podaci ostaju) i ponovna provera pravila od 65 min – kartica
 *    na telefonu koja se vrati uveče ne ostaje na jutarnjim podacima;
 *  - dugme „Osveži“ (`refresh`) ne pokreće drugi posao dok druga sesija sinhronizuje, a posle
 *    skorašnje sinhronizacije (< 15 min) samo ponovo čita bazu (`refreshDecision`);
 *  - „Osveženo pre …“ samo iz ispravne `latestSuccessfulSync` (backfill ne piše snimke);
 *  - `dataVersion` raste posle svakog posla da bi se dnevna statistika ponovo učitala.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import type { CategoryRank } from '@shared/aqi';

import { useAuth } from '@/hooks/AuthContext';
import { useDashboardData, type DashboardData, type DashboardState, type ReloadOptions } from '@/hooks/useDashboardData';
import { useSync, type SyncControls, type SyncOutcome } from '@/hooks/useSync';
import { applyTheme, useTheme, type Theme } from '@/hooks/useTheme';
import { LENS_PARAM, OKRUG_PARAM, useStickyFilters, useView, type NavigateOptions } from '@/hooks/useView';
import {
  dominantCategory,
  filterByOkrug,
  hazeColor,
  isLens,
  okrugList,
  pmIntensity,
  rankByLens,
  type Lens,
} from '@/lib/insights';
import { runViewTransition } from '@/lib/motion';
import { formatRelative } from '@/lib/format';
import { activeViews, buildStationViews, computeNetworkKpis, isInactive, liveStatus, type NetworkKpis, type StationView } from '@/lib/stations';
import { isRunAbandoned, refreshDecision, remoteRunOf, RUNNING_GRACE_MINUTES, shouldAutoSync, validRuns } from '@/lib/syncRules';
import type { ViewName } from '@/lib/views';
import { createDataService, type DataService } from '@/services/dataService';

const MINUTE_MS = 60_000;
/** Dok sinhronizuje druga sesija, podaci se tiho ponovo učitavaju na ovoliko ms. */
export const REMOTE_POLL_MS = 25_000;
/** Poslednje učitavanje toliko pre isteka tolerancije za `running` red (posle ga ne čekamo). */
const GRACE_LEAD_MS = 5_000;
/** Kartica skrivena duže od ovoga se pri povratku tiho ponovo učitava. */
export const RESUME_RELOAD_MS = 10 * MINUTE_MS;
/** Dok je kartica vidljiva, podaci se tiho ponovo učitavaju na ovoliko ms. */
export const VISIBLE_RELOAD_MS = 12 * MINUTE_MS;

function floorMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

/** Najnoviji sat merenja među aktivnim stanicama, bez obzira na svežinu. */
function newestObservation(views: readonly StationView[]): Date | null {
  let newest: Date | null = null;
  for (const v of views) {
    if (isInactive(v) || !v.observedAt) continue;
    if (!newest || v.observedAt > newest) newest = v.observedAt;
  }
  return newest;
}

/**
 * Uspešna sinhronizacija posle koje najnoviji sat u bazi i dalje nije „uživo“ (izvor kasni):
 * umesto „Podaci su osveženi“ obaveštenje kaže da nema novih merenja – ili, kad je posao ipak
 * doneo novije sate (`before` = najnoviji sat pre posla), da su stigli, ali SEPA i dalje kasni.
 */
function withoutNewHours(
  outcome: Omit<SyncOutcome, 'at'>,
  newest: Date | null,
  before: Date | null,
  now: Date,
): Omit<SyncOutcome, 'at'> {
  if (outcome.kind !== 'sync' || outcome.tone !== 'ok' || liveStatus(newest, now).live) return outcome;
  const status = liveStatus(newest, now);
  if (newest && (!before || newest.getTime() > before.getTime())) {
    return {
      ...outcome,
      tone: 'partial',
      title: 'Osveženo – SEPA i dalje kasni',
      detail: `Stigla su novija merenja, ali je poslednji sat u bazi ${status.label}, ${status.ageText}. Ostali sati stižu sledećim sinhronizacijama.`,
    };
  }
  return {
    ...outcome,
    tone: 'partial',
    title: 'Sinhronizacija je uspela, ali SEPA nema novih merenja',
    detail: newest
      ? `Poslednji sat u bazi je ${status.label}, ${status.ageText}. Nova merenja stižu sledećom sinhronizacijom.`
      : 'U bazi još nema merenja nijedne aktivne stanice.',
  };
}

/** Stanje poslednjeg posla sinhronizacije za tačku u navigaciji. */
export type SyncHealth = 'ok' | 'error' | 'running' | 'abandoned' | 'none';

export interface AtmosferaValue {
  mode: 'rayfin' | 'demo';
  service: DataService;
  /** Rezultat `useDashboardData` (stanice, snimci, dnevnik, status, reload). */
  data: DashboardState & { reload: (options?: ReloadOptions) => Promise<DashboardData | null> };
  /** Kontrole sinhronizacije (`useSync`). */
  sync: SyncControls;
  /** Pokreće ručnu sinhronizaciju (dugme „Osveži“). */
  refresh: () => void;
  /** Trenutno vreme zaokruženo na minut (menja se jednom u minutu i posle sinhronizacije). */
  now: Date;
  /** Raste posle svake sinhronizacije/istorije → ponovno učitavanje dnevne statistike. */
  dataVersion: number;
  /** Poslednja uspešna sinhronizacija trenutnog stanja ili null. */
  lastSync: Date | null;
  syncHealth: SyncHealth;
  /** Učitavanje završeno i baza nema nijedan snimak (prvo pokretanje). */
  isEmpty: boolean;

  /** Sve stanice mreže (sortirane po imenu). */
  views: StationView[];
  /** Stanice izabranog okruga (= `views` kad filter nije postavljen). */
  filteredViews: StationView[];
  /** KPI filtrirane mreže (okrug). */
  kpis: NetworkKpis;
  /** KPI cele mreže (najnoviji sat, ukupan broj stanica …). */
  networkKpis: NetworkKpis;
  /**
   * Najnoviji sat merenja u bazi među aktivnim stanicama, BEZ obzira na svežinu (za razliku od
   * `networkKpis.latestObservedAt`, koji broji samo sveže stanice). Za „Uživo“ / „Poslednji sat“
   * u ljusci (`liveStatus` iz lib/stations) i stanje „SEPA kasni“ na stranici Sinhronizacija.
   */
  newestObservedAt: Date | null;
  /** Dominantna kategorija filtrirane mreže (boja izmaglice) ili null. */
  hazeRank: CategoryRank | null;
  /** `var(--cat-N)` ili `var(--accent)`. */
  hazeColor: string;
  /** Gustina čestica Košave 0–1 iz medijane PM10 filtrirane mreže. */
  particleIntensity: number;

  lens: Lens;
  setLens: (lens: Lens) => void;
  /** Okruzi sa bar jednom stanicom. */
  okrugs: string[];
  /** Izabrani okrug ili null (svi okruzi). */
  okrug: string | null;
  setOkrug: (okrug: string | null) => void;

  /**
   * Izabrana stanica: `?station=` ako postoji, inače najlošija sveža stanica filtrirane mreže.
   * Na Mapi se najlošija stanica odmah upisuje u URL (vidi efekat „pin“ u provideru), pa se
   * detalji ne menjaju sami posle osvežavanja podataka.
   */
  selected: StationView | null;
  selectedId: string | null;
  /** Bira stanicu na trenutnoj stranici (upisuje `?station=`, bez novog unosa u istoriji). */
  selectStation: (stationId: string) => void;
  /** Otvara stanicu na stranici Mapa (izabrana + detalji). */
  openStation: (stationId: string) => void;

  view: ViewName;
  navigate: (view: ViewName, options?: NavigateOptions) => void;

  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  theme: Theme;
  /** Menja temu; sa `origin` (centar dugmeta) radi kružno otkrivanje kroz View Transitions. */
  toggleTheme: (origin?: { x: number; y: number }) => void;
}

const AtmosferaContext = createContext<AtmosferaValue | undefined>(undefined);

export function AtmosferaProvider({ children }: { children: ReactNode }) {
  const { mode } = useAuth();
  const service = useMemo(() => createDataService(), []);
  const data = useDashboardData(service);
  const [dataVersion, setDataVersion] = useState(0);
  const [now, setNow] = useState(() => floorMinute(new Date()));
  const autoSyncTried = useRef(false);
  // Raste posle tihog ponovnog učitavanja: pravilo automatskog osvežavanja se proverava ponovo.
  const [autoSyncEpoch, setAutoSyncEpoch] = useState(0);

  const { reload } = data;
  // Najnoviji sat u bazi kakav je prikazan; tokom sopstvenog posla se podaci ne čitaju ponovo
  // (praćenje druge sesije i periodično čitanje miruju), pa je to stanje pre sinhronizacije.
  const newestShownRef = useRef<Date | null>(null);
  const onSyncComplete = useCallback(
    async (outcome: Omit<SyncOutcome, 'at'>) => {
      const before = newestShownRef.current;
      const loaded = await reload();
      const current = new Date();
      setDataVersion((v) => v + 1);
      setNow(floorMinute(current));
      if (!loaded) return outcome;
      return withoutNewHours(outcome, newestObservation(buildStationViews(loaded.stations, loaded.snapshots, current)), before, current);
    },
    [reload],
  );
  const sync = useSync(service, onSyncComplete);

  // Sat ide na 30 s kao ranije, ali se stanje menja samo kad se promeni minut.
  useEffect(() => {
    const timer = setInterval(() => {
      const next = floorMinute(new Date());
      setNow((previous) => (previous.getTime() === next.getTime() ? previous : next));
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const views = useMemo(() => buildStationViews(data.stations, data.snapshots, now), [data.stations, data.snapshots, now]);

  // Sočivo i okrug žive u URL-u (`?lens=`, `?okrug=`): važe na svim stranicama, preživljavaju
  // ponovno učitavanje i dele se linkom. Menjaju se zamenom unosa, pa „Nazad“ ostaje za stranice.
  // „Nazad“ kroz istoriju ne vraća stare filtere (useStickyFilters ih vraća na poslednji izbor).
  const { view, navigate, stationParam, setStationParam, lensParam, okrugParam, setFilterParam } = useView();
  const rememberFilter = useStickyFilters(lensParam, okrugParam);
  const lens: Lens = isLens(lensParam) ? lensParam : 'worst';
  const setLens = useCallback(
    (next: Lens) => {
      const value = next === 'worst' ? null : next;
      rememberFilter(LENS_PARAM, value);
      setFilterParam(LENS_PARAM, value);
    },
    [setFilterParam, rememberFilter],
  );
  // Samo okruzi sa bar jednom aktivnom stanicom: okrug čije su sve stanice ugašene se ne nudi.
  const okrugs = useMemo(() => okrugList(activeViews(views)), [views]);
  // Okrug koji ne postoji među stanicama ne filtrira (npr. posle sinhronizacije ili loš link).
  const okrug = okrugParam && okrugs.includes(okrugParam) ? okrugParam : null;
  const setOkrug = useCallback(
    (next: string | null) => {
      rememberFilter(OKRUG_PARAM, next);
      setFilterParam(OKRUG_PARAM, next);
    },
    [setFilterParam, rememberFilter],
  );

  const filteredViews = useMemo(() => filterByOkrug(views, okrug), [views, okrug]);
  const kpis = useMemo(() => computeNetworkKpis(filteredViews), [filteredViews]);
  const networkKpis = useMemo(() => (okrug ? computeNetworkKpis(views) : kpis), [okrug, views, kpis]);
  const newestObservedAt = useMemo(() => newestObservation(views), [views]);
  useEffect(() => {
    newestShownRef.current = newestObservedAt;
  }, [newestObservedAt]);
  const hazeRank = useMemo(() => dominantCategory(filteredViews), [filteredViews]);

  // Samo uspešna sinhronizacija trenutnog stanja (`kind: 'sync'`); `backfill` ne piše snimke.
  const { syncRuns, lastSuccessfulSync } = data;
  const lastSync = useMemo(
    () => (lastSuccessfulSync ? new Date(lastSuccessfulSync.finishedAt ?? lastSuccessfulSync.startedAt) : null),
    [lastSuccessfulSync],
  );

  // Automatska sinhronizacija (samo pravi backend): pri otvaranju i posle svakog tihog
  // ponovnog učitavanja (povratak kartice, periodično) – jednom po učitavanju podataka.
  const { startSync, busy, notify } = sync;
  useEffect(() => {
    if (mode !== 'rayfin' || data.status !== 'ready' || autoSyncTried.current || busy) return;
    autoSyncTried.current = true;
    // Napušteni i neispravni `running` redovi ne blokiraju automatsko osvežavanje.
    if (shouldAutoSync(lastSync, syncRuns, new Date())) void startSync({ auto: true });
  }, [mode, data.status, syncRuns, lastSync, busy, startSync, autoSyncEpoch]);

  // Kartica koja se vrati posle > 10 min (telefon!) i periodično dok je vidljiva: tiho
  // ponovno čitanje baze (neuspeh se prijavljuje, prikaz ostaje), pa ponovo pravilo od 65 min.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  // Tiho čitanje koje nije pokrenuo sopstveni posao (praćenje druge sesije, povratak kartice,
  // periodično): ako donese novu uspešnu sinhronizaciju, `dataVersion` raste.
  const externalReload = useRef(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const refreshQuietly = () => {
      if (busyRef.current) return;
      // Druga sesija je možda u međuvremenu sinhronizovala: nova uspešna sinhronizacija tada
      // ponovo učitava i dnevnu statistiku (efekat `lastOkId` ispod).
      externalReload.current = true;
      void reload({ quiet: true, report: true }).then((loaded) => {
        // Neuspelo čitanje (telefon van mreže, istekla prijava) ne pokreće sinhronizaciju –
        // pala bi isto; ostaje obaveštenje „Osvežavanje nije uspelo“.
        if (!loaded) return;
        autoSyncTried.current = false;
        setAutoSyncEpoch((epoch) => epoch + 1);
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      setNow(floorMinute(new Date()));
      if (hiddenFor > RESUME_RELOAD_MS) refreshQuietly();
    };
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshQuietly();
    }, VISIBLE_RELOAD_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);

  // Posao druge sesije: tiho ponovno učitavanje na 25 s i još jednom tik pred istek tolerancije
  // za `running` red – završetak stiže na ekran umesto da red posle 5 min izgleda „napušteno“.
  const remoteRun = sync.activity ? null : remoteRunOf(syncRuns, now);
  const remoteRunId = remoteRun?.id ?? null;
  const remoteStartedAt = remoteRun ? new Date(remoteRun.startedAt).getTime() : null;
  useEffect(() => {
    if (remoteRunId === null || remoteStartedAt === null) return;
    const poll = () => {
      externalReload.current = true;
      void reload({ quiet: true });
    };
    const interval = setInterval(poll, REMOTE_POLL_MS);
    const untilGrace = remoteStartedAt + RUNNING_GRACE_MINUTES * MINUTE_MS - GRACE_LEAD_MS - Date.now();
    const graceTimer = untilGrace > 0 ? setTimeout(poll, untilGrace) : null;
    return () => {
      clearInterval(interval);
      if (graceTimer) clearTimeout(graceTimer);
    };
  }, [remoteRunId, remoteStartedAt, reload]);

  // Sopstveni posao sam pomera `dataVersion` (onSyncComplete); posao druge sesije – kad
  // praćenje ili tiho čitanje (povratak kartice, periodično) donese novu uspešnu
  // sinhronizaciju – i dnevna statistika se ponovo učitava.
  useEffect(() => {
    if (sync.activity) externalReload.current = false;
  }, [sync.activity]);
  const lastOkId = lastSuccessfulSync?.id ?? null;
  const seenLastOkId = useRef(lastOkId);
  useEffect(() => {
    if (seenLastOkId.current === lastOkId) return;
    seenLastOkId.current = lastOkId;
    if (!externalReload.current) return;
    externalReload.current = false;
    setDataVersion((v) => v + 1);
    setNow(floorMinute(new Date()));
  }, [lastOkId]);

  // Neispravni redovi (npr. početak u budućnosti) ne određuju stanje u navigaciji.
  const latestRun = validRuns(syncRuns, now)[0];
  const syncHealth: SyncHealth = sync.activity
    ? 'running'
    : !latestRun
      ? 'none'
      : isRunAbandoned(latestRun, now)
        ? 'abandoned'
        : latestRun.status;

  // Dugme „Osveži“ (gornja traka, paleta): ne pokreće drugi posao dok druga sesija sinhronizuje,
  // a posle skorašnje sinhronizacije samo ponovo čita bazu – SEPA objavljuje jednom na sat.
  // „Osveži sada“ na stranici Sinhronizacija zove `sync.startSync` direktno i uvek radi.
  const refresh = useCallback(() => {
    if (busy) return;
    const current = new Date();
    const decision = refreshDecision(lastSync, syncRuns, current);
    if (decision.kind === 'remote') {
      void reload({ quiet: true });
      notify({
        kind: 'sync',
        ok: false,
        tone: 'info',
        title: 'Sinhronizacija je već u toku (druga sesija)',
        detail: `Pokrenuta je ${formatRelative(decision.run.startedAt, current)}; prikaz će se sam osvežiti kad se završi.`,
      });
      return;
    }
    if (decision.kind === 'recent') {
      void reload({ quiet: true, report: true });
      notify({
        kind: 'sync',
        ok: false,
        tone: 'info',
        title: `Osveženo ${formatRelative(decision.lastSync, current)} – SEPA objavljuje nova merenja jednom na sat`,
        detail: 'Ponovo su učitani podaci iz baze, bez nove sinhronizacije. Odmah je možete pokrenuti na stranici Sinhronizacija.',
      });
      return;
    }
    void startSync();
  }, [busy, lastSync, syncRuns, reload, notify, startSync]);

  // Podrazumevana stanica Mape = „Najlošije sada“ sa Pregleda (isto rangiranje po sočivu:
  // kategorija, pa odnos prema pragu), a ne prva po abecedi u najgoroj kategoriji.
  const worstNow = useMemo(() => rankByLens(filteredViews, lens, 1)[0]?.view ?? kpis.worst, [filteredViews, lens, kpis.worst]);
  const selected = useMemo(
    () => (stationParam ? views.find((v) => v.id === stationParam) : undefined) ?? worstNow ?? null,
    [stationParam, views, worstNow],
  );

  // Mapa bez `?station=`: najlošija stanica se upisuje u URL (zamenom) i tako „zakuca“ – posle
  // osvežavanja podataka ili minuta detalji ne skaču na drugu stanicu. Takav (implicitan) izbor
  // se menja samo kad promena okruga izbaci stanicu iz opsega; izbor korisnika nikad.
  const implicitPin = useRef<string | null>(null);
  const worstId = worstNow?.id ?? null;
  useEffect(() => {
    if (view !== 'mapa' || worstId === null) return;
    if (stationParam === null) {
      implicitPin.current = worstId;
      setStationParam(worstId);
      return;
    }
    if (implicitPin.current !== stationParam) return;
    if (!filteredViews.some((v) => v.id === stationParam)) {
      implicitPin.current = worstId;
      setStationParam(worstId);
    }
  }, [view, stationParam, worstId, filteredViews, setStationParam]);

  const selectStation = useCallback(
    (stationId: string) => {
      implicitPin.current = null;
      setStationParam(stationId);
    },
    [setStationParam],
  );
  const openStation = useCallback(
    (stationId: string) => {
      implicitPin.current = null;
      navigate('mapa', { stationId });
    },
    [navigate],
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const { theme, setTheme } = useTheme();
  const toggleTheme = useCallback(
    (origin?: { x: number; y: number }) => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark';
      const transition = runViewTransition('theme', () => {
        flushSync(() => setTheme(next));
        applyTheme(next);
      });
      if (!transition) return;
      const x = origin?.x ?? window.innerWidth - 40;
      const y = origin?.y ?? 32;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      transition.ready
        .then(() => {
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 560, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
          );
        })
        .catch(() => undefined);
    },
    [theme, setTheme],
  );

  const isEmpty = data.status === 'ready' && data.snapshots.length === 0;

  const value = useMemo<AtmosferaValue>(
    () => ({
      mode,
      service,
      data,
      sync,
      refresh,
      now,
      dataVersion,
      lastSync,
      syncHealth,
      isEmpty,
      views,
      filteredViews,
      kpis,
      networkKpis,
      newestObservedAt,
      hazeRank,
      hazeColor: hazeColor(hazeRank),
      particleIntensity: pmIntensity(kpis.medianPm10),
      lens,
      setLens,
      okrugs,
      okrug,
      setOkrug,
      selected,
      selectedId: selected?.id ?? null,
      selectStation,
      openStation,
      view,
      navigate,
      paletteOpen,
      openPalette,
      closePalette,
      theme,
      toggleTheme,
    }),
    [
      mode,
      service,
      data,
      sync,
      refresh,
      now,
      dataVersion,
      lastSync,
      syncHealth,
      isEmpty,
      views,
      filteredViews,
      kpis,
      networkKpis,
      newestObservedAt,
      hazeRank,
      lens,
      setLens,
      okrugs,
      okrug,
      setOkrug,
      selected,
      selectStation,
      openStation,
      view,
      navigate,
      paletteOpen,
      openPalette,
      closePalette,
      theme,
      toggleTheme,
    ],
  );

  return <AtmosferaContext.Provider value={value}>{children}</AtmosferaContext.Provider>;
}

/** Globalno stanje aplikacije; koristi se samo unutar `AtmosferaProvider`-a (DashboardPage). */
// eslint-disable-next-line react-refresh/only-export-components -- hook i provider dele fajl
export function useAtmosfera(): AtmosferaValue {
  const context = useContext(AtmosferaContext);
  if (!context) throw new Error('useAtmosfera se koristi samo unutar AtmosferaProvider-a');
  return context;
}
