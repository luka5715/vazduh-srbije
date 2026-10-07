import { CircleHelp, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useRef, useState, type RefObject } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { cn } from '@/lib/cn';
import { reloadPage } from '@/lib/reload';

/** Sadržaj se učitava pri prvom otvaranju (dugme je u podnožju svake stranice). */
const HowToReadContent = lazy(() => import('@/components/howto/HowToReadContent'));

/**
 * Zamena za sadržaj kad njegov JS deo ne stigne (prekid mreže, tab otvoren pre novog
 * postavljanja – stari heširani deo više ne postoji). Dijalog ostaje imenovan i zatvoriv,
 * a ostatak aplikacije radi dalje (bez granice greška bi skinula celu ljusku).
 */
function HowToReadUnavailable({ titleId, closeRef, onClose }: { titleId: string; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  useEffect(() => {
    closeRef.current?.focus();
  }, [closeRef]);
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          Kako čitati podatke
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Zatvori"
          className="grid size-9 shrink-0 place-items-center rounded-ctl text-muted hover:bg-card-2 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div role="alert" className="flex flex-col items-start gap-3 px-4 py-5 text-sm text-muted sm:px-6">
        <p>Vodič nije učitan – proverite vezu sa mrežom ili osvežite stranicu.</p>
        <Button variant="secondary" size="sm" onClick={reloadPage}>
          Osveži stranicu
        </Button>
      </div>
    </div>
  );
}

export interface HowToReadButtonProps {
  /** `pill`: dugme u heroju; `link`: tekstualni link (podnožje). */
  variant?: 'pill' | 'link';
  className?: string;
}

/**
 * „Kako čitati“: dugme + nativni `<dialog>` (isti `Dialog` kao paleta komandi) sa jednim
 * objašnjenjem za korisnike – SEPA pragovi i saveti iz `@shared/aqi` (jedini izvor), pravilo
 * najlošijeg polutanta, pravila svežine i napomena o preliminarnim podacima. Ne zavisi od
 * stanja aplikacije, pa radi i na ekranu prijave.
 */
export function HowToReadButton({ variant = 'pill', className }: HowToReadButtonProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          variant === 'pill'
            ? 'touch-target inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong px-3 text-[13px] font-medium text-ink transition-colors hover:bg-card-2'
            : 'inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline',
          className,
        )}
      >
        <CircleHelp aria-hidden className={variant === 'pill' ? 'size-3.5 text-muted' : 'size-3'} />
        {variant === 'pill' ? 'Kako čitati' : 'Kako čitati podatke'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy={titleId} placement="sheet" initialFocusRef={closeRef} className="sm:max-w-2xl">
        <ErrorBoundary fallback={<HowToReadUnavailable titleId={titleId} closeRef={closeRef} onClose={() => setOpen(false)} />}>
          <Suspense
            fallback={
              <p id={titleId} className="px-6 py-8 text-sm text-muted">
                Učitavanje vodiča…
              </p>
            }
          >
            <HowToReadContent titleId={titleId} closeRef={closeRef} onClose={() => setOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      </Dialog>
    </>
  );
}
