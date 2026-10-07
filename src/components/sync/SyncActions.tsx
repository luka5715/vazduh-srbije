import { CloudDownload, History, LoaderCircle, RefreshCw, Smartphone, Square } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import type { SyncActivity, SyncOutcome } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { formatDayLong, formatDayShort, formatInt } from '@/lib/format';

import { OUTCOME_STYLE } from './outcomeStyle';
import { formatElapsed, useElapsed } from './useElapsed';

import './sync.css';

type DayMark = 'ok' | 'failed' | 'done';

interface Trail {
  startedAt: number;
  ok: number;
  failed: number;
  marks: DayMark[];
}

/**
 * Ishod svakog završenog dana istorije, izveden iz brojača u `SyncActivity` (okDays/failedDays
 * rastu za 1 posle svakog dana). Dani završeni pre nego što je komponenta montirana dobijaju
 * oznaku `done` (redosled ishoda tada nije poznat), osim kad su svi isti.
 */
function useBackfillTrail(activity: Extract<SyncActivity, { kind: 'backfill' }>): DayMark[] {
  const [trail, setTrail] = useState<Trail | null>(null);
  const startedAt = activity.startedAt.getTime();
  let next = trail;
  if (!next || next.startedAt !== startedAt) {
    const processed = activity.okDays + activity.failedDays;
    const fill: DayMark = activity.failedDays === 0 ? 'ok' : activity.okDays === 0 ? 'failed' : 'done';
    next = { startedAt, ok: activity.okDays, failed: activity.failedDays, marks: Array.from({ length: processed }, () => fill) };
  } else if (activity.okDays + activity.failedDays > next.ok + next.failed) {
    const marks = [...next.marks];
    for (let i = next.failed; i < activity.failedDays; i++) marks.push('failed');
    for (let i = next.ok; i < activity.okDays; i++) marks.push('ok');
    next = { startedAt, ok: activity.okDays, failed: activity.failedDays, marks };
  }
  // Izvedeno stanje se usklađuje tokom renderovanja (React obrazac „stanje iz prethodnih propsa“).
  if (next !== trail) setTrail(next);
  return next.marks;
}

/** Napomena za telefon: petlja istorije radi u ovoj kartici i staje kad se ekran zaključa. */
export function KeepScreenOnNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[12px] leading-4 text-muted lg:hidden', className)}>
      <Smartphone aria-hidden className="size-3.5 shrink-0" />
      Držite ekran uključen – dani se učitavaju iz ove kartice.
    </p>
  );
}

/** Napredak dopunjavanja: segment po dnevu koji nedostaje (od najstarijeg), dan po dan. */
export function BackfillProgress({
  activity,
  compact = false,
  bare = false,
  className,
}: {
  activity: Extract<SyncActivity, { kind: 'backfill' }>;
  compact?: boolean;
  /** Samo traka segmenata (tekst je već prikazan pored, npr. u obaveštenju). */
  bare?: boolean;
  className?: string;
}) {
  const marks = useBackfillTrail(activity);
  const { index, total, day, okDays, failedDays, stopping, days } = activity;
  if (activity.planning) {
    return (
      <div className={cn('min-w-0', className)}>
        <p className={cn('flex items-center gap-2 text-[13px] leading-5 text-ink', bare && 'sr-only')}>
          <LoaderCircle aria-hidden className="spin size-3.5 shrink-0 text-accent" />
          Proveravam koji dani nedostaju u bazi…
        </p>
        <div role="progressbar" aria-label="Provera istorije u bazi" aria-valuetext="Provera u toku" className={cn('sync-indeterminate rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]', bare ? 'h-1.5' : 'mt-2 h-2.5')} />
      </div>
    );
  }
  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] leading-5', bare && 'hidden')}>
        <p className="text-ink">
          <span className="font-semibold">
            Dan {index} od {total}
          </span>
          <span className="text-muted"> · </span>
          <span className="tnum">{formatDayLong(day)}</span>
        </p>
        <p className="tnum text-muted">
          uspešno <span className="font-semibold text-ink">{formatInt(okDays)}</span>
          {failedDays ? (
            <>
              {' · '}neuspešno <span className="font-semibold text-danger">{formatInt(failedDays)}</span>
            </>
          ) : null}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Učitavanje istorije"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-valuetext={`Dan ${index} od ${total}: ${formatDayLong(day)}${stopping ? ', zaustavlja se posle ovog dana' : ''}`}
        className={cn('grid gap-[2px]', !bare && 'mt-2', compact ? 'h-1.5' : 'h-2.5')}
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, i) => {
          const mark = marks[i];
          const current = i === index - 1;
          return (
            <span
              key={i}
              className={cn(
                'rounded-[2px]',
                mark === 'failed' ? 'bg-danger' : mark ? 'bg-accent' : current ? 'sync-seg-current bg-accent/55' : 'bg-[color-mix(in_oklab,var(--muted)_18%,transparent)]',
                mark === 'done' && 'opacity-70',
              )}
            />
          );
        })}
      </div>
      {compact ? null : (
        <>
          <div aria-hidden className="mt-1.5 flex justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
            <span>{days[0] ? formatDayShort(days[0]) : ''}</span>
            <span>{days.length > 1 ? formatDayShort(days[days.length - 1]) : ''}</span>
          </div>
          <KeepScreenOnNote className="mt-2" />
        </>
      )}
    </div>
  );
}

