import { CircleAlert, CircleDashed, CircleHelp, Info, TriangleAlert } from 'lucide-react';

import type { SyncRunRecord } from '@shared/contracts';
import { summarizeSyncWarnings, unwrittenRowsWarning, warningsFromMessage } from '@shared/syncNotes';

import { cn } from '@/lib/cn';
import { describeSyncError } from '@/lib/errors';
import { formatDateTime, formatDayShort, formatDuration, formatInt, formatRelative, formatTime, stationsNoun } from '@/lib/format';

import { RunStatusBadge, RunStatusNode } from './RunStatus';
import {
  ABANDONED_NOTE,
  backfillDayOf,
  durationScaleMs,
  FUNCTION_LIMIT_MS,
  groupRunsByDay,
  INVALID_NOTE,
  runDurationMs,
  runMissingStations,
  runKindLabel,
  runMessage,
  runStatus,
  runWindowText,
  type RunStatus,
} from './runModel';
import type { RunLogView } from './RunLogToggle';

import './sync.css';

function runTitle(run: SyncRunRecord): string {
  const day = backfillDayOf(run);
  return day ? `${runKindLabel(run)} · ${formatDayShort(day)}` : runKindLabel(run);
}

/**
 * Trajanje: tekst + tanka traka. Puna traka je najduži završeni posao u prikazanom dnevniku
 * (najmanje 60 s, `durationScaleMs`), pa se poslovi od 12 s i 30 s razlikuju; kraj staze nosi tu
 * skalu. Napušten posao je puna šrafirana traka, greška je crvena; žuto tek iznad 75 % limita
 * funkcije (240 s), koji ostaje tekst u pločici heroja. Koren je JEDINI omotač para dt/dd unutar
 * `<dl>` (klase rasporeda idu kroz `className`).
 */
