import { RefreshCw } from 'lucide-react';
import type { Ref } from 'react';

import { LiveDot } from '@/components/fx/LiveDot';
import { Button } from '@/components/ui/Button';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatDateTime, formatInt, stationsNoun } from '@/lib/format';
import { liveStatus } from '@/lib/stations';
import { VIEW_META } from '@/lib/views';

import { BrandMark } from './BrandMark';
import { LensPicker } from './LensPicker';
import { OkrugChip, OkrugSheetButton } from './OkrugFilter';
import { SearchButton, ThemeToggle, UserMenu } from './ShellControls';
import { useSourceState } from './useNavBadges';

/**
 * Dugme „Osveži“ – sinhronizacija sa SEPA (onemogućeno dok traje istorija). Ne pokreće drugi
 * posao dok druga sesija sinhronizuje, a posle sinhronizacije mlađe od 15 min samo ponovo čita
 * bazu (vidi `refresh` u useAtmosfera); „Osveži sada“ na stranici Sinhronizacija uvek radi.
 */
export function RefreshButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { sync, refresh } = useAtmosfera();
  const refreshing = sync.activity?.kind === 'sync';
  return (
    <Button
      variant="secondary"
      size="md"
      onClick={refresh}
      loading={refreshing}
      disabled={sync.activity?.kind === 'backfill'}
      icon={<RefreshCw aria-hidden />}
      aria-label={refreshing ? 'Osvežavanje u toku' : 'Osveži podatke sa SEPA'}
      title="SEPA objavljuje nova merenja jednom na sat"
      className={cn(compact ? 'w-10 px-0' : 'px-3.5', className)}
    >
      {compact ? null : <span>{refreshing ? 'Osvežavam…' : 'Osveži'}</span>}
    </Button>
  );
}

/**
 * Čip najnovijeg sata mreže: „Uživo · 16–17 h · pre 1 h“ (pulsira) samo dok se najnoviji
 * interval završio pre najviše 3 h (`liveStatus`); inače neutralno „Poslednji sat 06. 10.
 * 16–17 h · pre 9 h“. Sat uvek nosi starost, a datum kad nije današnji.
 */
function LiveStatusChip({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { newestObservedAt, networkKpis, now } = useAtmosfera();
  const status = liveStatus(newestObservedAt, now);
  const title = newestObservedAt
    ? `Najnoviji sat u bazi počinje ${formatDateTime(newestObservedAt)} · sveže ${formatInt(networkKpis.reporting)} od ${formatInt(networkKpis.total)} ${stationsNoun(networkKpis.total)}`
    : undefined;
  return (
    <span
      className={cn(
        'inline-flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-full border border-border-strong bg-panel px-3 text-[12px] text-muted',
        className,
      )}
      title={title}
    >
      <LiveDot color={status.live ? 'var(--ok)' : 'var(--faint)'} pulse={status.live} />
      {newestObservedAt ? (
        <span className="truncate whitespace-nowrap">
          {status.live ? (
            <span className="font-medium text-ink">Uživo</span>
          ) : (
            <span className="font-medium text-ink">{compact ? 'Poslednji' : 'Poslednji sat'}</span>
          )}
          <span> · </span>
          {status.live && !compact ? <span className="hidden xl:inline">najnoviji sat </span> : null}
          <span className="tnum font-medium text-ink">{status.label}</span>
          <span className="tnum"> · {status.ageText}</span>
        </span>
      ) : (
        <span className="whitespace-nowrap">Nema merenja u bazi</span>
      )}
    </span>
  );
}

/**
 * Gornja traka desktopa (lepljiva, staklo): naslov i opis stranice, čip „Uživo“, aktivni
 * filter okruga, pretraga (Ctrl K) i osvežavanje.
 */
export function TopBar({ className, ref }: { className?: string; ref?: Ref<HTMLElement> }) {
  const { view } = useAtmosfera();
  const meta = VIEW_META[view];
  return (
    <header ref={ref} className={cn('shell-bar vt-topbar z-30 border-b border-border', className)}>
      <div className="mx-auto flex h-16 w-full max-w-[1360px] items-center gap-4 px-6 xl:px-8">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-xl font-semibold leading-7 text-ink">{meta.title}</h1>
            <OkrugChip className="h-6 max-w-[220px] text-xs" />
          </div>
          <p className="truncate text-[13px] leading-5 text-muted">{meta.description}</p>
        </div>
        <LiveStatusChip />
        <SearchButton className="w-[200px] xl:w-[260px]" />
        <RefreshButton />
      </div>
    </header>
  );
}

/**
 * Kompaktna gornja traka telefona (< 1024 px): znak, tačka „uživo“, pretraga, filter okruga,
 * tema i korisnik; ispod nje red čipova sočiva sa horizontalnim skrolom. Vodoravni razmaci
 * poštuju zarez položenog telefona (`px-safe-*`).
 */
export function MobileTopBar({ className, ref }: { className?: string; ref?: Ref<HTMLElement> }) {
  const { mode, view } = useAtmosfera();
  const source = useSourceState();
  return (
    <header ref={ref} className={cn('shell-bar vt-mtopbar z-30 border-b border-border', className)}>
      <div className="flex h-14 items-center gap-1 pl-[max(16px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))]">
        <BrandMark size={32} />
        <div className="ml-2 min-w-0 flex-1">
          <p className="truncate font-heading text-[15px] font-semibold leading-5 text-ink">Vazduh Srbije</p>
          {/* Oznaka „demo“ je u redu stanja (kao u bočnoj traci), van skraćivanja naslova – ne
              seče se. Ispod 375 px za nju nema mesta; demo traka iznad već kaže DEMO. */}
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="eyebrow truncate !leading-3 !tracking-[0.06em]">SEPA · {source.text}</span>
            {mode === 'demo' ? (
              <span className="shrink-0 rounded-full bg-warn-soft px-1.5 font-mono text-[11px] font-medium uppercase leading-3.5 tracking-wider text-warn-soft-ink max-[374px]:hidden">
                demo
              </span>
            ) : null}
          </p>
        </div>
        <SearchButton compact />
        <OkrugSheetButton />
        <ThemeToggle />
        <UserMenu />
      </div>
      {/* Sinhronizacija ne zavisi od sočiva – red čipova se tamo ne prikazuje. */}
      {view !== 'sinhronizacija' ? (
        <div className="pb-2 short:pb-1.5">
          <LensPicker layout="scroll" className="px-safe-4" />
        </div>
      ) : null}
    </header>
  );
}

/**
 * Naslov stranice na telefonu (na desktopu je u gornjoj traci). Ispod `sm` bez opisa (gornja
 * traka i stranica same govore šta je gde), a čip „Uživo“ i aktivni okrug stoje u redu naslova
 * – prvi ekran telefona ostaje za podatke.
 */
export function PageIntro({ className }: { className?: string }) {
  const { view } = useAtmosfera();
  const meta = VIEW_META[view];
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h1 className="text-[22px] font-semibold leading-9 text-ink">{meta.title}</h1>
          <LiveStatusChip compact className="max-w-full" />
          <OkrugChip className="min-w-0" />
        </div>
        <RefreshButton compact />
      </div>
      <p className="hidden text-[13px] leading-5 text-muted sm:block">{meta.description}</p>
    </div>
  );
}
