import { ChevronDown, History, Inbox } from 'lucide-react';
import { lazy, Suspense, useId, useState, type CSSProperties } from 'react';

import type { SyncRunRecord } from '@shared/contracts';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { Shimmer } from '@/components/fx/Shimmer';
import { RunLogToggle, type RunLogView } from '@/components/sync/RunLogToggle';
import { RunStatusBadge } from '@/components/sync/RunStatus';
import { runStatus, type RunStatus } from '@/components/sync/runModel';
import { SyncActions } from '@/components/sync/SyncActions';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ErrorBanner } from '@/components/ui/Feedback';
import type { SyncActivity, SyncOutcome } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { formatInt, formatRelative, pluralSr } from '@/lib/format';
import { reloadPage } from '@/lib/reload';
import { validRuns } from '@/lib/syncRules';

export interface SyncPanelProps {
  runs: SyncRunRecord[];
  activity: SyncActivity | null;
  outcome: SyncOutcome | null;
  onSync: () => void;
  onBackfill: () => void;
  onStop: () => void;
  now: Date;
  mode: 'rayfin' | 'demo';
  /** Otvoren pri učitavanju (samo za sklopivi panel). */
  defaultOpen?: boolean;
  /**
   * Sklopivo zaglavlje sa sažetkom (prvi ekran, ispod uputstva) ili stalno otvoren panel
   * sa naslovom sekcije (stranica Sinhronizacija). Podrazumevano sklopivo.
   */
  collapsible?: boolean;
  /** Dugmad „Osveži sada“ / „Učitaj istoriju“ u panelu (kad ih nema drugde na ekranu). */
  showActions?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Vremenska linija i tabela se učitavaju lenjo (poseban deo paketa; stranica ga preuzima unapred). */
const RunLog = lazy(() => import('@/components/sync/RunLog'));

function LogSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Učitavanje dnevnika">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3.5">
          <Shimmer className="size-7" rounded="full" />
          <div className="flex flex-col gap-2">
            <Shimmer className="h-4 w-48" />
            <Shimmer className="h-3.5 w-64 max-w-full" />
            <Shimmer className="h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

const SUMMARY_TEXT: Record<RunStatus, string> = {
  ok: 'uspešan',
  partial: 'delimično uspešan',
  error: 'greška',
  running: 'u toku',
  abandoned: 'prekinut bez završetka',
  invalid: 'neispravan zapis',
};

function LogBody({ runs, now, view }: { runs: SyncRunRecord[]; now: Date; view: RunLogView }) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-tile border border-dashed border-border-strong px-4 py-6 text-sm text-muted">
        <Inbox aria-hidden className="size-5 shrink-0 text-faint" />
        <p>
          <span className="font-medium text-ink">Dnevnik je prazan.</span> Ovde će se pojaviti svaka sinhronizacija i svaki
          učitani dan istorije, sa trajanjem i brojem upisanih redova.
        </p>
      </div>
    );
  }
  return (
    <ErrorBoundary
      fallback={
        <ErrorBanner
          title="Dnevnik nije učitan"
          message="Proverite vezu sa mrežom i pokušajte ponovo (stranica će se ponovo učitati)."
          onRetry={reloadPage}
        />
      }
    >
      <Suspense fallback={<LogSkeleton />}>
        <RunLog runs={runs} now={now} view={view} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Dnevnik sinhronizacija kao vertikalna vremenska linija (status ikonom i rečju, prozor
 * merenja, stanice/merenja/redovi, trajanje prema limitu od 240 s, poruka), sa tabelarnim
 * blizancem. Napušteni `running` redovi (vidi `isRunAbandoned`) imaju svoj status i objašnjenje.
 */
export function SyncPanel({
  runs,
  activity,
  outcome,
  onSync,
  onBackfill,
  onStop,
  now,
  mode,
  defaultOpen = false,
  collapsible = true,
  showActions = false,
  className,
  style,
}: SyncPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<RunLogView>('timeline');
  const bodyId = useId();
  const titleId = useId();
  // Neispravan red (npr. vreme u budućnosti) ne predstavlja „poslednji posao“ u sažetku.
  const latest = validRuns(runs, now)[0];
  const latestStatus = latest ? runStatus(latest, now) : null;
  const lastN = `${pluralSr(runs.length, 'poslednji', 'poslednja', 'poslednjih')} ${formatInt(runs.length)} ${pluralSr(runs.length, 'posao', 'posla', 'poslova')}`;

  const actions = showActions ? (
    <SyncActions activity={activity} outcome={outcome} onSync={onSync} onBackfill={onBackfill} onStop={onStop} mode={mode} size="md" />
  ) : null;

  if (!collapsible) {
    return (
      <GlassPanel className={cn('flex flex-col gap-5 p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby={titleId}>
        <div className="flex items-start gap-x-4 gap-y-3 max-sm:flex-col">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">{runs.length ? `Dnevnik · ${lastN}` : 'Dnevnik'}</p>
            <h2 id={titleId} className="text-base font-semibold leading-6 text-ink">
              Sinhronizacije i istorija
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">Najnoviji posao prvi. Trajanje se poredi sa limitom Fabric funkcije od 240 s.</p>
          </div>
          {runs.length ? <RunLogToggle value={view} onChange={setView} /> : null}
        </div>
        {actions}
        <LogBody runs={runs} now={now} view={view} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={cn('overflow-hidden', className)} style={style} aria-labelledby={titleId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full flex-wrap items-center gap-3 rounded-[inherit] px-4 py-3.5 text-left transition-colors hover:bg-card-2 sm:px-5"
      >
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent-soft-ink">
          <History className={cn('size-4', activity && 'spin')} />
        </span>
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block font-heading text-[15px] font-semibold leading-6 text-ink">
            Dnevnik sinhronizacija
          </span>
          <span className="block truncate text-[13px] leading-5 text-muted">
            {activity
              ? activity.kind === 'sync'
                ? 'Preuzimanje u toku…'
                : activity.planning
                  ? 'Istorija: provera dana koji nedostaju…'
                  : `Istorija: dan ${activity.index} od ${activity.total}`
              : latest && latestStatus
                ? `Poslednji posao: ${SUMMARY_TEXT[latestStatus]}, ${formatRelative(latest.finishedAt ?? latest.startedAt, now)}`
                : 'Još nije bilo sinhronizacija'}
          </span>
        </span>
        {latest && latestStatus ? <RunStatusBadge status={activity ? 'running' : latestStatus} /> : null}
        <ChevronDown aria-hidden className={cn('size-5 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:px-5 sm:py-5">
          {actions}
          {runs.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="eyebrow">{lastN}</p>
              <RunLogToggle value={view} onChange={setView} />
            </div>
          ) : null}
          <LogBody runs={runs} now={now} view={view} />
        </div>
      ) : null}
    </GlassPanel>
  );
}