function DurationMeter({ run, status, scaleMs, className }: { run: SyncRunRecord; status: RunStatus; scaleMs: number; className?: string }) {
  const ms = runDurationMs(run, status);
  const ratio = ms === null ? (status === 'abandoned' ? 1 : 0) : Math.min(1, ms / scaleMs);
  const text = ms !== null ? formatDuration(ms) : status === 'abandoned' ? 'bez završetka' : status === 'running' ? 'u toku…' : '–';
  const slow = ms !== null && ms > FUNCTION_LIMIT_MS * 0.75;
  const tone = status === 'abandoned' ? 'var(--warn)' : status === 'error' ? 'var(--danger)' : slow ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="eyebrow !leading-4">Trajanje</dt>
      <dd className="mt-0.5 flex items-center gap-2.5">
        <span className="tnum whitespace-nowrap text-[14px] font-semibold text-ink">{text}</span>
        <span
          aria-hidden
          data-testid="duration-bar"
          data-ratio={ratio.toFixed(3)}
          className={cn('relative h-1.5 min-w-12 flex-1 rounded-full bg-grid', status === 'running' && 'sync-indeterminate')}
          title={`Puna traka: ${formatDuration(scaleMs)} (najduži posao u dnevniku); limit funkcije ${FUNCTION_LIMIT_MS / 1000} s`}
        >
          {status !== 'running' && ratio > 0 ? (
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(3, ratio * 100)}%`,
                background:
                  status === 'abandoned'
                    ? `repeating-linear-gradient(135deg, ${tone} 0 4px, color-mix(in oklab, ${tone} 35%, transparent) 4px 7px)`
                    : `linear-gradient(90deg, color-mix(in oklab, ${tone} 55%, transparent), ${tone})`,
              }}
            />
          ) : null}
          <span className="absolute -top-1 right-0 h-3.5 w-px bg-border-strong" />
        </span>
        <span className="sync-fine whitespace-nowrap font-mono text-faint">{formatDuration(scaleMs)}</span>
      </dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow !leading-4">{label}</dt>
      <dd className="tnum mt-0.5 text-[14px] font-semibold leading-5 text-ink">{formatInt(value)}</dd>
    </div>
  );
}

function RunNote({ run, status }: { run: SyncRunRecord; status: RunStatus }) {
  const message = runMessage(run, status);
  if (status === 'abandoned') {
    return (
      <div className="mt-3 flex gap-2 rounded-ctl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn-soft-ink">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0">
          {ABANDONED_NOTE}
          {message ? <span className="sync-stamp mt-0.5 block break-words font-mono opacity-90">{message}</span> : null}
        </p>
      </div>
    );
  }
  if (status === 'invalid') {
    return (
      <div className="mt-3 flex gap-2 rounded-ctl border border-border-strong bg-card-2 px-3 py-2 text-[13px] leading-5 text-muted">
        <CircleHelp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0">
          {INVALID_NOTE}
          {message ? <span className="sync-stamp mt-0.5 block break-words font-mono opacity-90">{message}</span> : null}
        </p>
      </div>
    );
  }
  if (status === 'partial') {
    const missing = runMissingStations(run);
    // Posao je „Delimično“ i kad nijedna stanica ne nedostaje, a redovi nisu upisani ni posle
    // ponovnog pokušaja (`N redova nije upisano u bazu`, vidi syncNotes) – tada je to glavni razlog.
    const { unwrittenRows } = summarizeSyncWarnings(warningsFromMessage(run.message).warnings);
    const unwrittenText = unwrittenRowsWarning(unwrittenRows);
    return (
      <div className="mt-3 flex gap-2 rounded-ctl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn-soft-ink">
        <CircleDashed aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0">
          {missing.count > 0 ? (
            <>
              <span className="font-semibold">
                {missing.atLeast ? 'Najmanje ' : ''}
                {formatInt(missing.count)} {stationsNoun(missing.count)} bez novih merenja
              </span>{' '}
              – izvor nije odgovorio ili je posao stigao do vremenskog limita; te stanice zadržavaju ranije podatke.
              {unwrittenRows > 0 ? ` Uz to ${unwrittenText} – prolazna greška baze; sledeća sinhronizacija ih piše ponovo.` : null}
            </>
          ) : (
            <>
              <span className="font-semibold">{unwrittenText}</span> – prolazna greška baze; sledeća sinhronizacija ih piše ponovo.
            </>
          )}
          {message ? <span className="sync-stamp mt-0.5 block break-words font-mono opacity-90">{message}</span> : null}
        </p>
      </div>
    );
  }
  if (!message) return null;
  if (status === 'error') {
    const { title } = describeSyncError(message);
    return (
      <div className="mt-3 flex gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] leading-5 text-danger-soft-ink">
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0">
          <span className="font-semibold">{title}</span>
          <span className="sync-stamp mt-0.5 block break-words font-mono opacity-90">{message}</span>
        </p>
      </div>
    );
  }
  return (
    <p className="mt-2.5 flex gap-1.5 text-[12.5px] leading-5 text-muted">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

function TimelineItem({ run, now, scaleMs, last, newest }: { run: SyncRunRecord; now: Date; scaleMs: number; last: boolean; newest: boolean }) {
  const status = runStatus(run, now);
  const started = new Date(run.startedAt);
  // Vreme događaja je završetak posla (kao „Osveženo pre …“); posao bez završetka – početak.
  const finished = run.finishedAt && status !== 'running' && status !== 'abandoned' && status !== 'invalid' ? new Date(run.finishedAt) : null;
  const at = finished && !Number.isNaN(finished.getTime()) ? finished : started;
  const timeTitle = finished ? `Pokrenuto ${formatDateTime(started)}, završeno ${formatDateTime(finished)}` : `Pokrenuto ${formatDateTime(started)}`;
  return (
    <li className={cn('relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3.5', !last && 'pb-6')}>
      {!last ? <span aria-hidden className="absolute bottom-0 left-[13.5px] top-8 w-px bg-border-strong" /> : null}
      <RunStatusNode status={status} emphasis={newest} />
      <article className="min-w-0" aria-label={`${runTitle(run)}, ${formatDateTime(run.startedAt)}`}>
        <header className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[14.5px] font-semibold leading-5 text-ink">{runTitle(run)}</h3>
          <RunStatusBadge status={status} />
          <p className="sync-stamp w-full whitespace-nowrap font-mono leading-5 text-muted sm:ml-auto sm:w-auto" title={timeTitle}>
            <span className="sr-only">{finished ? 'Završeno ' : 'Pokrenuto '}</span>
            {Number.isNaN(at.getTime()) ? (
              'bez vremena'
            ) : status === 'invalid' ? (
              // Vreme iz budućnosti: pun datum, bez „pre …“ (relativno vreme bi lagalo).
              <time dateTime={at.toISOString()} className="tnum text-ink">
                {formatDateTime(at)}
              </time>
            ) : (
              <>
                <time dateTime={at.toISOString()} className="tnum text-ink">
                  {formatTime(at)}
                </time>
                <span aria-hidden> · </span>
                <span className="sr-only">, </span>
                {formatRelative(at, now)}
              </>
            )}
          </p>
        </header>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          Prozor merenja <span className="tnum text-ink">{runWindowText(run)}</span>
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-[repeat(3,minmax(64px,auto))_minmax(0,1fr)] sm:gap-x-6">
          <Metric label="Stanice" value={run.stationsSeen} />
          <Metric label="Merenja" value={run.observationsSeen} />
          <Metric label="Redova" value={run.rowsWritten} />
          <DurationMeter run={run} status={status} scaleMs={scaleMs} className="col-span-3 sm:col-span-1" />
        </dl>
        <RunNote run={run} status={status} />
      </article>
    </li>
  );
}

/** Vertikalna vremenska linija poslova, grupisana po danu (najnoviji prvi); trake trajanja dele skalu. */
export function RunTimeline({ runs, now, className }: { runs: SyncRunRecord[]; now: Date; className?: string }) {
  const groups = groupRunsByDay(runs, now);
  const scaleMs = durationScaleMs(runs, now);
  return (
    <ol className={cn('flex flex-col gap-6', className)} aria-label={`Poslednjih ${formatInt(runs.length)} poslova sinhronizacije`}>
      {groups.map((group, groupIndex) => (
        <li key={group.day || groupIndex}>
          <p className="mb-3.5 flex items-center gap-3">
            <span className="eyebrow whitespace-nowrap">
              {group.label}
              {group.label === 'Danas' || group.label === 'Juče' ? <span className="text-faint"> · {group.short}</span> : null}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </p>
          <ol className="flex flex-col">
            {group.runs.map((run, index) => (
              <TimelineItem key={run.id} run={run} now={now} scaleMs={scaleMs} last={index === group.runs.length - 1} newest={groupIndex === 0 && index === 0} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/** Tabelarni blizanac vremenske linije (sve kolone, horizontalni skrol na uskim ekranima). */
export function RunTable({ runs, now, className }: { runs: SyncRunRecord[]; now: Date; className?: string }) {
  return (
    <div
      role="region"
      aria-label="Tabela dnevnika sinhronizacija (pomera se vodoravno)"
      tabIndex={0}
      className={cn('overflow-x-auto rounded-tile border border-border', className)}
    >
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <caption className="sr-only">Poslednjih {runs.length} poslova sinhronizacije</caption>
        <thead className="sticky top-0 bg-panel-solid text-left">
          <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-[11px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-[0.1em] [&>th]:text-muted">
            <th scope="col">Vrsta</th>
            <th scope="col">Status</th>
            <th scope="col">Pokrenuto</th>
            <th scope="col">Prozor merenja</th>
            <th scope="col" className="text-right">
              Stanice
            </th>
            <th scope="col" className="text-right">
              Merenja
            </th>
            <th scope="col" className="text-right">
              Redova
            </th>
            <th scope="col" className="text-right">
              Trajanje
            </th>
            <th scope="col">Poruka</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = runStatus(run, now);
            const ms = runDurationMs(run, status);
            const message =
              status === 'abandoned'
                ? (runMessage(run, status) ?? ABANDONED_NOTE)
                : status === 'invalid'
                  ? INVALID_NOTE
                  : (run.message ?? '–');
            return (
              <tr key={run.id} className="border-t border-border align-top transition-colors hover:bg-card-2">
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">{runTitle(run)}</td>
                <td className="px-3 py-2">
                  <RunStatusBadge status={status} />
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2.5 text-ink">{formatDateTime(run.startedAt)}</td>
                <td className="tnum whitespace-nowrap px-3 py-2.5 text-muted">{runWindowText(run)}</td>
                <td className="tnum px-3 py-2.5 text-right text-ink">{formatInt(run.stationsSeen)}</td>
                <td className="tnum px-3 py-2.5 text-right text-ink">{formatInt(run.observationsSeen)}</td>
                <td className="tnum px-3 py-2.5 text-right text-ink">{formatInt(run.rowsWritten)}</td>
                <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-muted">
                  {ms !== null ? formatDuration(ms) : status === 'running' ? '…' : '–'}
                </td>
                <td className="max-w-[300px] px-3 py-2.5 text-muted">
                  <span className="line-clamp-2 break-words" title={message}>
                    {message}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Telo dnevnika (vremenska linija ili tabela) – podrazumevani izvoz za lenjo učitavanje iz
 * `SyncPanel`-a, da ovaj deo ne opterećuje glavni paket (prvi ekran ga ne prikazuje odmah).
 */
export default function RunLog({ runs, now, view }: { runs: SyncRunRecord[]; now: Date; view: RunLogView }) {
  return view === 'timeline' ? <RunTimeline runs={runs} now={now} /> : <RunTable runs={runs} now={now} />;
}
