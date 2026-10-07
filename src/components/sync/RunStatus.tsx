import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, CircleOff, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';

import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, type RunStatus } from './runModel';

const ICON: Record<RunStatus, LucideIcon> = {
  ok: CircleCheck,
  partial: CircleDashed,
  error: CircleAlert,
  running: LoaderCircle,
  abandoned: CircleOff,
  invalid: CircleHelp,
};

const CHIP: Record<RunStatus, string> = {
  ok: 'bg-ok-soft text-ok-soft-ink',
  partial: 'bg-warn-soft text-warn-soft-ink',
  error: 'bg-danger-soft text-danger-soft-ink',
  running: 'bg-accent-soft text-accent-soft-ink',
  abandoned: 'bg-warn-soft text-warn-soft-ink',
  invalid: 'bg-card-2 text-muted ring-1 ring-inset ring-border-strong',
};

/** Čip statusa: ikona + tekst (boja nikad nije jedini nosilac značenja). */
export function RunStatusBadge({ status, label, className }: { status: RunStatus; label?: string; className?: string }) {
  const Icon = ICON[status];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium', CHIP[status], className)}>
      <Icon aria-hidden className={cn('size-3.5', status === 'running' && 'spin')} />
      {label ?? RUN_STATUS_LABEL[status]}
    </span>
  );
}

/** Čvor vremenske linije: ikona statusa u krugu tonirane boje statusa (dekorativno, tekst stoji pored). */
export function RunStatusNode({ status, emphasis = false, size = 28 }: { status: RunStatus; emphasis?: boolean; size?: number }) {
  const Icon = ICON[status];
  const color = RUN_STATUS_COLOR[status];
  const style: CSSProperties = {
    width: size,
    height: size,
    color,
    backgroundColor: `color-mix(in oklab, ${color} 14%, var(--panel-solid))`,
    borderColor: `color-mix(in oklab, ${color} 46%, var(--border))`,
    boxShadow: emphasis ? `0 0 0 4px color-mix(in oklab, ${color} 12%, transparent), 0 0 18px -2px color-mix(in oklab, ${color} 45%, transparent)` : undefined,
  };
  return (
    <span aria-hidden className="relative z-[1] grid shrink-0 place-items-center rounded-full border" style={style}>
      <Icon className={cn('size-[15px]', status === 'running' && 'spin')} strokeWidth={2.2} />
    </span>
  );
}
