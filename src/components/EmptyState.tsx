import { LoaderCircle } from 'lucide-react';
import type { CSSProperties } from 'react';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { LiveDot } from '@/components/fx/LiveDot';
import { SyncActions } from '@/components/sync/SyncActions';
import type { SyncActivity } from '@/hooks/useSync';
import { cn } from '@/lib/cn';
import { STALE_MINUTES } from '@/lib/syncRules';
import { isDemoMode } from '@/services/bootstrap';

export interface EmptyStateProps {
  activity: SyncActivity | null;
  onSync: () => void;
  onBackfill: () => void;
  onStop: () => void;
}

interface Step {
  title: string;
  text: string;
  /** Posao koji ovaj korak izvršava (za stanje „u toku“). */
  kind?: SyncActivity['kind'];
}

const STEPS: Step[] = [
  {
    title: 'Preuzmi podatke sa SEPA',
    text: 'Stanice, trenutno stanje i dnevna statistika za svaki dan koji prozor obuhvata – potpuna za sve dane osim današnjeg, koji se dopunjava svakom sinhronizacijom.',
    kind: 'sync',
  },
  {
    title: 'Učitaj istoriju (30 dana)',
    text: 'Dan po dan, oko minut po danu, od najstarijeg. Možete prekinuti u svakom trenutku – sledeći put se nastavlja od prvog dana koji još nedostaje.',
    kind: 'backfill',
  },
  {
    title: 'Vraćajte se po sveže podatke',
    text: `Pri svakom otvaranju aplikacija proverava starost podataka i osvežava ih kad su stariji od ${STALE_MINUTES} minuta.`,
  },
];

/** Prvi ekran posle `npx rayfin up`: baza je prazna, korisnik pokreće prvo preuzimanje. */
export function EmptyState({ activity, onSync, onBackfill, onStop }: EmptyStateProps) {
  const mode = isDemoMode() ? 'demo' : 'rayfin';
  // Aktivan korak: posao u toku, inače prvi (baza je prazna dok prvo preuzimanje ne uspe).
  const activeIndex = activity ? STEPS.findIndex((step) => step.kind === activity.kind) : 0;
  return (
    <GlassPanel variant="hero" className="rise-in overflow-hidden" aria-labelledby="empty-title">
      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 lg:p-10">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <LiveDot size={7} color={activity ? 'var(--accent)' : 'var(--faint)'} pulse={activity !== null} />
            Prvo pokretanje
          </p>
          <h2 id="empty-title" className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">
            Baza je još <span className="haze-underline whitespace-nowrap">prazna</span>
          </h2>
          <p className="mt-4 max-w-prose text-[15px] leading-6 text-muted">
            „Vazduh Srbije“ čuva merenja državne mreže SEPA u sopstvenoj SQL bazi u Fabric-u, jer javni API pamti samo
            poslednjih 30 dana. Prvo preuzimanje povlači satne vrednosti za poslednjih 36 sati sa svih aktivnih stanica i
            traje 1–3 minuta.
          </p>
          <SyncActions
            className="mt-6 max-w-xl"
            activity={activity}
            onSync={onSync}
            onBackfill={onBackfill}
            onStop={onStop}
            mode={mode}
            firstRun
            stretch
          />
          <p className="mt-5 max-w-prose border-t border-border pt-4 text-[13px] leading-5 text-muted">
            Podaci SEPA su preliminarni (neverifikovani). Sinhronizacija se kasnije pokreće automatski pri otvaranju
            aplikacije ako su podaci stariji od {STALE_MINUTES} minuta.
          </p>
        </div>

        <ol className="self-center" aria-label="Tri koraka do podataka">
          {STEPS.map((step, index) => {
            const running = activity !== null && step.kind === activity.kind;
            const active = index === activeIndex;
            const last = index === STEPS.length - 1;
            const nodeStyle: CSSProperties = active
              ? {
                  borderColor: 'color-mix(in oklab, var(--accent) 55%, var(--border))',
                  backgroundColor: 'var(--accent-soft)',
                  boxShadow: '0 0 0 4px color-mix(in oklab, var(--accent) 12%, transparent), 0 0 20px -4px var(--accent)',
                }
              : {};
            return (
              <li key={step.title} className={cn('relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4', !last && 'pb-6')}>
                {!last ? <span aria-hidden className="absolute bottom-0 left-[15.5px] top-12 w-px bg-border-strong" /> : null}
                <span
                  aria-hidden
                  className={cn(
                    'relative z-[1] mt-3 grid size-8 place-items-center rounded-full border border-border-strong bg-panel-solid font-mono text-[13px] font-semibold',
                    active ? 'text-accent-soft-ink' : 'text-muted',
                  )}
                  style={nodeStyle}
                >
                  {running ? <LoaderCircle className="spin size-4" /> : index + 1}
                </span>
                <div className={cn('min-w-0 rounded-tile border p-4', active ? 'border-border-strong bg-card-2' : 'border-transparent')}>
                  <p className="flex flex-wrap items-center gap-x-2 font-semibold leading-6 text-ink">
                    <span className="sr-only">Korak {index + 1}: </span>
                    {step.title}
                    {running ? <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-accent">u toku</span> : null}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </GlassPanel>
  );
}
