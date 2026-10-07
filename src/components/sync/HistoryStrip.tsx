import type { CSSProperties } from 'react';

import { Shimmer } from '@/components/fx/Shimmer';
import type { SyncActivity } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { formatDayLong, formatDayShort, formatInt, pluralSr } from '@/lib/format';
import { coverageGapsText, HISTORY_DAYS, type DayCoverage, type HistoryCoverage } from '@/lib/syncRules';

const STATUS_TEXT: Record<DayCoverage['status'], string> = {
  complete: 'potpun',
  partial: 'delimičan',
  missing: 'nije učitan',
};

/** Ćelija dana: puna boja = potpun, šrafura = delimičan, isprekidan okvir = nije učitan. */
function cellStyle(status: DayCoverage['status']): CSSProperties {
  switch (status) {
    case 'complete':
      return { backgroundColor: 'color-mix(in oklab, var(--ok) 72%, transparent)' };
    case 'partial':
      return {
        backgroundImage: 'repeating-linear-gradient(135deg, var(--warn) 0 3px, color-mix(in oklab, var(--warn) 30%, transparent) 3px 6px)',
      };
    case 'missing':
      return { border: '1px dashed color-mix(in oklab, var(--muted) 70%, transparent)' };
  }
}

function expiryText(days: number | null): string {
  if (days === null) return '';
  if (days <= 0) return 'Najstariji nepotpun dan izvor briše posle današnjeg dana.';
  if (days === 1) return 'Najstariji nepotpun dan izvor briše sutra.';
  return `Najstariji nepotpun dan izvor briše za ${formatInt(days)} ${pluralSr(days, 'dan', 'dana', 'dana')}.`;
}

function Legend() {
  const items: Array<[DayCoverage['status'], string]> = [
    ['complete', 'potpun'],
    ['partial', 'delimičan'],
    ['missing', 'nije učitan'],
  ];
  return (
    <ul aria-hidden className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] leading-4 text-muted">
      {items.map(([status, label]) => (
        <li key={status} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px]" style={cellStyle(status)} />
          {label}
        </li>
      ))}
    </ul>
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
  activity,
  className,
}: {
  coverage: HistoryCoverage | null;
  loading: boolean;
  error: string | null;
  activity: SyncActivity | null;
  className?: string;
}) {
  const backfill = activity?.kind === 'backfill' && !activity.planning ? activity : null;
  const done = new Set(backfill ? backfill.days.slice(0, Math.max(0, backfill.index - 1)) : []);
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
        <Legend />
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
              const current = backfill?.day === day.day;
              const filled = done.has(day.day);
              return (
                <span
                  key={day.day}
                  title={`${formatDayLong(day.day)}: ${STATUS_TEXT[day.status]} (${day.complete}/${coverage.stations} stanica sa punim danom)`}
                  className={cn('rounded-[2px]', current && 'sync-seg-current')}
                  style={current || filled ? { backgroundColor: current ? 'color-mix(in oklab, var(--accent) 60%, transparent)' : 'var(--accent)' } : cellStyle(day.status)}
                />
              );
            })}
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
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
        <p className="mt-2 text-[13px] leading-5 text-muted">Pokrivenost istorije nije učitana{error ? `: ${error}` : '.'}</p>
      )}
      <p className="mt-1.5 text-[12.5px] leading-5 text-faint">
        Bez otvaranja aplikacije nema sinhronizacije: dan koji niko ne dopuni dok ga izvor čuva ({HISTORY_DAYS} dana) trajno nedostaje.
      </p>
    </section>
  );
}
