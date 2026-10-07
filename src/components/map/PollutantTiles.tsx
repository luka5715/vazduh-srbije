import type { CSSProperties } from 'react';

import { PARAMETER_LABELS, PARAMETER_NAMES, PARAMETERS, UNIT, type Parameter } from '@shared/aqi';

import { Sparkline } from '@/components/fx/Sparkline';
import { CategoryDot } from '@/components/ui/Category';
import { catVar, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration } from '@/lib/format';
import type { StationView } from '@/lib/stations';

export interface PollutantTilesProps {
  view: StationView;
  /** Istaknuti polutant (dominantni). */
  highlight: Parameter | null;
  className?: string;
}

/**
 * Pločice polutanata: trenutna satna vrednost, kategorija (tačka + naziv) i mini linija
 * poslednja 24 sata u boji kategorije. Na uskom kontejneru 2 kolone (dominantni ide prvi i
 * zauzima ceo red kad je broj pločica neparan), na širem svi u jednom redu.
 */
export function PollutantTiles({ view, highlight, className }: PollutantTilesProps) {
  const measured = PARAMETERS.filter((p) => view.values[p] !== undefined || (view.series.values[p]?.some((v) => v !== null) ?? false));
  const missing = PARAMETERS.filter((p) => !measured.includes(p));
  const odd = measured.length % 2 === 1;
  const lead = highlight && measured.includes(highlight) ? highlight : (measured[0] ?? null);

  if (measured.length === 0) {
    return <p className={cn('text-[13px] text-muted', className)}>Stanica nema satnih merenja u poslednjem snimku.</p>;
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ul
        className="grid grid-cols-2 gap-2 @min-[470px]:grid-cols-[repeat(var(--tiles),minmax(0,1fr))]"
        style={{ '--tiles': measured.length } as CSSProperties}
        aria-label={view.stale ? `Poslednje poznate satne vrednosti (zastarele), ${UNIT}` : `Trenutne satne vrednosti, ${UNIT}`}
      >
        {measured.map((p) => {
          const entry = view.values[p];
          const rank = entry && !view.stale ? entry.c : null;
          const series = view.series.values[p] ?? [];
          const finite = series.filter((v): v is number => typeof v === 'number');
          const isLead = p === lead;
          const isHighlight = p === highlight;
          return (
            <li
              key={p}
              className={cn(
                'relative flex min-w-0 flex-col gap-1.5 rounded-tile border px-3 pb-2.5 pt-3 transition-colors',
                isHighlight
                  ? 'haze-local border-[var(--haze-edge)] bg-[color-mix(in_oklab,var(--haze)_9%,var(--card-2))]'
                  : 'border-border bg-card-2',
                isLead && odd && 'order-first col-span-2 @min-[470px]:order-none @min-[470px]:col-span-1',
                view.stale && 'opacity-80',
              )}
              style={isHighlight && rank !== null ? ({ '--haze': catVar(rank) } as CSSProperties) : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="unit-label text-muted" title={PARAMETER_NAMES[p]}>
                  {PARAMETER_LABELS[p]}
                  {isHighlight ? <span className="sr-only"> (dominantni polutant)</span> : null}
                </span>
                {isHighlight ? <span aria-hidden title="Dominantni polutant" className="size-1.5 rounded-full bg-[var(--haze)] shadow-[0_0_8px_1px_var(--haze-glow)]" /> : null}
              </div>
              <p className="font-heading text-[22px] font-semibold leading-none text-ink">
                {entry ? formatConcentration(entry.v) : <span className="text-faint">–</span>}
                <span className="sr-only"> {UNIT}</span>
              </p>
              {finite.length > 1 ? (
                <Sparkline
                  values={series}
                  height={26}
                  color={rank === null ? 'var(--faint)' : catVar(rank)}
                  label={`${PARAMETER_LABELS[p]}, poslednja 24 sata: od ${formatConcentration(Math.min(...finite))} do ${formatConcentration(Math.max(...finite))} ${UNIT}`}
                />
              ) : (
                <div className="h-[26px]" aria-hidden />
              )}
              <p className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted">
                <CategoryDot rank={rank} size={8} />
                <span className="truncate">{rank !== null ? categoryOf(rank).label : view.stale ? 'zastarelo' : 'nema vrednosti'}</span>
              </p>
            </li>
          );
        })}
      </ul>
      {missing.length ? (
        <p className="text-xs text-faint">
          Stanica ne meri: {missing.map((p) => PARAMETER_LABELS[p]).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
