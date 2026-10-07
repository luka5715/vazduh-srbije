import { Star } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

export interface MyStationToggleProps {
  /** Ova stanica je moja (sačuvana u ovom pregledaču). */
  mine: boolean;
  /** Postavlja ovu stanicu kao moju, odnosno uklanja je (prekidač). */
  onToggle: () => void;
  /** Neaktivna stanica se ne nudi kao nova „moja“ (samo uklanjanje, ako je već moja). */
  disabled?: boolean;
  className?: string;
}

/**
 * „Postavi kao moju stanicu“ u detalju stanice. Isključeno: dugme sa tim natpisom; uključeno:
 * oznaka „Moja stanica · prva na Pregledu“ i dugme „Ukloni“. Dugme je isti DOM element u oba
 * stanja (fokus ostaje na njemu), a promena se najavljuje čitačima ekrana. Izbor se pamti samo
 * u ovom pregledaču (`useMyStation`).
 */
export function MyStationToggle({ mine, onToggle, disabled = false, className }: MyStationToggleProps) {
  const [announcement, setAnnouncement] = useState('');
  if (!mine && disabled) return null;

  const toggle = () => {
    setAnnouncement(mine ? 'Stanica je uklonjena iz „Moja stanica“.' : 'Postavljeno kao moja stanica – prikazuje se prva na Pregledu.');
    onToggle();
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {mine ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--accent)_45%,var(--border-strong))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-2.5 text-xs font-medium text-ink">
          <Star aria-hidden className="size-3.5 fill-current text-accent" />
          Moja stanica
          <span className="font-normal text-muted">· prva na Pregledu</span>
        </span>
      ) : null}
      <button
        key="action"
        type="button"
        onClick={toggle}
        title={mine ? undefined : 'Pregled je prikazuje prvu. Pamti se samo u ovom pregledaču.'}
        className={cn(
          'touch-target inline-flex h-7 items-center gap-1.5 rounded-full text-xs font-medium transition-colors',
          mine ? 'px-2 text-muted hover:bg-card-2 hover:text-ink' : 'border border-border-strong px-2.5 text-ink hover:bg-card-2',
        )}
      >
        {mine ? null : <Star aria-hidden className="size-3.5 text-muted" />}
        {mine ? 'Ukloni' : 'Postavi kao moju stanicu'}
        {mine ? <span className="sr-only"> iz „Moja stanica“</span> : null}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
