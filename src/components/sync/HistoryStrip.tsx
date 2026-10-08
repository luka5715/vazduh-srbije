import { RotateCw } from 'lucide-react';
import type { CSSProperties } from 'react';

import { Shimmer } from '@/components/fx/Shimmer';
import { Button } from '@/components/ui/Button';
import type { SyncActivity } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { formatDayLong, formatDayShort, formatInt, pluralSr } from '@/lib/format';
import { coverageGapsText, HISTORY_DAYS, type DayCoverageStatus, type HistoryCoverage } from '@/lib/syncRules';

import './sync.css';

/**
 * Tekst stanja dana. `expired` je prvi dan prozora koji već ima redove, a izvor ga danas briše:
 * ne može se dopuniti, pa ne sme da izgleda kao rupa (pravilo pokrivenosti ga ne broji u
 * `incomplete` ni u dugme „Dopuni nedostajuće dane (N)“; traka ga samo označava).
 */
const STATUS_TEXT: Record<DayCoverageStatus, string> = {
  complete: 'potpun',
  partial: 'delimičan',
  missing: 'nije učitan',
  expired: 'istekao',
};

/** Ćelija dana: puna boja = potpun, šrafura = delimičan, isprekidan okvir = nije učitan, siva šrafura = istekao. */
function cellStyle(status: DayCoverageStatus): CSSProperties {
  switch (status) {
    case 'complete':
      return { backgroundColor: 'color-mix(in oklab, var(--ok) 72%, transparent)' };
    case 'partial':
      return {
        backgroundImage: 'repeating-linear-gradient(135deg, var(--warn) 0 3px, color-mix(in oklab, var(--warn) 30%, transparent) 3px 6px)',
      };
    case 'missing':
      return { border: '1px dashed color-mix(in oklab, var(--muted) 70%, transparent)' };
    case 'expired':
      return {
        backgroundImage:
          'repeating-linear-gradient(45deg, color-mix(in oklab, var(--muted) 55%, transparent) 0 2px, color-mix(in oklab, var(--muted) 12%, transparent) 2px 5px)',
      };
  }
}

/** Objašnjenje u tooltipu ćelije; samo istekao dan ga ima. */
function cellNote(status: DayCoverageStatus): string {
  return status === 'expired' ? ' – izvor ga već briše' : '';
}

function expiryText(days: number | null): string {
  if (days === null) return '';
  if (days <= 0) return 'Najstariji nepotpun dan izvor briše posle današnjeg dana.';
  if (days === 1) return 'Najstariji nepotpun dan izvor briše sutra.';
  return `Najstariji nepotpun dan izvor briše za ${formatInt(days)} ${pluralSr(days, 'dan', 'dana', 'dana')}.`;
}

/** Legenda; „istekao“ se dodaje samo kad takav dan postoji (retko stanje, prvi dan prozora). */
function Legend({ expired }: { expired: boolean }) {
  const items: DayCoverageStatus[] = ['complete', 'partial', 'missing', ...(expired ? (['expired'] as const) : [])];
  return (
    <ul aria-hidden className="sync-stamp flex flex-wrap gap-x-3.5 gap-y-1 leading-4 text-muted">
      {items.map((status) => (
        <li key={status} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px]" style={cellStyle(status)} />
          {STATUS_TEXT[status]}
        </li>
      ))}
    </ul>
  );
}

/** Pokrivenost nije učitana: ljudski naslov, savet iz sloja podataka i „Pokušaj ponovo“. */
function CoverageError({ error, detail, reload }: { error: string | null; detail?: string | null; reload?: () => void }) {
  return (
    <div role="alert" className="mt-2.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-tile border border-danger/30 bg-danger-soft px-3.5 py-3 text-danger-soft-ink">
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <p className="font-semibold">Pokrivenost istorije nije učitana</p>
        <p className="mt-0.5 break-words">{error ?? 'Pokušajte ponovo; ako se ponavlja, javite vlasniku.'}</p>
        {detail ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[12.5px] underline-offset-2 hover:underline">Detalji</summary>
            <p className="sync-stamp mt-1 break-words font-mono leading-4 opacity-90">{detail}</p>
          </details>
        ) : null}
      </div>
      {reload ? (
        <Button size="sm" variant="secondary" onClick={reload} icon={<RotateCw aria-hidden />} className="shrink-0">
          Pokušaj ponovo
        </Button>
      ) : null}
    </div>
  );
}

