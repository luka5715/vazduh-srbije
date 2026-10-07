import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  /** Zatvaranje: Esc, klik na pozadinu ili kod pozivaoca. */
  onClose: () => void;
  /** Pristupačni naziv dijaloga (ako nema vidljivog naslova povezanog preko `labelledBy`). */
  label?: string;
  labelledBy?: string;
  /**
   * `top`: kartica pri vrhu (paleta komandi);
   * `sheet`: list koji izlazi odozdo na telefonu, centriran na širem ekranu.
   */
  placement?: 'top' | 'sheet';
  /** Element koji dobija fokus pri otvaranju (podrazumevano prvi fokusabilni). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

/**
 * Modalni dijalog nad nativnim `<dialog>` + `showModal()`: fokus je zarobljen (ostatak
 * strane je inert), Esc zatvara, `aria-modal`, a fokus se po zatvaranju vraća na element
 * koji ga je otvorio. Radi i u iframe-u (Fabric) – bez window.open/alert/confirm.
 */
export function Dialog({ open, onClose, label, labelledBy, placement = 'top', initialFocusRef, className, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Fokus odmah, u istom koraku kao otvaranje (iOS podiže tastaturu samo tada); rAF je
      // rezerva ako polje u tom trenutku još nije spremno za fokus.
      const target = initialFocusRef?.current;
      target?.focus();
      requestAnimationFrame(() => {
        const current = initialFocusRef?.current;
        if (current && dialog.open && document.activeElement !== current) current.focus();
      });
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onNativeClose = () => {
      onCloseRef.current();
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && target.isConnected) requestAnimationFrame(() => target.focus());
    };
    dialog.addEventListener('close', onNativeClose);
    return () => dialog.removeEventListener('close', onNativeClose);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onClick={(event) => {
        // Klik van sadržaja pogađa sam <dialog> (pozadinu) – zatvara.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className={cn(
        'm-0 max-h-none max-w-none border-0 bg-transparent p-0 text-ink',
        'fixed inset-0 h-dvh w-screen overflow-hidden',
        'open:flex',
        placement === 'top' ? 'items-start justify-center px-3 pt-[10vh] sm:px-6' : 'items-end justify-center sm:items-center sm:p-6',
      )}
    >
      {open ? (
        <div
          className={cn(
            'rise-in relative w-full overflow-hidden border border-border-strong shadow-float',
            'bg-[color-mix(in_oklab,var(--panel-solid)_90%,transparent)] backdrop-blur-xl',
            placement === 'top' ? 'max-w-xl rounded-panel' : 'max-w-md rounded-t-panel pb-[env(safe-area-inset-bottom)] sm:rounded-panel sm:pb-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
