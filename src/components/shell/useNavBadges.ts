import { useAtmosfera, type SyncHealth } from '@/hooks/useAtmosfera';
import { activeViews, liveStatus } from '@/lib/stations';
import type { ViewName } from '@/lib/views';

/** Natpis i dodatak (broj, status) stavke navigacije – deli ga bočna i donja traka. */
export function useNavBadges(): Record<ViewName, { count?: number; health?: SyncHealth }> {
  const { filteredViews, syncHealth } = useAtmosfera();
  return {
    pregled: {},
    mapa: {},
    // Stanice podrazumevano kriju neaktivne stanice – broj prati listu.
    stanice: { count: activeViews(filteredViews).length },
    trendovi: {},
    sinhronizacija: { health: syncHealth },
  };
}

/**
 * Kratko stanje izvora za oznaku ispod naziva aplikacije (bočna i gornja traka telefona):
 * „uživo“ samo dok je najnoviji interval u bazi završen pre najviše 3 h (`liveStatus`),
 * inače „kasni“; bez ijednog merenja „bez merenja“.
 */
export function useSourceState(): { text: string; live: boolean } {
  const { newestObservedAt, now } = useAtmosfera();
  if (!newestObservedAt) return { text: 'bez merenja', live: false };
  const { live } = liveStatus(newestObservedAt, now);
  return { text: live ? 'uživo' : 'kasni', live };
}