/**
 * „Istorija u bazi · 27/30 dana“: traka od 30 prošlih dana (najstariji levo) sa stanjem svakog
 * dana, rečenica o rupama i roku izvora, i napomena da bez otvaranja aplikacije nema
 * sinhronizacije. Dok traje dopunjavanje, dan koji se učitava pulsira, a obrađeni dani su obojeni.
 */
export function HistoryStrip({
  coverage,
  loading,
  error,
  errorDetail,
  reload,
  activity,
  className,
}: {
  coverage: HistoryCoverage | null;
  loading: boolean;
  /** Poruka neuspelog čitanja, već prevedena u savet (`dataErrorMessage`). */
  error: string | null;
  /** Sirova poruka greške za „Detalji“ (kad je sloj podataka izdvoji). */
  errorDetail?: string | null;
  /** Ponovno čitanje pokrivenosti („Pokušaj ponovo“ u stanju greške). */
  reload?: () => void;
  activity: SyncActivity | null;
  className?: string;
}) {
  const backfill = activity?.kind === 'backfill' && !activity.planning ? activity : null;
  const done = new Set(backfill ? backfill.days.slice(0, Math.max(0, backfill.index - 1)) : []);
  const hasExpired = coverage?.days.some((day) => day.status === 'expired') ?? false;
  return (
    <section aria-labelledby="history-strip-title" className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="history-strip-title" className="eyebrow">
          Istorija u bazi
          {coverage ? (
            <span className="text-ink">
              {' '}
              · {formatInt(coverage.completeDays)}/{HISTORY_DAYS} dana
            </span>
          ) : null}
        </h3>
        <Legend expired={hasExpired} />
      </div>

      {coverage ? (
        <>
          <div
            role="img"
            aria-label={`Istorija u bazi: ${coverage.completeDays} od ${HISTORY_DAYS} prošlih dana potpuno. ${coverageGapsText(coverage)}`}
            className="mt-2.5 grid h-3.5 gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${coverage.days.length}, minmax(0, 1fr))` }}
          >
            {coverage.days.map((day) => {
              const { status } = day;
              const current = backfill?.day === day.day;
              const filled = done.has(day.day);
              return (
                <span
                  key={day.day}
                  title={`${formatDayLong(day.day)}: ${STATUS_TEXT[status]}${cellNote(status)} (${formatInt(day.complete)}/${formatInt(coverage.stations)} stanica sa punim danom)`}
                  className={cn('rounded-[2px]', current && 'sync-seg-current')}
                  style={current || filled ? { backgroundColor: current ? 'color-mix(in oklab, var(--accent) 60%, transparent)' : 'var(--accent)' } : cellStyle(status)}
                />
              );
            })}
          </div>
          <div aria-hidden className="sync-fine mt-1.5 flex justify-between font-mono uppercase tracking-[0.08em] text-faint">
            <span>{coverage.days[0] ? formatDayShort(coverage.days[0].day) : ''}</span>
            <span>juče</span>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-muted">
            <span className={coverage.incomplete.length ? 'text-ink' : undefined}>{coverageGapsText(coverage)}</span>{' '}
            {expiryText(coverage.oldestIncompleteExpiresInDays)}
          </p>
        </>
      ) : loading ? (
        <Shimmer className="mt-2.5 h-3.5" />
      ) : (
        <CoverageError error={error} detail={errorDetail} reload={reload} />
      )}
      <p className="mt-1.5 text-[12.5px] leading-5 text-faint">
        Bez otvaranja aplikacije nema sinhronizacije: dan koji niko ne dopuni dok ga izvor čuva ({HISTORY_DAYS} dana) trajno nedostaje.
      </p>
    </section>
  );
}
