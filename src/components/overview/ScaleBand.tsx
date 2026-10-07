import { PARAMETER_LABELS, THRESHOLDS_1H, UNIT, classify, type Parameter } from '@shared/aqi';

import { catVar, categoryOf, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatInt } from '@/lib/format';

import { bandPosition } from './overviewText';

export interface ScaleBandProps {
  parameter: Parameter;
  /** Vrednost na skali (npr. medijana mreže) ili null – tada samo skala bez oznake. */
  value: number | null;
  /** Šta je vrednost, za opis čitačima ekrana (npr. „Medijana PM10“). */
  subject: string;
  className?: string;
}

/**
 * Ordinalna SEPA skala polutanta (šest pojaseva iste širine, granice ispod) sa oznakom
 * vrednosti – deo KPI pločice medijane. Kategorija je u pločici i tekstom (čip), ovde je
 * položaj; opis za čitače nabraja vrednost, kategoriju i granice. U uskoj pločici (telefon)
 * ispod skale stoji svaka druga granica, da se brojevi ne slepe.
 */
export function ScaleBand({ parameter, value, subject, className }: ScaleBandProps) {
  const limits = THRESHOLDS_1H[parameter];
  const category = value === null ? null : categoryOf(classify(parameter, value));
  const position = value === null ? null : bandPosition(parameter, value, 6).position;
  const description =
    value === null
      ? `${subject}: nema svežih podataka. SEPA granice ${PARAMETER_LABELS[parameter]}: ${limits.map((limit) => formatInt(limit)).join(', ')} ${UNIT}.`
      : `${subject} ${formatConcentration(value)} ${UNIT} na SEPA skali, kategorija ${category?.label}; granice ${limits.map((limit) => formatInt(limit)).join(', ')} ${UNIT}.`;

  return (
    <div className={cn('ov-scale relative', className)} role="img" aria-label={description}>
      <div className="relative h-[18px]">
        <div aria-hidden data-mark className="absolute inset-x-0 top-[6px] flex h-1.5 gap-[2px]">
          {RANKS.map((rank) => (
            <span
              key={rank}
              className={cn('ov-meter__band h-full flex-1', rank === 0 && 'rounded-l-full', rank === RANKS.length - 1 && 'rounded-r-full')}
              style={{ backgroundColor: catVar(rank) }}
            />
          ))}
        </div>
        {position !== null && category ? (
          <span
            aria-hidden
            data-mark
            className="ov-meter__marker absolute top-0 grid size-[18px] -translate-x-1/2 place-items-center"
            style={{ left: `${(position * 100).toFixed(2)}%` }}
          >
            <span
              className="size-3 rounded-full border-[2.5px] border-panel-solid"
              style={{ backgroundColor: 'var(--ink)', boxShadow: `0 0 0 1px var(--border-strong), 0 0 12px ${catVar(category.rank)}` }}
            />
          </span>
        ) : null}
      </div>
      <div aria-hidden className="relative h-3.5">
        {limits.map((limit, index) => (
          <span
            key={limit}
            className={cn('tnum absolute top-0 -translate-x-1/2 font-mono text-[10px] leading-[14px] text-faint', index % 2 === 1 && 'ov-scale__minor')}
            style={{ left: `${(((index + 1) / 6) * 100).toFixed(2)}%` }}
          >
            {formatInt(limit)}
          </span>
        ))}
      </div>
    </div>
  );
}
