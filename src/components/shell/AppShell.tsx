import { lazy, Suspense, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

import { DemoBanner } from '@/components/DemoBanner';
import { Footer } from '@/components/Footer';
import { SyncToast } from '@/components/SyncToast';
import { AuroraBackdrop } from '@/components/fx/AuroraBackdrop';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { Shimmer } from '@/components/fx/Shimmer';
import { useHeroProgressVisible } from '@/components/sync/heroProgress';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ErrorBanner } from '@/components/ui/Feedback';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import type { SyncActivity, SyncOutcome } from '@/hooks/useSync';
import { useMeasure } from '@/hooks/useMeasure';
import { cn } from '@/lib/cn';
import { formatTimeSince } from '@/lib/format';
import { canViewTransition } from '@/lib/motion';
import { reloadPage } from '@/lib/reload';
import { preloadOtherViews, useViewModule } from '@/views';

import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { MobileTopBar, PageIntro, TopBar } from './TopBars';

// Retko potrebni delovi su posebni JS delovi (glavni paket ostaje u budžetu): paleta se
// preuzima odmah posle prvog prikaza, prazan ekran samo kad je baza prazna.
const CommandPalette = lazy(() => import('./CommandPalette').then((module) => ({ default: module.CommandPalette })));
const EmptyDatabase = lazy(() => import('./EmptyDatabase').then((module) => ({ default: module.EmptyDatabase })));

/** Da li je fokus u polju za unos (tada „/“ piše, a ne otvara paletu). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Tekst za čitače ekrana o sinhronizaciji: menja se SAMO kad posao počne ili se završi
 * (ne svakog minuta kao „Osveženo pre …“, ni svakog dana istorije).
 */
function syncAnnouncement(activity: SyncActivity | null, outcome: SyncOutcome | null): string {
  if (activity) return activity.kind === 'sync' ? 'Osvežavanje u toku' : 'Dopunjavanje istorije u toku';
  if (!outcome) return '';
  // Delimičan ishod, obaveštenje i greška se najavljuju naslovom (npr. „Osveženo delimično: 41 od 60 stanica“).
  if (outcome.tone !== 'ok') return outcome.title;
  return outcome.kind === 'sync' ? 'Osvežavanje završeno' : 'Dopunjavanje istorije završeno';
}

/** Skelet stranice dok se podaci prvi put učitavaju (oblik heroja, pločica i panela). */
function ShellSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-5" aria-busy="true" aria-label="Učitavanje podataka">
      <GlassPanel variant="panel" className="flex min-h-[220px] flex-col gap-4 p-6" spotlight={false}>
        <Shimmer className="h-3 w-48" />
        <Shimmer className="h-10 w-2/3 max-w-md" />
        <Shimmer className="h-4 w-1/2 max-w-sm" />
      </GlassPanel>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <GlassPanel key={i} variant="tile" as="div" className="flex flex-col gap-3 p-4">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="h-8 w-20" />
            <Shimmer className="h-10" />
          </GlassPanel>
        ))}
      </div>
      <GlassPanel className="flex flex-col gap-3 p-5" spotlight={false}>
        <Shimmer className="h-4 w-40" />
        <Shimmer className="h-[220px]" rounded="tile" />
      </GlassPanel>
    </div>
  );
}

/**
 * Ljuska aplikacije „Atmosfera“: aurora u boji izmaglice, bočna traka (≥ 1024 px) ili
 * gornja traka + donja navigacija (telefon), demo traka na vrhu, stranica iz `?view=`,
 * podnožje sa izvorom, paleta komandi (Ctrl/⌘K, „/“) i obaveštenja o sinhronizaciji.
 * Koren nosi `data-ready` (skripta za snimke čeka na njega), `--haze` i visine traka.
 */
