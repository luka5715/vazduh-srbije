import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import { okrugLabel, okrugOf } from '@/lib/insights';
import type { StationView } from '@/lib/stations';

import { okrugShort } from './stationRows';

export interface OkrugChipsProps {
  /** Sve stanice mreže (brojevi na čipovima ne zavise od izabranog okruga). */
  views: StationView[];
  okrugs: string[];
  okrug: string | null;
  onChange: (okrug: string | null) => void;
  className?: string;
}

/** Prati da li red sa skrolom ima još sadržaja levo/desno (za senčenje ivica i strelice). */
function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const start = element.scrollLeft <= 2;
      const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
      setEdges((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref]);
  return edges;
}

/**
 * Čipovi okruga (jedan izbor, radio grupa): „Svi okruzi“ + okruzi sa brojem stanica.
 * Menjaju globalni filter okruga (isti kao u bočnoj traci), pa filtriraju i ostale stranice.
 * Jedan red sa horizontalnim skrolom, senčenim ivicama i strelicama na uređajima sa mišem;
 * strelice levo/desno, Home i End biraju sa tastature.
 */
export function OkrugChips({ views, okrugs, okrug, onChange, className }: OkrugChipsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(rowRef);
  const reduced = useReducedMotion();

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const view of views) {
      const name = okrugOf(view);
      if (name) map.set(name, (map.get(name) ?? 0) + 1);
    }
    return map;
  }, [views]);

  // Okrug bez ijedne stanice na listi (npr. samo neaktivne) se ne nudi – osim izabranog.
  const options: Array<string | null> = useMemo(
    () => [null, ...okrugs.filter((name) => name === okrug || (counts.get(name) ?? 0) > 0)],
    [okrugs, okrug, counts],
  );

  // Izabrani čip se dovodi u vidno polje reda (samo horizontalno – strana se ne pomera).
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' });
  }, [okrug, reduced]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.indexOf(okrug);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(options.length - 1, index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = options[next];
    onChange(target);
    requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>(`[data-okrug-index="${next}"]`)?.focus());
  };

  const scrollByPage = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * Math.max(160, row.clientWidth * 0.7), behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <div className={cn('st-chips relative min-w-0', !edges.start && 'st-chips--more-start', !edges.end && 'st-chips--more-end', className)}>
      <div ref={rowRef} role="radiogroup" aria-label="Okrug" onKeyDown={onKeyDown} className="st-chips__row scroll-row flex gap-1.5 py-1 pointer-coarse:py-1.5">
        {options.map((name, index) => {
          const active = name === okrug;
          const count = name ? (counts.get(name) ?? 0) : views.length;
          return (
            <button
              key={name ?? 'svi'}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${name ? okrugLabel(name) : 'Svi okruzi'}, ${count}`}
              tabIndex={active ? 0 : -1}
              data-okrug-index={index}
              onClick={() => onChange(name)}
              className={cn(
                'touch-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150',
                active
                  ? 'border-transparent bg-ink font-medium text-page shadow-[0_6px_18px_-8px_var(--haze-glow)]'
                  : 'border-border-strong bg-panel text-muted hover:border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] hover:text-ink',
              )}
            >
              {name ? okrugShort(name) : 'Svi okruzi'}
              <span className={cn('tnum font-mono text-[12px] sm:text-[11px]', active ? 'text-page/70' : 'text-faint')}>{count}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => scrollByPage(-1)}
        className="st-chips__nav st-chips__nav--start"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button type="button" tabIndex={-1} aria-hidden onClick={() => scrollByPage(1)} className="st-chips__nav st-chips__nav--end">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
