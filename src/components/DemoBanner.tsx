import { TriangleAlert } from 'lucide-react';

import { demoScenario, LATE_FEED_HOURS } from '@/services/demoScenario';

/**
 * Stalna, neuklonjiva oznaka demo režima – vidi se na svakom ekranu (i na prijavi).
 * Tekst se ne menja; traka nema dugme za zatvaranje. Imenovana sekcija (orijentir „Demo
 * režim“), jer stoji iznad `<main>` i van ostalih orijentira.
 */
export function DemoBanner() {
  const scenario = demoScenario();
  return (
    <section
      aria-label="Demo režim"
      className="relative border-b border-warn/40 bg-warn-soft px-safe-4 py-2 text-center text-[12.5px] font-medium leading-5 text-warn-soft-ink sm:text-[13px]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, color-mix(in oklab, var(--warn) 9%, transparent) 0 10px, transparent 10px 20px)',
      }}
    >
      <TriangleAlert aria-hidden className="-mt-0.5 mr-1.5 inline size-4 text-warn" />
      DEMO PODACI — ovo nisu stvarna merenja. Pokrenite aplikaciju u Fabric-u za prave podatke SEPA.
      {scenario === 'late' ? ` Scenario: SEPA kasni ${LATE_FEED_HOURS} h.` : scenario === 'empty' ? ' Scenario: prazna baza.' : ''}
    </section>
  );
}