/** Napredak sinhronizacije: neodređena traka + proteklo vreme (funkcija nema korake). */
export function SyncProgress({ activity, compact = false, className }: { activity: Extract<SyncActivity, { kind: 'sync' }>; compact?: boolean; className?: string }) {
  const elapsed = useElapsed(activity.startedAt);
  return (
    <div className={cn('min-w-0', className)}>
      {compact ? null : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] leading-5">
          <p className="font-semibold text-ink">{activity.auto ? 'Automatsko osvežavanje' : 'Preuzimanje sa SEPA'}</p>
          <p className="text-muted">
            <span className="tnum font-mono text-ink">{formatElapsed(elapsed)}</span> · obično 1–3 min
          </p>
        </div>
      )}
      <div
        role="progressbar"
        aria-label="Preuzimanje podataka sa SEPA"
        aria-valuetext={`U toku, ${formatElapsed(elapsed)}`}
        className={cn('sync-indeterminate rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]', compact ? 'mt-0 h-1' : 'mt-2 h-2')}
      />
    </div>
  );
}

export interface SyncActionsProps {
  activity: SyncActivity | null;
  /** Ishod poslednjeg posla (prikazuje se ispod dugmadi; obaveštenje u uglu ga najavljuje). */
  outcome?: SyncOutcome | null;
  onSync: () => void;
  onBackfill: () => void;
  onStop: () => void;
  mode: 'rayfin' | 'demo';
  /** Baza je prazna: glavno dugme kaže „Preuzmi podatke sa SEPA“. */
  firstRun?: boolean;
  /**
   * Broj prošlih dana koji u bazi nisu potpuni (`historyCoverage`), ili null dok se proverava.
   * 0 → „Istorija je potpuna“ (dugme onemogućeno); bez podatka → „Dopuni nedostajuće dane“.
   */
  incompleteDays?: number | null;
  size?: 'md' | 'lg';
  /** Dugmad se šire do pune širine reda (uska kolona: kad ne staju u jedan red, svako dobija svoj). */
  stretch?: boolean;
  className?: string;
}

/**
 * Velika dugmad „Osveži sada“ i „Učitaj istoriju (30 dana)“ sa napretkom posla i
 * zaustavljanjem istorije. Isti blok koriste stranica Sinhronizacija, prvi ekran i dnevnik.
 */
export function SyncActions({
  activity,
  outcome,
  onSync,
  onBackfill,
  onStop,
  mode,
  firstRun = false,
  incompleteDays,
  size = 'lg',
  stretch = false,
  className,
}: SyncActionsProps) {
  const syncing = activity?.kind === 'sync';
  const backfilling = activity?.kind === 'backfill';
  const buttonClass = stretch ? 'w-full sm:w-auto sm:flex-[1_1_auto]' : 'w-full sm:w-auto';
  const historyComplete = !firstRun && incompleteDays === 0;
  const backfillLabel = firstRun
    ? 'Učitaj istoriju (30 dana)'
    : historyComplete
      ? 'Istorija je potpuna'
      : typeof incompleteDays === 'number'
        ? `Dopuni nedostajuće dane (${formatInt(incompleteDays)})`
        : 'Dopuni nedostajuće dane';
  const OutcomeIcon = outcome ? OUTCOME_STYLE[outcome.tone].icon : null;
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="grid gap-2.5 sm:flex sm:flex-wrap sm:items-center">
        <Button
          variant="primary"
          size={size}
          onClick={onSync}
          loading={syncing}
          disabled={backfilling}
          icon={firstRun ? <CloudDownload aria-hidden /> : <RefreshCw aria-hidden />}
          className={buttonClass}
        >
          {syncing ? (firstRun ? 'Preuzimam podatke…' : 'Osvežavam…') : firstRun ? 'Preuzmi podatke sa SEPA' : 'Osveži sada'}
        </Button>
        {backfilling ? (
          <Button
            variant="secondary"
            size={size}
            onClick={onStop}
            disabled={activity.stopping}
            icon={<Square aria-hidden />}
            className={buttonClass}
          >
            {activity.stopping ? 'Zaustavljam posle ovog dana…' : 'Zaustavi'}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size={size}
            onClick={onBackfill}
            disabled={syncing || historyComplete}
            icon={<History aria-hidden />}
            className={buttonClass}
          >
            {backfillLabel}
          </Button>
        )}
      </div>

      {activity ? (
        <div className="rounded-tile border border-border bg-card-2 px-3.5 py-3">
          {activity.kind === 'sync' ? <SyncProgress activity={activity} /> : <BackfillProgress activity={activity} />}
        </div>
      ) : (
        <p className="text-[13px] leading-5 text-muted">
          {mode === 'demo'
            ? 'Demo: funkcije se samo simuliraju, ništa se ne preuzima sa SEPA.'
            : 'Funkcije rade na serveru 1–3 min. Dani koji nedostaju se dopunjavaju jedan po jedan, od najstarijeg; posle prekida se nastavlja od prvog koji još nedostaje.'}
        </p>
      )}

      {outcome && OutcomeIcon && !activity ? (
        <div className={cn('flex items-start gap-2.5 rounded-tile border px-3.5 py-3 text-sm', OUTCOME_STYLE[outcome.tone].box)}>
          <OutcomeIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{outcome.title}</p>
            {outcome.detail ? <p className="mt-0.5 break-words leading-5">{outcome.detail}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
