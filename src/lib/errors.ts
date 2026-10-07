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

const SESSION_PATTERN = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid token|token (is )?(invalid|expired)|session expired/;
const NETWORK_PATTERN = /failed to fetch|network|\beconn|\bdns\b|offline/;

const SESSION = {
  title: 'Sesija nije važeća',
  hint: 'Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login), pa pokrenite osvežavanje.',
};

const NETWORK = {
  title: 'Nema veze sa Rayfin API-jem',
  hint: 'Proverite internet vezu i da li je Fabric stavka pokrenuta (npx rayfin up).',
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
  if (SESSION_PATTERN.test(lower)) return SESSION;
  if (/\btime(d )?out\b|\babort|\b(240|250)\s*s\b|deadline exceeded|vremenski limit/.test(lower)) {
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

/**
 * Greška čitanja podataka (GraphQL): istekla sesija (401/403, čest slučaj kad se kartica na
 * telefonu vrati posle više sati) i prekid mreže dobijaju isti savet kao sinhronizacija;
 * ostalo ostaje sirova poruka.
 */
export function describeDataError(error: unknown): { title: string; hint: string; known: boolean } {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (SESSION_PATTERN.test(lower)) return { ...SESSION, hint: 'Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).', known: true };
  if (NETWORK_PATTERN.test(lower)) return { ...NETWORK, known: true };
  return { title: 'Podaci nisu učitani', hint: message, known: false };
}

/** Tekst greške čitanja za banner: „Sesija nije važeća. Odjavite se …“ ili sirova poruka. */
export function dataErrorMessage(error: unknown): string {
  const { title, hint, known } = describeDataError(error);
  return known ? `${title}. ${hint}` : hint;
}
