import type { CSSProperties } from 'react';

import { LinkNotice } from '@/components/map/LinkNotice';
import { NetworkTrend } from '@/components/NetworkTrend';
import { OkrugDumbbell } from '@/components/trends/OkrugDumbbell';
import { StationCalendar } from '@/components/trends/StationCalendar';
import { TrendsSummary } from '@/components/trends/TrendsSummary';
import { useNetworkDaily } from '@/components/trends/useNetworkDaily';
import { RefreshFailedNote } from '@/components/ui/Feedback';
import { useAtmosfera } from '@/hooks/useAtmosfera';

import '@/styles/trendovi.css';

/** Kratko stepenasto pojavljivanje sekcija (počinje vidljivo, završava se za < 0,6 s). */
function stagger(index: number): { className: string; style: CSSProperties } {
  return { className: 'rise-in', style: { animationDelay: `${index * 60}ms` } };
}

/**
 * Trendovi – poslednjih 30 dana: pločice sažetka, udeo stanica po dnevnoj kategoriji (trend mreže),
 * kalendar stanica × dani i okruzi „sada prema proseku 24 h“. Sve sekcije prate sočivo
 * polutanta; trend i kalendar i filter okruga, a okruzi prikazuju sve okruge sa
 * istaknutim izabranim. Dnevna statistika se učitava jednom za celu stranicu – kad njeno
 * ponovno učitavanje ne uspe, a stari podaci ostaju, iznad svega stoji jedna napomena.
 */
export function TrendsView() {
  const { now } = useAtmosfera();
  const daily = useNetworkDaily();
  const { state } = daily;
  return (
    <div data-testid="view-trendovi" className="flex flex-col gap-4 lg:gap-5">
      <LinkNotice />
      {state.data && state.error && !state.refreshing ? <RefreshFailedNote onRetry={state.reload} loadedAt={state.loadedAt} now={now} /> : null}
      <TrendsSummary daily={daily} {...stagger(0)} />
      <NetworkTrend daily={daily} {...stagger(1)} />
      <StationCalendar daily={daily} {...stagger(2)} />
      <OkrugDumbbell {...stagger(3)} />
    </div>
  );
}
