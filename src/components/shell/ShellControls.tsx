import { Clock, LogOut, Moon, Search, Sun, User } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';

const ICON_BUTTON =
  'grid size-10 shrink-0 place-items-center rounded-ctl text-ink transition-colors hover:bg-card-2 focus-visible:outline-offset-0';

/**
 * Prekidač teme: kružno otkrivanje iz centra dugmeta (View Transitions), bez podrške ili
 * uz smanjeno kretanje menja se odmah. Naziv kaže radnju („Uključi svetlu temu“), pa dugme
 * nema `aria-pressed` (stanje + radnja u nazivu bi se protivrečili).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useAtmosfera();
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={theme === 'dark' ? 'Uključi svetlu temu' : 'Uključi tamnu temu'}
      className={cn(ICON_BUTTON, className)}
    >
      {theme === 'dark' ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
    </button>
  );
}

/** Korisnički meni: ime, e-pošta i odjava. Esc i klik van menija ga zatvaraju. */
export function UserMenu({ placement = 'below', showName = false, className }: { placement?: 'below' | 'above'; showName?: boolean; className?: string }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => firstItemRef.current?.focus());
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = user?.name ?? 'Korisnik';
  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Korisnički meni: ${name}`}
        className={cn(
          showName ? 'flex h-10 w-full min-w-0 items-center gap-2 rounded-ctl px-2 text-left text-ink transition-colors hover:bg-card-2' : ICON_BUTTON,
        )}
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong bg-card-2 text-muted">
          <User className="size-3.5" />
        </span>
        {showName ? <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span> : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Korisnički meni"
          className={cn(
            'absolute z-50 w-64 rounded-tile border border-border-strong bg-panel-solid p-2 shadow-float',
            placement === 'below' ? 'right-0 top-full mt-2' : 'bottom-full left-0 mb-2',
          )}
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            {user?.email ? <p className="truncate text-xs text-muted">{user.email}</p> : null}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2 rounded-ctl px-2 py-2 text-left text-sm text-ink hover:bg-card-2 focus-visible:bg-card-2"
          >
            <LogOut aria-hidden className="size-4 text-muted" />
            Odjava
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * „Osveženo pre 12 min“ – iz poslednje uspešne sinhronizacije trenutnog stanja. Nije
 * `aria-live` (menja se svakog minuta); početak i kraj posla najavljuje ljuska (AppShell).
 */
export function SyncStatusText({ className }: { className?: string }) {
  const { lastSync, now, sync } = useAtmosfera();
  const text = sync.activity
    ? sync.activity.kind === 'sync'
      ? 'Osvežavanje u toku…'
      : sync.activity.planning
        ? 'Istorija: provera…'
        : `Istorija: dan ${sync.activity.index} od ${sync.activity.total}`
    : lastSync
      ? `Osveženo ${formatRelative(lastSync, now)}`
      : 'Još nije osveženo';
  return (
    <p
      className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted', !lastSync && !sync.activity && 'text-faint', className)}
      title={lastSync ? `Poslednja uspešna sinhronizacija: ${formatDateTime(lastSync)}` : undefined}
    >
      <Clock aria-hidden className="size-3.5 shrink-0" />
      <span className="tnum truncate">{text}</span>
    </p>
  );
}

/** Dugme pretrage koje otvara paletu komandi (desktop: sa prečicom, telefon: samo ikonica). */
export function SearchButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { openPalette } = useAtmosfera();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  if (compact) {
    return (
      <button type="button" onClick={openPalette} aria-label="Pretraži stanice" aria-haspopup="dialog" className={cn(ICON_BUTTON, className)}>
        <Search aria-hidden className="size-[18px]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K /"
      className={cn(
        'group inline-flex h-9 min-w-0 items-center gap-2 rounded-ctl border border-border-strong bg-panel pl-3 pr-1.5 text-[13px] text-muted shadow-[var(--shadow-inset)] transition-colors',
        'hover:border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] hover:text-ink',
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="truncate">Pretraži stanice…</span>
      <kbd className="ml-auto hidden shrink-0 items-center gap-0.5 rounded-[6px] border border-border bg-card-2 px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline-flex">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}
