import { ChartSpline, Gauge, Map as MapIcon, RefreshCw, Rows3, type LucideIcon } from 'lucide-react';

import type { SyncHealth } from '@/hooks/useAtmosfera';
import { VIEW_META, VIEW_NAMES, type ViewMeta, type ViewName } from '@/lib/views';

export interface NavItem extends ViewMeta {
  icon: LucideIcon;
}

const ICONS: Record<ViewName, LucideIcon> = {
  pregled: Gauge,
  mapa: MapIcon,
  stanice: Rows3,
  trendovi: ChartSpline,
  sinhronizacija: RefreshCw,
};

/** Stavke navigacije (bočna traka, donja traka, paleta komandi) redom stranica. */
export const NAV_ITEMS: NavItem[] = VIEW_NAMES.map((name) => ({ ...VIEW_META[name], icon: ICONS[name] }));

/** Tačka stanja sinhronizacije u navigaciji: boja, tekst za čitače ekrana i pulsiranje. */
export const SYNC_HEALTH: Record<SyncHealth, { color: string; text: string; pulse: boolean } | null> = {
  ok: { color: 'var(--ok)', text: 'poslednja uspešna', pulse: false },
  error: { color: 'var(--danger)', text: 'poslednja sa greškom', pulse: false },
  running: { color: 'var(--accent)', text: 'u toku', pulse: true },
  abandoned: { color: 'var(--warn)', text: 'poslednja prekinuta', pulse: false },
  none: null,
};
