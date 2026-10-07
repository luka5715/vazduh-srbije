import { PARAMETER_LABELS, PARAMETERS, type Parameter } from '@shared/aqi';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { cn } from '@/lib/cn';
import type { Lens } from '@/lib/insights';

import { DeltaInline, LensBar, LensValue, PollutantValue, RowChip, StationMeta, TrendSpark } from './parts';
import { isStaleGroup, rowTint, type StationRow } from './stationRows';

export interface StationCardsProps {
  rows: StationRow[];
  lens: Lens;
  bands: number;
  onOpen: (stationId: string) => void;
  currentId: string | null;
  latest: Date | null;
  className?: string;
}

/**
 * Stanice kao kartice (telefon i uži ekrani): ivica i sjaj kartice su u boji kategorije
 * sočiva, cela kartica otvara stanicu na Mapi (rastegnuto dugme na nazivu – jedan tab-stop).
 */
export function StationCards({ rows, lens, bands, onOpen, currentId, latest, className }: StationCardsProps) {
  const lensParameter: Parameter | null = lens === 'worst' ? null : lens;
  return (
    <ul className={cn('grid grid-cols-1 gap-3 @xl:grid-cols-2', className)} aria-label="Stanice">
      {rows.map((row, index) => {
        const { view, reading } = row;
        const stale = isStaleGroup(row.group);
        const current = row.id === currentId;
        const emphasized = lensParameter ?? reading.parameter;
        return (
          <li key={row.id} className={cn('min-w-0', index < 10 && 'st-card--enter')} style={{ animationDelay: index < 10 ? `${index * 24}ms` : undefined }}>
            <GlassPanel
              as="article"
              variant="tile"
              interactive
              className={cn('st-card haze-local flex h-full flex-col gap-3 p-4', stale && 'st-card--stale', current && 'st-card--current')}
              style={rowTint(row)}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold leading-5 text-ink">
                    <button type="button" onClick={() => onOpen(view.id)} className="st-card__link text-left">
                      {view.station.name}
                      <span className="sr-only">{current ? ' (poslednja otvorena)' : ''}, otvori na mapi</span>
                    </button>
                  </h3>
                  <StationMeta row={row} latest={latest} className="mt-1" />
                </div>
                <RowChip row={row} className="mt-px shrink-0" />
              </div>

              {/* Stalna druga kolona (promena desno poravnata): traka i skica imaju istu geometriju na svim karticama. */}
              <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-end gap-x-4 gap-y-2.5">
                <LensValue row={row} size="lg" />
                <TrendSpark row={row} height={28} className="w-[88px] justify-self-end" />
                {reading.value !== null && reading.parameter ? (
                  <LensBar
                    parameter={reading.parameter}
                    value={reading.value}
                    rank={reading.category?.rank ?? null}
                    bands={bands}
                    muted={stale}
                    delay={Math.min(index, 10) * 24}
                    className={cn(stale && 'col-span-2')}
                  />
                ) : (
                  <span aria-hidden className={cn('block h-1.5 rounded-full border border-dashed border-border-strong', stale && 'col-span-2')} />
                )}
                {stale ? null : <DeltaInline row={row} layout="inline" className="justify-self-end" />}
              </div>

              <dl className="mt-auto grid grid-cols-5 gap-1 border-t border-border pt-2.5 text-xs">
                {PARAMETERS.map((parameter) => (
                  <div key={parameter} className="flex min-w-0 flex-col gap-0.5">
                    <dt className={cn('unit-label truncate', parameter === emphasized ? 'text-muted' : 'text-faint')}>
                      {PARAMETER_LABELS[parameter]}
                    </dt>
                    <dd className="flex">
                      <PollutantValue row={row} parameter={parameter} emphasized={parameter === emphasized} />
                    </dd>
                  </div>
                ))}
              </dl>
            </GlassPanel>
          </li>
        );
      })}
    </ul>
  );
}
