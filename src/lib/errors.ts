/**
 * Greške pretvara u tekst koji korisniku kaže šta da uradi.
 */

import { isAlreadyRunningError } from '@shared/syncNotes';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Nepoznata greška';
  }
}

/**
 * HTTP status sa objekta greške, ako ga nosi. Instalirani SDK ga stavlja na `NetworkError.status`,
 * a poruku gradi iz tela odgovora (npr. „Access token has expired“), pa regex nad tekstom nije
 * dovoljan. Gleda se i `statusCode`, `response.status` i ugnežđeni `cause` (do 3 nivoa).
 */
export function httpStatusOf(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== 'object' || depth > 3) return null;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } | null; cause?: unknown };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return httpStatusOf(e.cause, depth + 1);
}

// `401`/`403` samo kao HTTP status („HTTP 401“, „status 403“, „401 Unauthorized“): stanica sa
// SEPA id-om 401 (`Stanica 401:`, `station_id=401`) nije istekla sesija.
const SESSION_PATTERN =
  /\bhttp(?: error)?:? (401|403)\b|\bstatus(?: code)?:? (401|403)\b|\b(401|403) (unauthori[sz]ed|forbidden)\b|unauthori[sz]ed|forbidden|invalid token|token (is )?(invalid|expired)|session expired|access token has expired/;
const NETWORK_PATTERN = /failed to fetch|network|\beconn|\bdns\b|offline/;
const TIMEOUT_PATTERN = /\btime(d )?out\b|\babort|deadline exceeded/;

/**
 * Istekla ili odbijena sesija: prvo numerički status (401/403) sa objekta greške, pa tek kad
 * ga nema regex nad porukom. Poznat status koji nije 401/403 (npr. 500 sa rečju „token“ u
 * telu) nije sesija.
 */
function isSessionError(error: unknown, lower: string): boolean {
  const status = httpStatusOf(error);
  if (status !== null) return status === 401 || status === 403;
  return SESSION_PATTERN.test(lower);
}

const SESSION = {
  title: 'Sesija nije važeća',
  hint: 'Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login), pa pokrenite osvežavanje.',
};

const NETWORK = {
  title: 'Nema veze sa Rayfin API-jem',
  hint: 'Proverite internet vezu i da li je Fabric stavka pokrenuta (npx rayfin up).',
};

/** Nepoznata greška čitanja (npr. GraphQL odbio upit): opšti savet, sirova poruka ostaje u `detail`. */
const DB_READ = {
  title: 'Greška pri čitanju baze',
  hint: 'Pokušajte ponovo; ako se ponavlja, javite vlasniku.',
};

/**
 * Kratak savet uz grešku sinhronizacije (401, timeout, mreža …).
 *
 * Obrasci su usidreni na cele reči: Kosava URL u poruci sme da sadrži `station_id=240`,
 * a pomen „Rayfin token“ u tekstu nije sam po sebi istekla sesija. Redosled je bitan:
 * prvo sesija (najkonkretnija radnja), pa rok funkcije, pa mreža, pa izvor podataka.
 */
export function describeSyncError(error: unknown): { title: string; hint: string } {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  // Server je odbio drugi posao dok prvi radi (vidi `runningSync` u sync.ts) – nije greška podataka.
  if (isAlreadyRunningError(message)) {
    return {
      title: 'Sinhronizacija je već u toku',
      hint: 'Druga sesija upravo preuzima podatke sa SEPA; prikaz će se sam osvežiti kad ona završi.',
    };
  }
  if (isSessionError(error, lower)) return SESSION;
  if (TIMEOUT_PATTERN.test(lower) || /\b(240|250)\s*s\b|vremenski limit/.test(lower)) {
    return {
      title: 'Funkcija nije završila u roku',
      hint: 'Fabric funkcije imaju limit od 240 s. SEPA API je verovatno spor – sačekajte minut i pokušajte ponovo.',
    };
  }
  if (NETWORK_PATTERN.test(lower)) return NETWORK;
  if (/kosava|sepa|nijednu aktivnu stanicu|nema satnih merenja/.test(lower)) {
    return {
      title: 'SEPA/Kosava API nije vratio podatke',
      hint: 'Izvor podataka je trenutno nedostupan ili kasni. Pokušajte ponovo za nekoliko minuta.',
    };
  }
  return { title: 'Sinhronizacija nije uspela', hint: message };
}

export interface DataErrorText {
  title: string;
  hint: string;
  /** Greška je prepoznata (sesija, rok, mreža) i savet je konkretan; inače opšti savet. */
  known: boolean;
  /**
   * Sirova poruka (npr. „GraphQL errors: The specified input object field `gte` does not exist“)
   * – za `title` atribut ili „Detalji“, nikad kao glavni tekst.
   */
  detail: string;
}

/**
 * Greška čitanja podataka (GraphQL): istekla sesija (401/403 po statusu ili tekstu – čest slučaj
 * kad se kartica na telefonu vrati posle više sati), rok i prekid mreže dobijaju isti savet kao
 * sinhronizacija; sve ostalo je „Greška pri čitanju baze“ sa opštim savetom, a sirova poruka
 * ostaje u `detail`.
 */
export function describeDataError(error: unknown): DataErrorText {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (isSessionError(error, lower)) {
    return { ...SESSION, hint: 'Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).', known: true, detail: message };
  }
  if (TIMEOUT_PATTERN.test(lower)) {
    return { title: 'Baza nije odgovorila u roku', hint: 'Pokušajte ponovo za minut.', known: true, detail: message };
  }
  if (NETWORK_PATTERN.test(lower)) return { ...NETWORK, known: true, detail: message };
  return { ...DB_READ, known: false, detail: message };
}

/**
 * Tekst greške čitanja za baner: „Sesija nije važeća. Odjavite se …“ ili „Greška pri čitanju
 * baze. Pokušajte ponovo; …“ – nikad sirova poruka (ona je u `describeDataError(...).detail`).
 */
export function dataErrorMessage(error: unknown): string {
  const { title, hint } = describeDataError(error);
  return `${title}. ${hint}`;
}
