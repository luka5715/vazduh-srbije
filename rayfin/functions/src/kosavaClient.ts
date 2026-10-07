/**
 * HTTP klijent za SEPA / Kosava Open Data API (radi samo na serveru, u funkcijama).
 * Parsiranje odgovora je u ./shared/kosava.ts da bi se moglo testirati i u browseru.
 */
import {
  KOSAVA_BASE_URL,
  observationsUrl,
  parseObservations,
  parseStations,
  stationsUrl,
  type KosavaObservation,
  type KosavaStation,
} from './shared/kosava.js';

export interface KosavaClientOptions {
  baseUrl?: string;
  /** Vreme čekanja po zahtevu (ms). Podrazumevano 20 s. */
  timeoutMs?: number;
  /** Broj ponovnih pokušaja za mrežne greške, 429 i 5xx. Podrazumevano 2. */
  retries?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /**
   * Rok (epoch ms) posle koga se ne počinje nov pokušaj, a zahtev u toku se prekida:
   * vreme čekanja i pauze između pokušaja se skraćuju do roka. Bez roka – kao ranije.
   */
  deadline?: number;
}

/** Zahtev nije pokušan ili je prekinut jer je istekao rok sinhronizacije (`deadline`). */
export class DeadlineError extends Error {
  constructor(readonly url: string) {
    super(`Vremenski limit sinhronizacije: ${url}`);
    this.name = 'DeadlineError';
  }
}

export class KosavaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'KosavaHttpError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ms do roka (Infinity bez roka). */
function remainingMs(deadline: number | undefined): number {
  return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - Date.now();
}

/** Pauza pre sledećeg pokušaja; ako bi prešla rok, pokušaja više nema. */
async function backoff(ms: number, url: string, deadline: number | undefined): Promise<void> {
  if (remainingMs(deadline) <= ms) throw new DeadlineError(url);
  await sleep(ms);
}

export async function fetchJson(url: string, options: KosavaClientOptions = {}): Promise<unknown> {
  const { timeoutMs = 20_000, retries = 2, fetchImpl = fetch, log, deadline } = options;
  let attempt = 0;
  for (;;) {
    const remaining = remainingMs(deadline);
    if (remaining <= 0) throw new DeadlineError(url);
    const controller = new AbortController();
    // Rok skraćuje vreme čekanja: zahtev koji bi trajao preko roka se prekida na roku.
    const cutByDeadline = remaining < timeoutMs;
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'vazduh-srbije-fabric-app/1.0' },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          attempt++;
          log?.(`Kosava ${response.status} za ${url}, pokušaj ${attempt}/${retries}`);
          await backoff(500 * 2 ** attempt, url, deadline);
          continue;
        }
        throw new KosavaHttpError(`HTTP ${response.status} za ${url}`, response.status, url);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Nevalidan JSON sa ${url}`);
      }
    } catch (error) {
      if (error instanceof DeadlineError) throw error;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort && cutByDeadline && remainingMs(deadline) <= 0) throw new DeadlineError(url);
      const isNetwork = error instanceof TypeError || isAbort;
      if (isNetwork && attempt < retries) {
        attempt++;
        log?.(`Mrežna greška za ${url} (${(error as Error).message}), pokušaj ${attempt}/${retries}`);
        await backoff(500 * 2 ** attempt, url, deadline);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function fetchStations(options: KosavaClientOptions = {}): Promise<KosavaStation[]> {
  const payload = await fetchJson(stationsUrl(options.baseUrl ?? KOSAVA_BASE_URL), options);
  return parseStations(payload);
}

export async function fetchObservations(
  sepaId: number,
  from: Date,
  to: Date,
  options: KosavaClientOptions = {},
): Promise<KosavaObservation[]> {
  const payload = await fetchJson(observationsUrl(sepaId, from, to, options.baseUrl ?? KOSAVA_BASE_URL), options);
  return parseObservations(payload, sepaId);
}

/** Izvršava `fn` nad svim elementima sa najviše `limit` paralelnih poziva. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ObservationsBatch {
  observations: KosavaObservation[];
  failures: Array<{ sepaId: number; error: string }>;
  /** Stanice preskočene zbog roka (`startBy` ili `deadline`), bez upozorenja po stanici. */
  skipped: number[];
}

export interface FetchAllOptions extends KosavaClientOptions {
  concurrency?: number;
  /** Posle ovog trenutka (epoch ms) ne počinje preuzimanje nijedne nove stanice. */
  startBy?: number;
}

/** Satna merenja svih stanica u prozoru [from, to], sa ograničenom paralelnošću. */
export async function fetchAllObservations(
  stations: readonly KosavaStation[],
  from: Date,
  to: Date,
  options: FetchAllOptions = {},
): Promise<ObservationsBatch> {
  const failures: ObservationsBatch['failures'] = [];
  const skipped: number[] = [];
  const batches = await mapLimit(stations, options.concurrency ?? 6, async (station) => {
    if (options.startBy !== undefined && Date.now() >= options.startBy) {
      skipped.push(station.sepaId);
      return [] as KosavaObservation[];
    }
    try {
      return await fetchObservations(station.sepaId, from, to, options);
    } catch (error) {
      if (error instanceof DeadlineError) skipped.push(station.sepaId);
      else failures.push({ sepaId: station.sepaId, error: error instanceof Error ? error.message : String(error) });
      return [] as KosavaObservation[];
    }
  });
  return { observations: batches.flat(), failures, skipped };
}
