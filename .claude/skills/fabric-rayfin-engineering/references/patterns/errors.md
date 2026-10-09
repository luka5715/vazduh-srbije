# Pattern: turning SDK errors into text a user can act on

Adapted from `src/lib/errors.ts` of a shipped Fabric App. Two lessons drove it: the SDK puts the HTTP
status on the error object (`NetworkError.status`) and builds the message from the response body, so a
regex over the text is not enough; and "401" can be a station id inside a URL.

```ts
/**
 * HTTP status carried by an error, if any: `status`, `statusCode`, `response.status`, then the nested
 * `cause` chain (undici wraps network failures), up to 3 levels deep.
 */
export function httpStatusOf(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== 'object' || depth > 3) return null;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } | null; cause?: unknown };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return httpStatusOf(e.cause, depth + 1);
}

// Status words only as HTTP statuses: "Stanica 401:" or "station_id=401" in a source URL is NOT a session error.
const SESSION_PATTERN =
  /\bhttp(?: error)?:? (401|403)\b|\bstatus(?: code)?:? (401|403)\b|\b(401|403) (unauthori[sz]ed|forbidden)\b|unauthori[sz]ed|forbidden|invalid token|token (is )?(invalid|expired)|session expired|access token has expired/;
const NETWORK_PATTERN = /failed to fetch|network|\beconn|\bdns\b|offline/;
const TIMEOUT_PATTERN = /\btime(d )?out\b|\babort|deadline exceeded/;

/** Numeric status first; the regex is a fallback only when no status is present. */
function isSessionError(error: unknown, lower: string): boolean {
  const status = httpStatusOf(error);
  if (status !== null) return status === 401 || status === 403;   // a 500 that mentions "token" is not a session error
  return SESSION_PATTERN.test(lower);
}

export interface DataErrorText {
  title: string;   // what happened, in the user's words
  hint: string;    // what to do
  known: boolean;  // recognised class (session, timeout, network) vs generic
  detail: string;  // raw message – for a collapsible "Detalji", never the main text
}

/** Read errors (GraphQL). Order matters: session, then timeout, then network, then generic. */
export function describeDataError(error: unknown): DataErrorText {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (isSessionError(error, lower)) {
    return { title: 'Sesija nije važeća', hint: 'Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).', known: true, detail: message };
  }
  if (TIMEOUT_PATTERN.test(lower)) return { title: 'Baza nije odgovorila u roku', hint: 'Pokušajte ponovo za minut.', known: true, detail: message };
  if (NETWORK_PATTERN.test(lower)) return { title: 'Nema veze sa Rayfin API-jem', hint: 'Proverite internet vezu i da li je Fabric stavka pokrenuta (npx rayfin up).', known: true, detail: message };
  // e.g. "GraphQL errors: The specified input object field `gte` does not exist." lands here
  return { title: 'Greška pri čitanju baze', hint: 'Pokušajte ponovo; ako se ponavlja, javite vlasniku.', known: false, detail: message };
}

/** Function-call errors add two classes: "already running" (a notice, not an error) and the host limit. */
export function describeSyncError(error: unknown): { title: string; hint: string } {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (isAlreadyRunningError(message)) {   // message starts with the shared constant from `@shared/syncNotes`
    return { title: 'Sinhronizacija je već u toku', hint: 'Druga sesija upravo preuzima podatke; prikaz će se sam osvežiti kad ona završi.' };
  }
  if (isSessionError(error, lower)) return SESSION;
  if (TIMEOUT_PATTERN.test(lower) || /\b(240|250)\s*s\b|vremenski limit/.test(lower)) {
    return { title: 'Funkcija nije završila u roku', hint: 'Fabric funkcije imaju limit od 240 s. Izvor je verovatno spor – sačekajte minut i pokušajte ponovo.' };
  }
  if (NETWORK_PATTERN.test(lower)) return NETWORK;
  return { title: 'Sinhronizacija nije uspela', hint: message };
}
```

Tests to keep: a `NetworkError`-like object with `status: 401` and a body text without the word
"unauthorized" → session; `"Stanica 401: HTTP 500 za …station_id=401"` → not a session error; a status 500
whose body says "token" → not a session error; the `gte` GraphQL message → generic title with the raw text
in `detail`.

UI contract: banners render `title. hint`; `detail` goes into a `<details>` element ("Detalji"); a
"Pokušaj ponovo" button rereads bypassing any shared cache.
