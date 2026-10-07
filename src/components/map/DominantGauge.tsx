import { ClockAlert } from 'lucide-react';

import { PARAMETER_LABELS, THRESHOLDS_1H, UNIT, type Parameter } from '@shared/aqi';

import { RingGauge } from '@/components/fx/RingGauge';
import { CATEGORIES, catVar, categoryOf } from '@/lib/category';
import { formatConcentration, formatNumber } from '@/lib/format';

export interface DominantGaugeProps {
  parameter: Parameter | null;
  value: number | null;
  /** Kategorija vrednosti (null: zastarelo ili bez podataka – siv prazan prsten). */
  rank: number | null;
  stale?: boolean;
  size?: number;
}

/**
 * Prsten dominantnog polutanta: skala od 0 do granice „Zagađen“ (početak kategorije
 * „Veoma zagađen“), podeoci na prstenu su SEPA granice nižih kategorija, pa se vidi u kom
 * pojasu je vrednost i koliko je do sledećeg. Boja luka = kategorija.
 */
export function DominantGauge({ parameter, value, rank, stale = false, size = 84 }: DominantGaugeProps) {
  const thickness = 8;
  if (!parameter || value === null || rank === null) {
    return (
      <RingGauge value={0} size={size} thickness={thickness} label={stale ? 'Bez svežih podataka' : 'Nema trenutne vrednosti'}>
        {stale ? <ClockAlert aria-hidden className="size-6 text-faint" /> : <span className="font-heading text-lg font-semibold text-faint">–</span>}
      </RingGauge>
    );
  }
  const limits = THRESHOLDS_1H[parameter];
  const scaleMax = limits[3];
  const fraction = Math.min(1, value / scaleMax);
  const ticks = limits.slice(0, 3).map((limit) => limit / scaleMax);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const label = `${PARAMETER_LABELS[parameter]} ${formatConcentration(value)} ${UNIT}, kategorija ${categoryOf(rank).label}. Skala prstena do ${formatNumber(scaleMax, 0)} ${UNIT} (granica kategorije ${CATEGORIES[4].label}); podeoci su granice kategorija ${limits
    .slice(0, 3)
    .map((limit) => formatNumber(limit, 0))
    .join(', ')} ${UNIT}.`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <RingGauge value={fraction} size={size} thickness={thickness} color={catVar(rank)} label={label}>
        <span className="font-heading text-[19px] font-semibold leading-none text-ink">{formatConcentration(value)}</span>
        <span className="unit-label mt-1 !leading-none text-muted">{PARAMETER_LABELS[parameter]}</span>
      </RingGauge>
      {/* Podeoci: kratki prekidi u boji površine preko luka (granice kategorija). */}
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pointer-events-none absolute inset-0 -rotate-90">
        {ticks.map((tick) => {
          const angle = tick * Math.PI * 2;
          const inner = radius - thickness / 2 - 1.5;
          const outer = radius + thickness / 2 + 1.5;
          return (
            <line
              key={tick}
              x1={center + Math.cos(angle) * inner}
              y1={center + Math.sin(angle) * inner}
              x2={center + Math.cos(angle) * outer}
              y2={center + Math.sin(angle) * outer}
              stroke="var(--panel-solid)"
              strokeWidth={2.5}
            />
          );
        })}
      </svg>
    </div>
  );
}
