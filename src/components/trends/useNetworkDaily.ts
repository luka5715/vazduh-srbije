import { useMemo } from 'react';

import type { DailyStatRecord } from '@shared/contracts';
import { todayLocal } from '@shared/time';

import { useAsyncData, type AsyncState } from '@/hooks/useAsyncData';
import { useAtmosfera } from '@/hooks/useAtmosfera';

import { trendWindow, type TrendWindow } from './trendData';

export interface NetworkDaily extends TrendWindow {
  /** Dnevna statistika cele mreže za prozor (jedan upit za ceo prikaz stranice). */
  state: AsyncState<DailyStatRecord[]>;
}

/**
 * Dnevna statistika mreže za poslednjih 30 dana i dan pre njih (poređenje 15 + 15 završenih
 * dana, vidi `compareDays`) – učitava se JEDNOM za stranicu Trendovi (pločice, trend,
 * kalendar), ponovo posle svake sinhronizacije/istorije (`dataVersion`) i kad počne novi
 * dan. Čitanje ide kroz deljeni keš provajdera (`loadNetworkDaily`): isti prvi dan traži i
 * pokrivenost istorije na Sinhronizaciji, pa prelazak sa jedne stranice na drugu ne čita bazu
 * ponovo. Pri ponovnom učitavanju stari podaci ostaju prikazani (prigušeno).
 */
export function useNetworkDaily(): NetworkDaily {
  const { loadNetworkDaily, now } = useAtmosfera();
  const nowMs = now.getTime();
  const today = todayLocal(now);
  // Prozor zavisi samo od dana – `now` se menja svakog minuta.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- namerno samo `today`
  const range = useMemo(() => trendWindow(new Date(nowMs)), [today]);
  const loadFrom = range.compareDays[0] ?? range.fromDay;
  // `loadNetworkDaily` menja identitet sa `dataVersion`, pa je to i zavisnost učitavanja.
  const state = useAsyncData(({ retry }) => loadNetworkDaily(loadFrom, { fresh: retry }), [loadNetworkDaily, loadFrom]);
  return { ...range, state };
}
