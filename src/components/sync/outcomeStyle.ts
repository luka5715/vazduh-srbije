import { CircleAlert, CircleCheck, CircleDashed, CircleStop, Info, type LucideIcon } from 'lucide-react';

import type { OutcomeTone } from '@/hooks/useSync';

/**
 * Ikona, boja (token) i klase okvira ishoda po tonu – deli ih blok ispod dugmadi
 * (`SyncActions`) i obaveštenje u uglu (`SyncToast`). Boja nikad nije jedini nosilac:
 * uz nju uvek ide naslov ishoda.
 */
export const OUTCOME_STYLE: Record<OutcomeTone, { icon: LucideIcon; color: string; box: string }> = {
  ok: { icon: CircleCheck, color: 'var(--ok)', box: 'border-ok/30 bg-ok-soft text-ok-soft-ink' },
  partial: { icon: CircleDashed, color: 'var(--warn)', box: 'border-warn/35 bg-warn-soft text-warn-soft-ink' },
  stopped: { icon: CircleStop, color: 'var(--warn)', box: 'border-warn/35 bg-warn-soft text-warn-soft-ink' },
  info: { icon: Info, color: 'var(--accent)', box: 'border-accent/30 bg-accent-soft text-accent-soft-ink' },
  error: { icon: CircleAlert, color: 'var(--danger)', box: 'border-danger/30 bg-danger-soft text-danger-soft-ink' },
};
