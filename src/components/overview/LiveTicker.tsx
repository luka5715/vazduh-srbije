import { useMemo } from 'react';

import { PARAMETER_LABELS } from '@shared/aqi';

import { LiveDot } from '@/components/fx/LiveDot';
import { Marquee } from '@/components/fx/Marquee';
import { CategoryDot } from '@/components/ui/Category';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatConcentration } from '@/lib/format';
import { lensLabel, rankByLens } from '@/lib/insights';
import { liveStatus } from '@/lib/stations';

const TICKER_LIMIT = 12;

/**
 * Traka na dnu heroja: sveže stanice (filter okruga) kroz sočivo, najlošije prve –
 * „Niš 1 · PM10 38,2 ●“. Klik otvara stanicu na Mapi. Pauza na hover, dodir i dugmetom; dok je
 * fokus tastature u traci, ona je običan red za skrolovanje (Marquee), kao i uz smanjeno kretanje.
 * Natpis „Uživo“ samo dok je najnoviji sat zaista nov (`liveStatus`), inače „Poslednji sat“.
 */
export function LiveTicker({ className }: { className?: string }) {
  const { filteredViews, lens, openStation, kpis, now } = useAtmosfera();
  const { live } = liveStatus(kpis.latestObservedAt, now);
  // Najviše 12 stanica: traka je pregled najlošijih, a svaka stavka je jedno mesto za Tab.
  const ranked = useMemo(() => rankByLens(filteredViews, lens, TICKER_LIMIT), [filteredViews, lens]);
  if (!ranked.length) return null;

  const items = ranked.map(({ view, reading }) => ({
    key: view.id,
    // Kopija u petlji (`clone`) je klikabilna, ali van redosleda fokusa (tabIndex −1).
    content: (clone: boolean) => (
      <button
        type="button"
        tabIndex={clone ? -1 : undefined}
        onClick={() => openStation(view.id)}
        className="touch-target inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:bg-card-2 hover:text-ink"
      >
        <span className="font-medium text-ink">{view.station.name}</span>
        {reading.parameter ? <span className="unit-label">{PARAMETER_LABELS[reading.parameter]}</span> : null}
        <span className="tnum font-semibold text-ink">{formatConcentration(reading.value)}</span>
        <CategoryDot rank={reading.category?.rank ?? null} size={8} />
        <span className="sr-only">{reading.category?.label ?? 'nema podataka'}</span>
      </button>
    ),
  }));

  return (
    <div className={cn('ov-ticker relative flex items-center gap-2 border-t border-border py-1.5 pl-4 pr-2 sm:gap-3 sm:pl-7 sm:pr-3 lg:pl-8', className)}>
      <p className="eyebrow flex shrink-0 items-center gap-2">
        <LiveDot size={6} color={live ? undefined : 'var(--faint)'} pulse={live} />
        <span>{live ? 'Uživo' : 'Poslednji sat'}</span>
        <span className="hidden sm:inline">· {lensLabel(lens)}</span>
      </p>
      <Marquee
        items={items}
        label={`${live ? 'Uživo' : 'Poslednji sat'} po stanicama, ${lensLabel(lens)}, najlošije prve`}
        gap={6}
        speed={32}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
