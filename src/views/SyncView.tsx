import type { CSSProperties } from 'react';

import { LinkNotice } from '@/components/map/LinkNotice';
import { SyncPanel } from '@/components/SyncPanel';
import { DataFlow } from '@/components/sync/DataFlow';
import { SourceCard } from '@/components/sync/SourceCard';
import { SyncHero } from '@/components/sync/SyncHero';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';

// Dnevnik (vremenska linija) je poseban lenji deo; preuzima se odmah sa ovom stranicom.
// Neuspeh ovde je tih – prikaz dnevnika ima svoju granicu greške (SyncPanel).
import('@/components/sync/RunLog').catch(() => undefined);

/** Kratko stepenasto pojavljivanje sekcija (počinje vidljivo, završava se za < 0,6 s). */
function stagger(index: number): { className: string; style: CSSProperties } {
  return { className: 'rise-in', style: { animationDelay: `${index * 60}ms` } };
}

/**
 * Sinhronizacija: heroj sa stanjem podataka, meračem svežine (pravilo 65 min) i velikom
 * dugmadi sa napretkom; dnevnik poslova kao vremenska linija (sa tabelom); „Kako rade
 * podaci“ i izvor sa napomenama (`#o-podacima`), na širokom ekranu u desnoj koloni.
 */
export function SyncView() {
  const { data, sync, now, mode } = useAtmosfera();
  const hero = stagger(0);
  const log = stagger(1);
  const flow = stagger(2);
  const source = stagger(3);
  // Dnevnik stoji pored desne kolone tek kad je bar približno visok kao ona (≈ 7 poslova);
  // kraći dnevnik ide preko cele širine, a „Kako rade podaci“ i izvor ispod njega, jedno pored drugog.
  const wide = data.syncRuns.length >= 7;
  return (
    <div data-testid="view-sinhronizacija" className="flex flex-col gap-4 lg:gap-5">
      <LinkNotice />
      <SyncHero className={hero.className} style={hero.style} />

      <div className={cn('grid items-start gap-4 lg:gap-5', wide && 'xl:grid-cols-[minmax(0,1fr)_minmax(320px,368px)]')}>
        <SyncPanel
          className={log.className}
          style={log.style}
          collapsible={false}
          runs={data.syncRuns}
          activity={sync.activity}
          outcome={sync.outcome}
          onSync={() => void sync.startSync()}
          onBackfill={() => void sync.startBackfill()}
          onStop={sync.stopBackfill}
          now={now}
          mode={mode}
        />
        {/* Dve kartice jedna pored druge su iste visine (items-stretch); u uskoj desnoj koloni
            (xl, dugačak dnevnik) stoje jedna ispod druge prirodne visine. */}
        <div className={cn('grid items-stretch gap-4 md:grid-cols-2 lg:gap-5', wide && 'xl:grid-cols-1 xl:items-start')}>
          <DataFlow className={flow.className} style={flow.style} />
          <SourceCard mode={mode} className={source.className} style={source.style} />
        </div>
      </div>
    </div>
  );
}
