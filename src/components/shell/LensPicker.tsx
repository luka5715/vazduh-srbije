import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { LENSES, lensLabel, type Lens } from '@/lib/insights';

export interface LensPickerProps {
  /** `wrap`: čipovi u više redova (bočna traka); `scroll`: jedan red sa horizontalnim skrolom (telefon). */
  layout?: 'wrap' | 'scroll';
  className?: string;
}

/** Razmak aktivnog čipa od ivice reda pri skrolovanju (telefon). */
const EDGE_PX = 16;

/**
 * Sočivo polutanta: Najlošiji · PM10 · PM2.5 · NO₂ · SO₂ · O₃ (radio grupa; strelice biraju,
 * jedan tab-stop). Menja boje markera mape, istaknutu kolonu tabele i toplotne mape.
 * U redu sa skrolom (telefon) aktivni čip je uvek ceo vidljiv (i posle dubokog linka `?lens=O3`).
 */
export function LensPicker({ layout = 'wrap', className }: LensPickerProps) {
  const { lens, setLens } = useAtmosfera();
  const groupRef = useRef<HTMLDivElement>(null);

  // Skrol se računa direktno (scrollIntoView bi pomerio i stranicu).
  useLayoutEffect(() => {
    if (layout !== 'scroll') return;
    const row = groupRef.current;
    const chip = row?.querySelector<HTMLElement>(`[data-lens="${lens}"]`);
    if (!row || !chip) return;
    const rowRect = row.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    if (rect.left < rowRect.left + EDGE_PX) row.scrollLeft -= rowRect.left + EDGE_PX - rect.left;
    else if (rect.right > rowRect.right - EDGE_PX) row.scrollLeft += rect.right - (rowRect.right - EDGE_PX);
  }, [lens, layout]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = LENSES.indexOf(lens);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % LENSES.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + LENSES.length) % LENSES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = LENSES.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = LENSES[next];
    setLens(target);
    requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>(`[data-lens="${target}"]`)?.focus());
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Polutant (sočivo)"
      onKeyDown={onKeyDown}
      className={cn(
        'flex gap-1.5',
        // Red sa skrolom: vertikalni razmak (poništen marginom) da se proširena površina za
        // dodir čipova ne seče, i prazno mesto od 16 px posle poslednjeg čipa.
        layout === 'wrap' ? 'flex-wrap' : "scroll-row -my-1 flex-nowrap py-1 after:block after:w-2.5 after:shrink-0 after:content-['']",
        className,
      )}
    >
      {LENSES.map((item: Lens) => {
        const active = item === lens;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-lens={item}
            onClick={() => setLens(item)}
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150',
              layout === 'wrap' ? 'h-7 px-2.5 text-xs' : 'touch-target h-9 px-3 text-[13px]',
              active
                ? 'border-transparent bg-ink text-page shadow-[0_6px_18px_-8px_var(--haze-glow)]'
                : 'border-border-strong bg-panel text-muted hover:border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] hover:text-ink',
            )}
          >
            {lensLabel(item)}
          </button>
        );
      })}
    </div>
  );
}
