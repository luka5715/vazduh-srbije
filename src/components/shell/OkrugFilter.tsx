import { Check, ChevronDown, ListFilter, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Dialog } from '@/components/ui/Dialog';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatInt, stationsNoun } from '@/lib/format';
import { filterByOkrug, okrugLabel, stationsWithoutOkrug } from '@/lib/insights';
import { activeViews } from '@/lib/stations';

/** Izbor okruga za desktop (bočna traka): nativni `<select>` – pristupačan i radi svuda. */
export function OkrugSelect({ className }: { className?: string }) {
  const { okrugs, okrug, setOkrug, views } = useAtmosfera();
  const id = useId();
  const withoutOkrug = stationsWithoutOkrug(views);
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        Okrug
      </label>
      <select
        id={id}
        value={okrug ?? ''}
        onChange={(event) => setOkrug(event.target.value || null)}
        // Fokus: globalni `:focus-visible` obris u boji akcenta (puna jačina, ≥ 3 : 1).
        className={cn(
          'h-9 w-full appearance-none rounded-ctl border bg-panel pl-3 pr-8 text-[13px] text-ink shadow-[var(--shadow-inset)] transition-colors',
          okrug ? 'border-[color-mix(in_oklab,var(--haze)_55%,var(--border-strong))]' : 'border-border-strong hover:border-[color-mix(in_oklab,var(--haze)_40%,var(--border-strong))]',
        )}
      >
        <option value="">Svi okruzi</option>
        {okrugs.map((name) => (
          <option key={name} value={name}>
            {okrugLabel(name)}
          </option>
        ))}
        {withoutOkrug > 0 ? <option disabled>{withoutOkrugText(withoutOkrug)}</option> : null}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

/** Čip aktivnog filtera sa dugmetom za uklanjanje (gornja traka, telefon). */
export function OkrugChip({ className }: { className?: string }) {
  const { okrug, setOkrug, filteredViews } = useAtmosfera();
  if (!okrug) return null;
  const count = activeViews(filteredViews).length;
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--haze)_50%,var(--border-strong))] bg-panel pl-3 pr-1 text-[13px] text-ink',
        className,
      )}
    >
      <ListFilter aria-hidden className="size-3.5 shrink-0 text-muted" />
      <span className="truncate">
        {okrugLabel(okrug)} <span className="tnum text-muted">· {count}</span>
      </span>
      <button
        type="button"
        onClick={() => setOkrug(null)}
        aria-label={`Ukloni filter: ${okrugLabel(okrug)}`}
        className="touch-target grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-card-2 hover:text-ink"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * Filter okruga za telefon: ikonica u gornjoj traci otvara list odozdo (dijalog) sa listom
 * okruga kao radio dugmadima. Tačka na ikonici znači da je filter aktivan.
 */
export function OkrugSheetButton({ className }: { className?: string }) {
  const { okrugs, okrug, setOkrug, views } = useAtmosfera();
  const networkViews = activeViews(views);
  const withoutOkrug = stationsWithoutOkrug(views);
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const choose = (value: string | null) => {
    setOkrug(value);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={okrug ? `Filter okruga: ${okrugLabel(okrug)}` : 'Filter okruga'}
        className={cn('relative grid size-10 place-items-center rounded-ctl text-ink transition-colors hover:bg-card-2', className)}
      >
        <ListFilter aria-hidden className="size-[18px]" />
        {okrug ? <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-haze ring-2 ring-[var(--panel-solid)]" /> : null}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy={titleId} placement="sheet" initialFocusRef={firstRef}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="eyebrow">Filter</p>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              Okrug
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Zatvori"
            className="grid size-9 place-items-center rounded-ctl text-muted hover:bg-card-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div role="radiogroup" aria-labelledby={titleId} className="max-h-[60dvh] overflow-y-auto p-2">
          {[null, ...okrugs].map((name, index) => {
            const active = (name ?? null) === okrug;
            const count = name ? filterByOkrug(networkViews, name).length : networkViews.length;
            return (
              <button
                key={name ?? 'svi'}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(name)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-left text-sm transition-colors',
                  active ? 'bg-accent-soft text-accent-soft-ink' : 'text-ink hover:bg-card-2',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{name ? okrugLabel(name) : 'Svi okruzi'}</span>
                <span className="tnum text-xs text-muted">{count}</span>
                <Check aria-hidden className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
              </button>
            );
          })}
          {withoutOkrug > 0 ? <p className="px-3 pb-1 pt-2 text-xs leading-5 text-muted">{withoutOkrugText(withoutOkrug)}</p> : null}
        </div>
      </Dialog>
    </>
  );
}

/** „2 stanice bez okruga (samo u „Svi okruzi“)“ – aktivne stanice čija opština nije u indeksu okruga. */
function withoutOkrugText(count: number): string {
  return `${formatInt(count)} ${stationsNoun(count)} bez okruga (samo u „Svi okruzi“)`;
}
