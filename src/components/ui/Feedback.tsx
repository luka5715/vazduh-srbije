import { CircleAlert, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatTimeSince } from '@/lib/format';

import { Button } from './Button';

export function ErrorBanner({ title, message, onRetry, className }: { title?: string; message: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-wrap items-start gap-3 rounded-ctl border border-danger/30 bg-danger-soft px-3.5 py-3 text-danger-soft-ink', className)}>
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-sm leading-5">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p className="break-words">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="ml-auto">
          Pokušaj ponovo
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 rounded-tile border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted', className)}>
      <Info aria-hidden className="size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Ponovno učitavanje nije uspelo, a stari podaci su i dalje prikazani: kratka napomena sa
 * „Pokušaj ponovo“ (umesto tihog prikaza starih podataka). Sa `loadedAt` navodi i vreme
 * učitavanja prikazanih podataka („od 14:05“, drugog dana „od 06. 10. 14:05“).
 */
export function RefreshFailedNote({
  onRetry,
  loadedAt = null,
  now = new Date(),
  className,
}: {
  onRetry: () => void;
  loadedAt?: Date | null;
  now?: Date;
  className?: string;
}) {
  const when = loadedAt ? formatTimeSince(loadedAt, now) : null;
  return (
    <p
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ctl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn-soft-ink',
        className,
      )}
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Osvežavanje nije uspelo – prikazani su {when ? `podaci od ${when}` : 'ranije učitani podaci'}.
      </span>
      <button type="button" onClick={onRetry} className="touch-target font-medium underline underline-offset-2 hover:no-underline">
        Pokušaj ponovo
      </button>
    </p>
  );
}
