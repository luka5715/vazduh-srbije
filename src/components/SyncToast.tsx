import { LoaderCircle, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { OUTCOME_STYLE } from '@/components/sync/outcomeStyle';
import { BackfillProgress, KeepScreenOnNote, SyncProgress } from '@/components/sync/SyncActions';
import { formatElapsed, useElapsed } from '@/components/sync/useElapsed';
import { Button } from '@/components/ui/Button';
import type { OutcomeTone, SyncActivity, SyncOutcome } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { formatDayLong, formatInt } from '@/lib/format';

import '@/components/sync/sync.css';

const OUTCOME_VISIBLE_MS = 9_000;

export interface SyncToastProps {
  activity: SyncActivity | null;
  outcome: SyncOutcome | null;
  onDismiss: () => void;
  onStop: () => void;
  /**
   * Bez obaveštenja o napretku (ishod se i dalje prikazuje) – kad je napredak sa „Zaustavi“
   * već na ekranu (heroj Sinhronizacije, prazna baza).
   */
  hideActivity?: boolean;
}

type Tone = 'progress' | OutcomeTone;

function toneColor(tone: Tone): string {
  return tone === 'progress' ? 'var(--accent)' : OUTCOME_STYLE[tone].color;
}

function ToastFrame({
  tone,
  title,
  detail,
  aside,
  footer,
  onDismiss,
  onPause,
}: {
  tone: Tone;
  title: string;
  detail?: ReactNode;
  /** Kontrola desno od naslova (npr. „Zaustavi“). */
  aside?: ReactNode;
  footer?: ReactNode;
  onDismiss?: () => void;
  onPause?: (paused: boolean) => void;
}) {
  const Icon = tone === 'progress' ? LoaderCircle : OUTCOME_STYLE[tone].icon;
  const color = toneColor(tone);
  return (
    <div
      role="status"
      aria-live="polite"
      onPointerEnter={() => onPause?.(true)}
      onPointerLeave={() => onPause?.(false)}
      onFocus={() => onPause?.(true)}
      onBlur={() => onPause?.(false)}
      className={cn(
        'pointer-events-auto relative w-[min(100vw-2rem,400px)] overflow-hidden rounded-tile border shadow-float backdrop-blur-xl',
        'bg-[color-mix(in_oklab,var(--panel-solid)_86%,transparent)] rise-in',
      )}
      style={{
        borderColor: `color-mix(in oklab, ${color} 34%, var(--border-strong))`,
        backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${color} calc(var(--glow-strength) * 22%), transparent), transparent 62%)`,
      }}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full border"
          style={{
            color,
            backgroundColor: `color-mix(in oklab, ${color} 14%, var(--panel-solid))`,
            borderColor: `color-mix(in oklab, ${color} 42%, var(--border))`,
          }}
        >
          <Icon className={cn('size-4', tone === 'progress' && 'spin')} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold leading-5 text-ink">{title}</p>
          {detail ? <div className="mt-0.5 text-[13px] leading-5 text-muted">{detail}</div> : null}
          {footer ? <div className="mt-2.5">{footer}</div> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Zatvori obaveštenje"
            className="-m-1 grid size-8 shrink-0 place-items-center rounded-ctl text-muted transition-colors hover:bg-card-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Odbrojavanje do zatvaranja: tanka traka na dnu, pauzira se dok je pokazivač/fokus na obaveštenju. */
function Countdown({ paused, tone }: { paused: boolean; tone: Tone }) {
  return (
    <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] motion-reduce:hidden">
      <span
        className="sync-countdown block h-full"
        data-paused={paused}
        style={{
          ['--countdown' as string]: `${OUTCOME_VISIBLE_MS}ms`,
          backgroundColor: toneColor(tone),
          opacity: 0.7,
        }}
      />
    </span>
  );
}

function SyncActivityToast({ activity }: { activity: Extract<SyncActivity, { kind: 'sync' }> }) {
  const elapsed = useElapsed(activity.startedAt);
  return (
    <ToastFrame
      tone="progress"
      title={activity.auto ? 'Automatsko osvežavanje podataka' : 'Preuzimam podatke sa SEPA…'}
      detail={
        <>
          Funkcija radi na serveru; obično traje 1–3 minuta. <span className="tnum whitespace-nowrap font-mono text-ink">{formatElapsed(elapsed)}</span>
        </>
      }
      footer={<SyncProgress activity={activity} compact />}
    />
  );
}

/**
 * Plutajuće stakleno obaveštenje: napredak posla (neodređena traka za sinhronizaciju,
 * segment po danu koji se dopunjava, sa „Zaustavi“) ili ishod, koji nestaje posle 9 s – odbrojavanje
 * se vidi kao traka na dnu i pauzira dok je pokazivač ili fokus na obaveštenju.
 */
export function SyncToast({ activity, outcome, onDismiss, onStop, hideActivity = false }: SyncToastProps) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(OUTCOME_VISIBLE_MS);
  const startedAt = useRef(0);

  // Novi ishod počinje puno odbrojavanje (i ne nasleđuje pauzu prethodnog obaveštenja).
  useEffect(() => {
    remaining.current = OUTCOME_VISIBLE_MS;
    setPaused(false);
  }, [outcome]);

  useEffect(() => {
    if (!outcome || activity || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [outcome, activity, paused, onDismiss]);

  const onPause = useCallback((value: boolean) => setPaused(value), []);
  const showActivity = activity !== null && !hideActivity;

  if (!showActivity && (!outcome || activity)) return null;

  return (
    // Telefon: iznad donje navigacije (64 px + sigurna zona; položen telefon 48 px); desktop:
    // donji desni ugao. Bočni razmak poštuje zarez položenog telefona.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 flex justify-center px-safe-4 short:bottom-[calc(60px+env(safe-area-inset-bottom))] sm:justify-end sm:px-safe-6 lg:bottom-6">
      {showActivity ? (
        activity.kind === 'sync' ? (
          <SyncActivityToast activity={activity} />
        ) : (
          <ToastFrame
            tone="progress"
            title={activity.planning ? 'Istorija: provera dana koji nedostaju…' : `Istorija: dan ${activity.index} od ${activity.total}`}
            detail={
              activity.stopping ? (
                'Zaustavlja se posle ovog dana…'
              ) : activity.planning ? (
                'Čita se dnevna statistika poslednjih 30 dana iz baze.'
              ) : (
                <>
                  <span className="tnum">{formatDayLong(activity.day)}</span> · uspešno{' '}
                  <span className="tnum font-semibold text-ink">{formatInt(activity.okDays)}</span>
                  {activity.failedDays ? (
                    <>
                      {' '}
                      · neuspešno <span className="tnum font-semibold text-danger">{formatInt(activity.failedDays)}</span>
                    </>
                  ) : null}
                </>
              )
            }
            footer={
              <>
                <BackfillProgress activity={activity} compact bare />
                <KeepScreenOnNote className="mt-2" />
              </>
            }
            aside={
              <Button size="sm" variant="secondary" onClick={onStop} disabled={activity.stopping} icon={<Square aria-hidden />}>
                {activity.stopping ? 'Zaustavljam…' : 'Zaustavi'}
              </Button>
            }
          />
        )
      ) : outcome ? (
        <div key={outcome.at.getTime()} className="relative">
          <ToastFrame
            tone={outcome.tone}
            title={outcome.title}
            detail={outcome.detail}
            onDismiss={onDismiss}
            onPause={onPause}
          />
          <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-tile">
            <Countdown paused={paused} tone={outcome.tone} />
          </span>
        </div>
      ) : null}
    </div>
  );
}
