import { CATEGORIES, catVar, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';

import { catInkVar, markEdge } from './marks';

/**
 * Jedinstvena oznaka nepotpunog perioda (današnji dan): PUNA boja kategorije (boja ostaje na
 * SEPA skali – bez prozirnosti koja bi tamne ćelije pretvarala u maslinaste/braon) + dijagonalna
 * šrafura u boji površine + isprekidan obris 1 px u `--muted`. Ista na toplotnim mapama,
 * stubovima i u legendi.
 */
export const PARTIAL_HATCH =
  'repeating-linear-gradient(135deg, color-mix(in oklab, var(--panel-solid) 45%, transparent) 0 2px, transparent 2px 5px)';

/** Isprekidan obris nepotpunog perioda (unutar elementa, ne pomera raspored). */
export const PARTIAL_OUTLINE = 'outline-1 outline-dashed outline-muted -outline-offset-1';

/** SVG šrafura nepotpunog perioda (isti ugao i korak kao `PARTIAL_HATCH`) za `fill="url(#id)"`. */
export function PartialHatchPattern({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
      <rect width={2} height={5} style={{ fill: 'var(--panel-solid)' }} fillOpacity={0.45} />
    </pattern>
  );
}

export interface CategoryLegendProps {
  /** Broj uz svaku kategoriju (npr. stanica), kad ima smisla. */
  counts?: number[];
  /** Dodaje stavku za nepotpun period (šrafura sa isprekidanim obrisom). */
  partialDay?: boolean;
  /** Natpis te stavke (podrazumevano „danas – nepotpun dan“). */
  partialLabel?: string;
  /**
   * Kategorije od ove naviše imaju i centralnu tačku (kao ćelije toplotne mape), a legenda
   * dobija stavku „tačka = Zagađen ili lošije“. Bez vrednosti – samo boja + naziv.
   */
  dotRank?: number;
  className?: string;
}

/** Legenda grafikona sa SEPA kategorijama: boja + naziv (nikad samo boja). */
export function CategoryLegend({ counts, partialDay = false, partialLabel = 'danas – nepotpun dan', dotRank, className }: CategoryLegendProps) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted', className)} aria-label="Legenda kategorija">
      {RANKS.map((rank) => (
        <li key={rank} className="inline-flex items-center gap-1.5">
          <CategorySwatch rank={rank} dot={dotRank !== undefined && rank >= dotRank} />
          <span>{CATEGORIES[rank].label}</span>
          {counts ? <span className="tnum text-faint">{counts[rank]}</span> : null}
        </li>
      ))}
      {dotRank !== undefined ? (
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex size-2.5 shrink-0 items-center justify-center rounded-[3px] border border-border-strong">
            <span className="size-1 rounded-full bg-ink" />
          </span>
          <span>tačka = „{CATEGORIES[Math.min(5, Math.max(0, dotRank))].label}“ ili lošije</span>
        </li>
      ) : null}
      {partialDay ? (
        <li className="inline-flex items-center gap-1.5">
          <PartialDayKey />
          <span>{partialLabel}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Kvadratić kategorije u legendi: ispuna kategorije, tanak obris u boji oznake (svetla tema –
 * žuta/zelena na beloj dobija ivicu) i, po potrebi, tačka kao na ćelijama toplotne mape.
 */
export function CategorySwatch({ rank, dot = false, className }: { rank: number; dot?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-mark
      className={cn('inline-flex size-2.5 shrink-0 items-center justify-center rounded-[3px]', className)}
      style={{ backgroundColor: catVar(rank), boxShadow: markEdge(rank) }}
    >
      {dot ? <span className="size-1 rounded-full" style={{ backgroundColor: catInkVar(rank) }} /> : null}
    </span>
  );
}

/**
 * Ključ za nepotpun (današnji) dan: ista šrafura i isprekidan obris kao na ćelijama i stubovima,
 * preko neutralne ispune (boja kategorije zavisi od dana – vidi ostale stavke legende).
 */
export function PartialDayKey() {
  return (
    <span
      aria-hidden
      data-mark
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', PARTIAL_OUTLINE)}
      style={{ backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)', backgroundImage: PARTIAL_HATCH }}
    />
  );
}
