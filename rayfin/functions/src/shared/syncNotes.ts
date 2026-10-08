/**
 * Tekstovi upozorenja i grešaka sinhronizacije koje funkcije pišu (u `SyncResult.warnings`
 * i `SyncRun.message`), a frontend čita – oblik je ugovor, zato je na jednom mestu.
 * Bez Node.js uvoza: frontend ovaj modul uvozi kao `@shared/syncNotes`.
 *
 * Šema baze se ne menja: „delimična“ sinhronizacija je `ok` red čija poruka sadrži bar
 * jedno upozorenje o stanici (`Stanica N: …`), o vremenskom limitu ili o redovima koje ni
 * ponovni pokušaj nije upisao u bazu (`N redova nije upisano u bazu`).
 */

/** Greška kad sinhronizacija trenutnog stanja već radi u drugoj sesiji (server je odbija). */
export const SYNC_ALREADY_RUNNING = 'Sinhronizacija je već u toku';

/** Razdvajač upozorenja u `SyncRun.message` (vidi `warningsText` u sync.ts). */
export const WARNING_SEPARATOR = ' | ';

const STATION_WARNING = /^Stanica (\d+): /;
const DEADLINE_WARNING = /^(\d+) stanic[aei] preskočen[aeo] – vremenski limit/;
const UNWRITTEN_WARNING = /^(\d+) red(?:a|ova)? ni(?:je|su) upisan[ao]? u bazu/;

function pluralSr(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** „Stanica 106: HTTP 500 za …“ – izvor nije vratio merenja jedne stanice. */
export function stationWarning(sepaId: number, error: string): string {
  return `Stanica ${sepaId}: ${error}`;
}

/**
 * „3 stanice preskočene – vremenski limit“: stanice čija merenja nisu preuzeta jer bi
 * sinhronizacija inače prešla limit Fabric funkcije (250 s).
 */
export function deadlineWarning(skipped: number): string {
  const noun = pluralSr(skipped, 'stanica preskočena', 'stanice preskočene', 'stanica preskočeno');
  return `${skipped} ${noun} – vremenski limit`;
}

/**
 * „3 reda nisu upisana u bazu“: redovi (stanice, snimci, dnevna statistika) čiji je upis pao na
 * prolaznoj grešci baze i nije uspeo ni posle ponovnog pokušaja. Posao ostaje `ok` (sve ostalo
 * je upisano), a sledeća sinhronizacija te redove piše ponovo; frontend ga vodi kao „Delimično“.
 */
export function unwrittenRowsWarning(count: number): string {
  const text = pluralSr(count, 'red nije upisan', 'reda nisu upisana', 'redova nije upisano');
  return `${count} ${text} u bazu`;
}

export function isAlreadyRunningError(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith(SYNC_ALREADY_RUNNING);
}

export interface SyncWarningSummary {
  /** Stanice za koje izvor nije vratio merenja (`Stanica N: …`). */
  failedStations: number;
  /** Stanice preskočene zbog vremenskog limita. */
  skippedStations: number;
  /** Redovi koje ni ponovni pokušaj nije upisao u bazu (`N redova nije upisano u bazu`). */
  unwrittenRows: number;
  /** Bar jedna stanica bez merenja ili bar jedan neupisan red u ovom poslu – rezultat je delimičan. */
  partial: boolean;
}

/** Sažetak upozorenja (iz `SyncResult.warnings` ili razdvojene `SyncRun.message`). */
export function summarizeSyncWarnings(warnings: readonly string[]): SyncWarningSummary {
  let failedStations = 0;
  let skippedStations = 0;
  let unwrittenRows = 0;
  for (const warning of warnings) {
    const text = warning.trim();
    if (STATION_WARNING.test(text)) {
      failedStations++;
      continue;
    }
    const deadline = DEADLINE_WARNING.exec(text);
    if (deadline) {
      skippedStations += Number(deadline[1]);
      continue;
    }
    const unwritten = UNWRITTEN_WARNING.exec(text);
    if (unwritten) unwrittenRows += Number(unwritten[1]);
  }
  return { failedStations, skippedStations, unwrittenRows, partial: failedStations + skippedStations + unwrittenRows > 0 };
}

/**
 * Upozorenja iz `SyncRun.message`. Poruka nosi najviše prvih 5 upozorenja i skraćena je
 * na ~900 znakova, pa `complete` kaže da li je broj stanica tačan ili donja granica.
 */
export function warningsFromMessage(message: string | null | undefined): { warnings: string[]; complete: boolean } {
  const text = message?.trim() ?? '';
  if (!text) return { warnings: [], complete: true };
  const warnings = text.split(WARNING_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const truncated = text.endsWith('…');
  return { warnings, complete: !truncated && warnings.length < 5 };
}