export function AppShell() {
  const { mode, data, sync, isEmpty, view, hazeColor, hazeRank, paletteOpen, openPalette, closePalette, now } = useAtmosfera();
  const mainRef = useRef<HTMLElement>(null);
  const [bannerRef, bannerSize] = useMeasure<HTMLDivElement>();
  const [topBarRef, topBarSize] = useMeasure<HTMLElement>();
  const [mobileBarRef, mobileBarSize] = useMeasure<HTMLElement>();
  const transitions = useRef(canViewTransition()).current;
  const page = useViewModule(view);
  const heroProgressVisible = useHeroProgressVisible();

  // Ostale stranice se preuzimaju kad je pregledač besposlen – prelaz među njima je trenutan.
  useEffect(() => preloadOtherViews(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !paletteOpen) {
        event.preventDefault();
        openPalette();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, openPalette, closePalette]);

  // Visine traka za lepljive elemente stranica (`--shell-sticky-top` u main.css). Skrivena
  // traka (display: none) meri 0 px i tada ostaje vrednost iz CSS-a.
  const style = {
    '--haze': hazeColor,
    '--banner-h': `${Math.round(bannerSize.height)}px`,
    ...(topBarSize.height ? { '--topbar-h': `${Math.round(topBarSize.height)}px` } : null),
    ...(mobileBarSize.height ? { '--mobilebar-h': `${Math.round(mobileBarSize.height)}px` } : null),
  } as CSSProperties;

  let content: ReactNode;
  if (data.status === 'loading') content = <ShellSkeleton />;
  else if (data.status === 'error')
    content = <ErrorBanner title="Podaci nisu učitani" message={data.error ?? 'Nepoznata greška'} onRetry={() => void data.reload()} />;
  else if (isEmpty && view !== 'sinhronizacija')
    content = (
      <ErrorBoundary
        fallback={<ErrorBanner title="Ekran nije učitan" message="Proverite vezu sa mrežom i pokušajte ponovo (stranica će se ponovo učitati)." onRetry={reloadPage} />}
      >
        <Suspense fallback={<ShellSkeleton />}>
          <EmptyDatabase />
        </Suspense>
      </ErrorBoundary>
    );
  else if (page.error)
    content = <ErrorBanner title="Stranica nije učitana." message="Pokušajte ponovo (stranica će se ponovo učitati)." onRetry={page.retry} />;
  else if (!page.Component) content = <ShellSkeleton />;
  else
    content = (
      // Greška pri prikazu jedne stranice ostaje u njoj: ljuska i navigacija rade dalje.
      <ErrorBoundary
        resetKeys={[view]}
        fallback={(reset) => (
          <ErrorBanner
            title="Stranica nije prikazana"
            message="Došlo je do greške pri prikazu ove stranice. Pokušajte ponovo ili izaberite drugu stranicu."
            onRetry={reset}
          />
        )}
      >
        <page.Component />
      </ErrorBoundary>
    );

  // Napredak posla je već u heroju Sinhronizacije (dok je on na ekranu) i na praznom ekranu.
  const hideActivity = isEmpty || (view === 'sinhronizacija' && heroProgressVisible);
  const announcement = syncAnnouncement(sync.activity, sync.outcome);

  return (
    <div
      className="haze-scope shell-root relative min-h-dvh text-ink"
      style={style}
      data-ready={data.status !== 'loading'}
      data-mode={mode}
      data-haze={hazeRank ?? 'none'}
      data-view={view}
    >
      <AuroraBackdrop />

      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="sr-only z-[60] rounded-ctl bg-accent px-3 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:px-3 focus:py-2"
      >
        Preskoči na sadržaj
      </button>

      {/* Jedno mesto za najavu sinhronizacije (vidi `syncAnnouncement`). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className="relative z-[1] flex min-h-dvh flex-col">
        {mode === 'demo' ? (
          <div ref={bannerRef} className="relative z-40 lg:sticky lg:top-0">
            <DemoBanner />
          </div>
        ) : null}

        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
          <Sidebar className="hidden lg:sticky lg:top-[var(--banner-h)] lg:z-20 lg:flex lg:h-[calc(100dvh-var(--banner-h))]" />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar ref={topBarRef} className="sticky top-[var(--banner-h)] hidden lg:block" />
            {/* Položen telefon (`short`): traka se skroluje sa sadržajem – ekran je nizak. */}
            <MobileTopBar ref={mobileBarRef} className="sticky top-0 short:static lg:hidden" />

            <main
              id="main"
              ref={mainRef}
              tabIndex={-1}
              className="mx-auto w-full max-w-[1360px] flex-1 px-safe-4 pb-8 pt-4 focus:outline-none sm:px-safe-6 lg:pb-10 lg:pt-6 xl:px-safe-8"
            >
              <PageIntro className="mb-4 lg:hidden" />
              {data.error && data.status === 'ready' ? (
                <ErrorBanner
                  className="mb-4"
                  title={
                    data.loadedAt
                      ? `Osvežavanje nije uspelo – prikazani su podaci od ${formatTimeSince(data.loadedAt, now)}`
                      : 'Osvežavanje nije uspelo'
                  }
                  message={data.error}
                  onRetry={() => void data.reload()}
                />
              ) : null}
              <div key={view} className={cn('vt-page', !transitions && 'page-enter', data.refreshing && 'opacity-70 transition-opacity')}>
                {content}
              </div>
            </main>

            <Footer mode={mode} variant="shell" className="pb-safe-nav lg:pb-0" />
          </div>
        </div>
      </div>

      <BottomNav className="lg:hidden" />
      {/* Paleta je dodatak: ako njen deo ne stigne (mreža, novo postavljanje), aplikacija radi bez nje. */}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      </ErrorBoundary>

      <SyncToast
        activity={sync.activity}
        outcome={sync.outcome}
        onDismiss={sync.dismissOutcome}
        onStop={sync.stopBackfill}
        hideActivity={hideActivity}
      />
    </div>
  );
}
