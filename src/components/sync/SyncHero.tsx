import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { LiveDot } from '@/components/fx/LiveDot';
import { RingGauge } from '@/components/fx/RingGauge';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatDuration, formatHourInterval, formatInt, pluralSr, stationsNoun } from '@/lib/format';
import { liveStatus } from '@/lib/stations';
import { STALE_MINUTES } from '@/lib/syncRules';

import { setHeroProgressVisible } from './heroProgress';
import { HistoryStrip } from './HistoryStrip';
import { SyncActions } from './SyncActions';
import { useHistoryCoverage } from './useHistoryCoverage';
import { headlineOf } from './heroHeadline';
import { ageParts, durationExpectation, freshnessOf, FUNCTION_LIMIT_MS, RUN_STATUS_COLOR, runDurationMs, summarizeRuns, syncStateOf, type RunSummary } from './runModel';

import './sync.css';

/**
 * Merač svežine: prsten se puni do praga od 65 min (pun prsten = vreme za osvežavanje). Prag je
 * tvrda granica automatskog osvežavanja; ono može krenuti i ranije, kad SEPA objavi nov sat
 * (`shouldAutoSync`), što rečenica heroja kaže.
 */
function FreshnessGauge({ lastSync, now, active, size }: { lastSync: Date | null; now: Date; active: boolean; size: number }) {
  const freshness = freshnessOf(lastSync, now);
  const parts = freshness ? ageParts(freshness.ageMs) : null;
  const color = active ? 'var(--accent)' : !freshness ? 'var(--faint)' : freshness.stale ? 'var(--warn)' : 'var(--ok)';
  const label = parts
    ? `Od poslednje sinhronizacije: ${formatInt(parts.value)} ${parts.unit}, prag automatskog osvežavanja ${STALE_MINUTES} min`
    : 'Još nema uspešne sinhronizacije';
  const big = size >= 120;
  return (
    <figure className="flex flex-col items-center gap-2.5">
      <div className="relative grid place-items-center">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[8%] rounded-full blur-[18px]"
          style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${color} calc(var(--glow-strength) * 70%), transparent), transparent)` }}
        />
        {active ? <span aria-hidden className="sync-orbit" /> : null}
        <RingGauge value={freshness?.ratio ?? 0} color={color} size={size} thickness={Math.round(size * (big ? 0.075 : 0.09))} label={label}>
          <span className="flex flex-col items-center">
            <span className={cn('font-heading font-semibold leading-none tracking-[-0.03em] text-ink', big ? 'text-[40px]' : 'text-[26px]')}>
              {parts ? formatInt(parts.value) : '–'}
            </span>
            <span className={cn('font-mono text-[12px] uppercase tracking-[0.12em] text-muted sm:text-[11px]', big ? 'mt-1.5' : 'mt-1 tracking-[0.08em]')}>
              {parts ? parts.unit : 'nema'}
            </span>
          </span>
        </RingGauge>
      </div>
      <figcaption className="eyebrow text-center !leading-4">
        Od sinhronizacije
        <span className="block text-faint">prag {STALE_MINUTES} min</span>
      </figcaption>
    </figure>
  );
}

/** Gornja i donja ivica koje pokrivaju trake ljuske (lepljiva gornja traka, donja navigacija). */
const SHELL_INSET_TOP = 100;
const SHELL_INSET_BOTTOM = 84;
/** Deo bloka sa napretkom koji mora biti vidljiv da bi se obaveštenje sa napretkom sakrilo. */
const VISIBLE_RATIO = 0.4;

/**
 * Javlja ljusci (`heroProgress`) da li je blok sa dugmadima i napretkom na ekranu: kad nije
 * (npr. stranica je odskrolovana do dnevnika), obaveštenje sa napretkom i „Zaustavi“ se vraća.
 */
function useReportProgressVisibility(ref: RefObject<HTMLElement | null>) {
  // Prvo merenje pre iscrtavanja: obaveštenje ne „trepne“ pri ulasku na stranicu.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return;
    const rect = element.getBoundingClientRect();
    const top = Math.max(rect.top, SHELL_INSET_TOP);
    const bottom = Math.min(rect.bottom, window.innerHeight - SHELL_INSET_BOTTOM);
    setHeroProgressVisible(rect.height > 0 && bottom - top >= rect.height * VISIBLE_RATIO);
    return () => setHeroProgressVisible(false);
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setHeroProgressVisible(entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO);
      },
      { rootMargin: `-${SHELL_INSET_TOP}px 0px -${SHELL_INSET_BOTTOM}px 0px`, threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

function StatCell({ label, short, children, className }: { label: string; short?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 border-t border-border px-5 py-4 even:border-l sm:px-7 lg:border-l lg:px-6 lg:first:border-l-0 lg:first:pl-8', className)}>
      <dt className="eyebrow truncate">
        {short ? (
          <>
            <span className="sm:hidden lg:inline xl:hidden">{short}</span>
            <span className="hidden sm:inline lg:hidden xl:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

function summaryText(summary: RunSummary): string {
  const parts = [`${formatInt(summary.ok)} ${pluralSr(summary.ok, 'uspešan', 'uspešna', 'uspešnih')}`];
  if (summary.error) parts.push(`${formatInt(summary.error)} ${pluralSr(summary.error, 'greška', 'greške', 'grešaka')}`);
  if (summary.partial) parts.push(`${formatInt(summary.partial)} ${pluralSr(summary.partial, 'delimičan', 'delimična', 'delimičnih')}`);
  if (summary.abandoned) parts.push(`${formatInt(summary.abandoned)} ${pluralSr(summary.abandoned, 'prekinut', 'prekinuta', 'prekinutih')}`);
  if (summary.running) parts.push(`${formatInt(summary.running)} u toku`);
  if (summary.invalid) parts.push(`${formatInt(summary.invalid)} ${pluralSr(summary.invalid, 'neispravan', 'neispravna', 'neispravnih')}`);
  return parts.join(' · ');
}

function RunStrip({ summary }: { summary: RunSummary }) {
  return (
    <span aria-hidden className="flex h-[26px] items-end gap-[3px]">
      {summary.statuses.map((status, i) => {
        const newest = i === summary.statuses.length - 1;
        return (
          <span
            key={i}
            className="w-[7px] rounded-[2px]"
            style={{
              height: newest ? 26 : 20,
              backgroundColor: RUN_STATUS_COLOR[status],
              opacity: newest ? 1 : 0.78,
              boxShadow: newest ? `0 0 10px -1px ${RUN_STATUS_COLOR[status]}` : undefined,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Heroj stranice Sinhronizacija: stanje podataka rečima (svež / kasni / greška / u toku),
 * merač svežine prema pravilu od 65 min, velika dugmad sa napretkom i traka sažetka
 * (statusi poslednjih poslova, prosečno trajanje, poslednje preuzimanje, najnoviji sat).
 */
export function SyncHero({ className, style }: { className?: string; style?: CSSProperties }) {
  const { data, sync, now, mode, lastSync, newestObservedAt, isEmpty } = useAtmosfera();
  const runs = data.syncRuns;
  const md = useMediaQuery('(min-width: 768px)', true);
  const activityKind = sync.activity?.kind ?? null;
  const state = syncStateOf(activityKind, runs, lastSync, now, newestObservedAt);
  const history = useHistoryCoverage();
  const summary = summarizeRuns(runs, now);
  // Dnevnik nosi samo poslednjih 10 poslova (posle dopune istorije to mogu biti samo dani
  // istorije) – tada važi poslednja uspešna sinhronizacija iz zasebnog upita.
  const lastOk = summary.lastOkSync ?? data.lastSuccessfulSync;
  const lastOkMs = summary.avgSyncMs === null && lastOk ? runDurationMs(lastOk, 'ok') : null;
  const expectation = durationExpectation(summary, data.lastSuccessfulSync);
  const headline = headlineOf(state, {
    lastSync,
    now,
    mode,
    auto: sync.activity?.kind === 'sync' && sync.activity.auto,
    expectation,
    backfillDays: sync.activity?.kind === 'backfill' && !sync.activity.planning ? sync.activity.total : null,
  });
  const active = activityKind !== null || state.kind === 'remote-running';
  const noun = pluralSr(summary.total, 'posao', 'posla', 'poslova');
  const actionsRef = useRef<HTMLDivElement>(null);
  useReportProgressVisibility(actionsRef);

  return (
    <GlassPanel variant="hero" className={cn('overflow-hidden', className)} style={style} aria-labelledby="sync-hero-title">
      <div className="sync-hero__grid px-5 pb-6 pt-5 sm:px-7 sm:pt-7 lg:px-8 lg:pb-7 lg:pt-8">
        <div className="sync-hero__head min-w-0">
          <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
            <LiveDot size={7} color={headline.tone} pulse={active || state.kind === 'fresh'} />
            <span>Sinhronizacija sa SEPA</span>
            <span className="hidden text-faint sm:inline">· {mode === 'demo' ? 'demo' : 'Fabric'}</span>
          </p>
          <h2
            id="sync-hero-title"
            className="mt-3 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[38px] xl:text-[42px]"
          >
            {headline.lead}{' '}
            <span className="haze-underline whitespace-nowrap" style={{ '--haze': headline.tone } as CSSProperties}>
              {headline.word}
            </span>
          </h2>
        </div>

        <div className="sync-hero__gauge">
          <FreshnessGauge lastSync={lastSync} now={now} active={active} size={md ? 156 : 92} />
        </div>

        <div className="sync-hero__body min-w-0">
          <p className="max-w-2xl text-[15px] leading-6 text-muted">{headline.sub}</p>
          <div ref={actionsRef} className="mt-5 max-w-2xl">
            <SyncActions
              activity={sync.activity}
              outcome={sync.outcome}
              onSync={() => void sync.startSync()}
              onBackfill={() => void sync.startBackfill()}
              onStop={sync.stopBackfill}
              mode={mode}
              firstRun={isEmpty || (!lastSync && runs.length === 0)}
              incompleteDays={history.coverage ? history.coverage.incomplete.length : null}
              expectation={expectation}
            />
          </div>
        </div>
      </div>

      {summary.total > 0 ? (
        <dl className="grid grid-cols-2 lg:grid-cols-4">
          <StatCell label={`Dnevnik · ${formatInt(summary.total)} ${noun}`} short={`${formatInt(summary.total)} ${noun}`}>
            <RunStrip summary={summary} />
            <p className="mt-2 text-[12.5px] leading-5 text-muted">{summaryText(summary)}</p>
          </StatCell>
          <StatCell label="Trajanje sinhronizacije" short="Trajanje">
            <p className="font-heading text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">
              {summary.avgSyncMs !== null ? formatDuration(summary.avgSyncMs) : lastOkMs !== null ? formatDuration(lastOkMs) : '–'}
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted">
              {summary.avgSyncMs !== null
                ? `prosek · limit ${FUNCTION_LIMIT_MS / 1000} s`
                : lastOkMs !== null
                  ? `poslednja · limit ${FUNCTION_LIMIT_MS / 1000} s`
                  : 'u prikazanom dnevniku nema sinhronizacije'}
            </p>
          </StatCell>
          <StatCell label="Poslednje preuzimanje" short="Preuzimanje">
            <p className="font-heading text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">
              {lastOk ? formatInt(lastOk.observationsSeen) : '–'}
              <span className="ml-1.5 font-body text-[13px] font-normal tracking-normal text-muted">merenja</span>
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted">
              {lastOk
                ? `${formatInt(lastOk.stationsSeen)} ${stationsNoun(lastOk.stationsSeen)} · ${formatInt(lastOk.rowsWritten)} ${pluralSr(lastOk.rowsWritten, 'red', 'reda', 'redova')}`
                : 'još nema uspešne sinhronizacije'}
            </p>
          </StatCell>
          <StatCell label="Najnoviji sat u bazi" short="Najnoviji sat">
            <p className="font-heading text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">
              {newestObservedAt ? formatHourInterval(newestObservedAt) : '–'}
            </p>
            {/* Starost od KRAJA intervala (`liveStatus().ageText`) – isto što i čip u gornjoj traci i natpis heroja. */}
            <p className="mt-1 text-[12.5px] leading-5 text-muted" title={newestObservedAt ? `Početak intervala: ${formatDateTime(newestObservedAt)}; starost se računa od kraja intervala` : undefined}>
              {newestObservedAt ? `${formatDate(newestObservedAt)} · ${liveStatus(newestObservedAt, now).ageText}` : 'nema merenja'}
            </p>
          </StatCell>
        </dl>
      ) : null}

      <HistoryStrip
        className="border-t border-border px-5 py-4 sm:px-7 lg:px-8 lg:py-5"
        coverage={history.coverage}
        loading={history.loading}
        error={history.error}
        errorDetail={history.errorDetail}
        reload={history.reload}
        activity={sync.activity}
      />
    </GlassPanel>
  );
}
