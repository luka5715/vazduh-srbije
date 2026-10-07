import type { ReactNode } from 'react';

import { SectionHeader } from '@/components/ui/Card';

export interface PanelHeadProps {
  id: string;
  eyebrow: ReactNode;
  title: string;
  /** Rečenica sažetka u ink boji (prvi red ispod naslova). */
  lead?: ReactNode;
  /** Objašnjenje u prigušenoj boji. */
  hint?: ReactNode;
  /** Kontrole (prekidač grafikon/tabela) – na širem ekranu uvek gore desno. */
  actions?: ReactNode;
}

/**
 * Zaglavlje panela stranice Trendovi: `SectionHeader` (eyebrow, naslov, sažetak, objašnjenje)
 * i kontrole koje na širem ekranu ostaju gore desno – tekst se prelama, kontrola ne beži u
 * sledeći red kad je rečenica sažetka duga. Na telefonu kontrola ide ispod teksta.
 */
export function PanelHead({ id, eyebrow, title, lead, hint, actions }: PanelHeadProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <SectionHeader
        id={id}
        eyebrow={eyebrow}
        title={title}
        className="min-w-0 flex-1"
        hint={
          lead || hint ? (
            <>
              {lead ? <span className="block text-ink">{lead}</span> : null}
              {hint ? <span className="block">{hint}</span> : null}
            </>
          ) : undefined
        }
      />
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
