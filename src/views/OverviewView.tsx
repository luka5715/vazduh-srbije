import { useMemo, type CSSProperties } from 'react';

import { LinkNotice } from '@/components/map/LinkNotice';
import { MapPreview } from '@/components/overview/MapPreview';
import { MyStationCard } from '@/components/overview/MyStation';
import { NetworkRhythm } from '@/components/overview/NetworkRhythm';
import { OverviewHero } from '@/components/overview/OverviewHero';
import { OverviewKpis } from '@/components/overview/OverviewKpis';
import { WORST_LIMIT } from '@/components/overview/overviewText';
import { WorstStations } from '@/components/overview/WorstStations';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { rankByLens } from '@/lib/insights';

import '@/styles/pregled.css';

/** Kratko stepenasto pojavljivanje sekcija (počinje vidljivo, završava se za < 0,6 s). */
function stagger(index: number, className?: string): { className: string; style: CSSProperties } {
  return { className: className ? `rise-in ${className}` : 'rise-in', style: { animationDelay: `${index * 60}ms` } };
}

/**
 * Pregled – „wow“ stranica: (moja stanica, kad je izabrana), heroj sa česticama Košave i
 * prstenom kategorija, četiri KPI pločice, „Ritam mreže · 24 h“, najzagađenije stanice i
 * pregled mape. Sve sekcije osim moje stanice prate filter okruga; ritam, rang-lista, mapa,
 * traka i „Najlošije sada“ i sočivo polutanta (heroj uvek opisuje sve polutante).
 */
export function OverviewView() {
  const { filteredViews, lens } = useAtmosfera();
  // Kratka rang-lista (npr. mali okrug) ne stoji pored visoke mape: obe kartice idu preko cele širine.
  const shortList = useMemo(() => rankByLens(filteredViews, lens, WORST_LIMIT).length < 5, [filteredViews, lens]);
  return (
    <div data-testid="view-pregled" className="flex flex-col gap-4 lg:gap-5">
      <LinkNotice />
      <MyStationCard {...stagger(0)} />
      <OverviewHero {...stagger(0)} />
      <OverviewKpis {...stagger(1)} />
      <NetworkRhythm {...stagger(2)} />
      <div className={cn('grid items-stretch gap-4 lg:gap-5', !shortList && 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        <WorstStations {...stagger(3)} />
        <MapPreview {...stagger(4)} />
      </div>
    </div>
  );
}
