import type { ReactNode } from 'react';

import { lensLabel, scopeLabel, type Lens } from '@/lib/insights';

/**
 * Sadržaj natpisa („eyebrow“) panela koji prati globalne filtere – isti na svim stranicama:
 * „[uvod ·] Sočivo · opseg“, npr. „24 h · NO₂ · Nišavski okrug“. Aktivan okrug je u ink boji,
 * da se filter vidi u svakom panelu koji filtrira.
 */
export function LensScope({ lens, okrug, prefix }: { lens: Lens; okrug: string | null; prefix?: ReactNode }) {
  return (
    <>
      {prefix ? <>{prefix} · </> : null}
      {lensLabel(lens)} · <span className={okrug ? 'text-ink' : undefined}>{scopeLabel(okrug)}</span>
    </>
  );
}
