import { EmptyState } from '@/components/EmptyState';
import { SyncPanel } from '@/components/SyncPanel';
import { useAtmosfera } from '@/hooks/useAtmosfera';

/**
 * Prvo pokretanje (baza bez ijednog snimka): koraci sa akcijama i dnevnik sinhronizacije.
 * Poseban JS deo – učitava se samo kad je baza prazna.
 */
export function EmptyDatabase() {
  const { mode, data, sync, now } = useAtmosfera();
  return (
    <div className="flex flex-col gap-4">
      <EmptyState activity={sync.activity} onSync={() => void sync.startSync()} onBackfill={() => void sync.startBackfill()} onStop={sync.stopBackfill} />
      <SyncPanel
        runs={data.syncRuns}
        activity={sync.activity}
        outcome={sync.outcome}
        onSync={() => void sync.startSync()}
        onBackfill={() => void sync.startBackfill()}
        onStop={sync.stopBackfill}
        now={now}
        mode={mode}
        defaultOpen={data.syncRuns.length > 0}
      />
    </div>
  );
}
