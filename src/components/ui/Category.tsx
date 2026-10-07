import { CircleHelp, ClockAlert } from 'lucide-react';

import { catMarkVar, markEdge } from '@/components/charts/marks';
import { catBgClass, catInkClass, type Category } from '@/lib/category';
import { cn } from '@/lib/cn';

/**
 * Jezik boja SEPA kategorija: čip (boja + naziv), tačka (boja + tekst pored nje).
 * Boja nikad nije jedino kodiranje – uz nju uvek ide naziv ili broj.
 */

export interface CategoryChipProps {
  category: Category | null;
  /** Stanica ima snimak, ali zastareo: sivi čip „Bez svežih podataka“ umesto kategorije. */
  stale?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CategoryChip({ category, stale = false, size = 'md', className }: CategoryChipProps) {
  const sizing = size === 'sm' ? 'h-5 px-1.5 text-[11px]' : size === 'lg' ? 'h-7 px-2.5 text-[13px]' : 'h-6 px-2 text-xs';
  if (!category) {
    const Icon = stale ? ClockAlert : CircleHelp;
    return (
      <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card-2 font-medium text-muted', sizing, className)}>
        <Icon aria-hidden className="size-3" />
        {stale ? 'Bez svežih podataka' : 'Nema podataka'}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center rounded-full font-semibold whitespace-nowrap', catBgClass(category.rank), catInkClass(category.rank), sizing, className)}>
      {category.label}
    </span>
  );
}

/**
 * Tačka kategorije (legende, tooltip-i, tabele). Tanka oznaka: prazan krug je u boji oznake
 * (`--cat-mark-N`, u svetloj temi tamnija nijansa), puna tačka ima obris u toj boji. U režimu
 * visokog kontrasta zadržava boju (`data-mark`, vidi main.css).
 */
export function CategoryDot({ rank, size = 10, hollow = false, className, title }: { rank: number | null; size?: number; hollow?: boolean; className?: string; title?: string }) {
  const style = { width: size, height: size };
  if (rank === null) {
    return <span aria-hidden title={title} style={style} className={cn('inline-block shrink-0 rounded-full border-2 border-faint bg-transparent', className)} />;
  }
  return (
    <span
      aria-hidden
      title={title}
      data-mark
      style={hollow ? { ...style, borderColor: catMarkVar(rank) } : { ...style, boxShadow: markEdge(rank) }}
      className={cn('inline-block shrink-0 rounded-full', hollow ? 'border-[2.5px] bg-transparent' : catBgClass(rank), className)}
    />
  );
}

