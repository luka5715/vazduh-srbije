import { Info } from 'lucide-react';

import { LiveDot } from '@/components/fx/LiveDot';
import { useAtmosfera, type SyncHealth } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatInt } from '@/lib/format';

import { BrandMark } from './BrandMark';
import { LensPicker } from './LensPicker';
import { NAV_ITEMS, SYNC_HEALTH } from './navigation';
import { OkrugSelect } from './OkrugFilter';
import { SyncStatusText, ThemeToggle, UserMenu } from './ShellControls';
import { useNavBadges, useSourceState } from './useNavBadges';

/** Tačka statusa sinhronizacije sa tekstom za čitače ekrana. */
export function SyncHealthDot({ health, className }: { health: SyncHealth; className?: string }) {
  const meta = SYNC_HEALTH[health];
  if (!meta) return null;
  return (
    <span className={cn('inline-flex items-center', className)}>
      <LiveDot color={meta.color} size={7} pulse={meta.pulse} />
      <span className="sr-only">, status: {meta.text}</span>
    </span>
  );
}

/**
 * Bočna traka (≥ 1024 px): znak i naziv, navigacija stranica, sočivo polutanta, filter
 * okruga, a na dnu stanje sinhronizacije, tema, korisnik, „O podacima“ i izvor.
 */
export function Sidebar({ className }: { className?: string }) {
  const { view, navigate, mode } = useAtmosfera();
  const badges = useNavBadges();
  const source = useSourceState();

  return (
    <aside aria-label="Glavna navigacija" className={cn('shell-bar vt-sidebar flex flex-col border-r border-border', className)}>
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <BrandMark size={38} />
        <div className="min-w-0">
          <p className="truncate font-heading text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">Vazduh Srbije</p>
          {/* Oznaka „demo“ prelazi u novi red kad tekst stanja ne staje (npr. „bez svežih“). */}
          <p className="eyebrow flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <LiveDot color={source.live ? 'var(--ok)' : 'var(--faint)'} size={6} pulse={source.live} />
              SEPA · {source.text}
            </span>
            {mode === 'demo' ? <span className="rounded-full bg-warn-soft px-1.5 text-warn-soft-ink">demo</span> : null}
          </p>
        </div>
      </div>

      <nav aria-label="Stranice" className="px-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.name === view;
            const badge = badges[item.name];
            const Icon = item.icon;
            return (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => navigate(item.name)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex h-10 w-full items-center gap-3 rounded-ctl px-3 text-left text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
                    active
                      ? 'bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] text-ink shadow-[inset_0_0_0_1px_var(--border-strong),0_10px_24px_-14px_var(--haze-glow)]'
                      : 'text-muted hover:bg-card-2 hover:text-ink',
                  )}
                >
                  <Icon aria-hidden className={cn('size-[18px] shrink-0', active ? 'text-accent' : 'text-faint group-hover:text-muted')} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {badge.count !== undefined ? (
                    <span className="tnum rounded-full bg-card-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                      {formatInt(badge.count)}
                      <span className="sr-only"> stanica</span>
                    </span>
                  ) : null}
                  {badge.health ? <SyncHealthDot health={badge.health} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mx-5 my-5 h-px bg-border" />

      <section aria-labelledby="sidebar-lens" className="px-5">
        <h2 id="sidebar-lens" className="eyebrow mb-2.5">
          Polutant
        </h2>
        <LensPicker layout="wrap" />
      </section>

      <section aria-labelledby="sidebar-okrug" className="mt-5 px-5">
        <h2 id="sidebar-okrug" className="eyebrow mb-2.5">
          Okrug
        </h2>
        <OkrugSelect />
        {view === 'sinhronizacija' ? (
          <p className="mt-2 text-[11px] leading-4 text-faint">Sočivo i okrug ne menjaju ovu stranicu – važe za ostale.</p>
        ) : null}
      </section>

      <div className="mt-auto flex flex-col gap-3 px-3 pb-4 pt-6">
        <div className="flex items-center justify-between gap-2 px-2">
          <SyncStatusText />
        </div>
        <div className="flex items-center gap-1 rounded-tile border border-border bg-panel p-1">
          <UserMenu showName placement="above" className="min-w-0 flex-1" />
          <ThemeToggle />
        </div>
        <button
          type="button"
          onClick={() => navigate('sinhronizacija', { anchor: 'o-podacima' })}
          className="flex items-center gap-2 rounded-ctl px-2 py-1 text-left text-xs text-muted transition-colors hover:text-ink"
        >
          <Info aria-hidden className="size-3.5 shrink-0" />O podacima
        </button>
        <p className="px-2 text-[11px] leading-4 text-faint">
          Izvor: SEPA / Kosava Open Data API. Aplikacija nije zvanični SEPA indeks.
        </p>
      </div>
    </aside>
  );
}
