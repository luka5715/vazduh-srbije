import { CircleAlert, KeyRound, Rocket, TriangleAlert, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';

import { PARAMETERS } from '@shared/aqi';

import { DemoBanner } from '@/components/DemoBanner';
import { Footer } from '@/components/Footer';
import { AuroraBackdrop } from '@/components/fx/AuroraBackdrop';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { BrandMark } from '@/components/shell/BrandMark';
import { Button } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ErrorBanner } from '@/components/ui/Feedback';
import { useAuth } from '@/hooks/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';
import type { AuthConfigState } from '@/services/IAuthService';

const msLogo = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 21 21" aria-hidden>
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

/** Platno čestica je lenji deo paketa (prijava se prikazuje i bez njega). */
const KosavaCanvas = lazy(() => import('@/components/fx/KosavaCanvas').then((module) => ({ default: module.KosavaCanvas })));

function Code({ children }: { children: string }) {
  return <code className="rounded-[6px] border border-border bg-card-2 px-1.5 py-px font-mono text-[12px] text-ink">{children}</code>;
}

/** Komande za terminal: mono blok sa „$“ (prelama se umesto horizontalnog skrola). */
function Commands({ lines }: { lines: string[] }) {
  return (
    <pre className="mt-2.5 whitespace-pre-wrap break-words rounded-ctl border border-border bg-[color-mix(in_oklab,var(--page)_70%,transparent)] px-3 py-2.5 font-mono text-[12px] leading-5 text-ink">
      {lines.map((line, i) => (
        <span key={line} className="block">
          <span aria-hidden className="select-none text-faint">
            ${' '}
          </span>
          {line}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </pre>
  );
}

function NoticeTile({ icon: Icon, title, tone = 'neutral', children }: { icon: LucideIcon; title: string; tone?: 'neutral' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-tile border p-3.5 text-sm leading-6 sm:p-4',
        tone === 'warn' ? 'border-warn/40 bg-warn-soft text-warn-soft-ink' : 'border-border bg-card-2 text-ink',
      )}
    >
      <p className="flex items-center gap-2.5 font-semibold leading-5">
        <span
          aria-hidden
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-ctl',
            tone === 'warn' ? 'bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-warn' : 'bg-accent-soft text-accent-soft-ink',
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {title}
      </p>
      <div className={cn('mt-2', tone === 'warn' ? '' : 'text-muted')}>{children}</div>
    </div>
  );
}

/** Objašnjava zašto prijava (ne) radi za svako stanje konfiguracije. */
function ConfigNotice({ config }: { config: AuthConfigState }) {
  switch (config.kind) {
    case 'not-deployed':
      return (
        <NoticeTile icon={Rocket} title="Aplikacija još nije postavljena u Fabric">
          <p>Fabric koordinate (radni prostor i stavka) nastaju pri prvom postavljanju. U terminalu projekta pokrenite:</p>
          <Commands lines={['npx rayfin login', 'npx rayfin up --workspace "<ime radnog prostora>"']} />
        </NoticeTile>
      );
    case 'incomplete':
      return (
        <NoticeTile icon={KeyRound} title="Nedostaje konfiguracija Rayfin klijenta">
          <p>Nisu pronađene vrednosti:</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {config.missing.map((name) => (
              <Code key={name}>{name}</Code>
            ))}
          </p>
          <p className="mt-2">
            Lokalno: <Code>npx rayfin env --framework vite</Code> upisuje <Code>.env.local</Code>; u Fabric-u ih upakuje{' '}
            <Code>npx rayfin up</Code>.
          </p>
        </NoticeTile>
      );
    case 'config-error':
      return <ErrorBanner title="Konfiguracija se ne može pročitati" message={config.message} />;
    case 'demo':
      return (
        <NoticeTile icon={TriangleAlert} title="Demo režim" tone="warn">
          Bez prijave i bez backenda. Svi podaci su izmišljeni i tako označeni.
        </NoticeTile>
      );
    case 'ready':
      return null;
  }
}

/**
 * Polje čestica Košave iza kartice kao MIRAN kadar (`still`): tok se odsimulira jednom,
 * bez animacione petlje – prijava ne troši bateriju. Uz smanjeno kretanje platno crta
 * statične strujnice. Platno se učitava lenjo, van glavnog dela paketa.
 */
function StaticParticles({ theme }: { theme: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Ukras: ako deo sa platnom ne stigne, prijava radi i bez njega. */}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <KosavaCanvas intensity={0.5} colorKey={theme} still />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function AuthPage() {
  const { signIn, mode, config, canSignIn, error: sessionError } = useAuth();
  const { theme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fabric prijava otvara broker prozor – MORA ići direktno iz klika.
  const handleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prijava nije uspela.');
    } finally {
      setIsLoading(false);
    }
  };

  const buttonLabel = isLoading
    ? mode === 'rayfin'
      ? 'Otvaram Fabric prijavu…'
      : 'Ulazim…'
    : mode === 'rayfin'
      ? 'Prijavite se Microsoft nalogom'
      : 'Otvori demo';

  return (
    <div className="haze-scope relative flex min-h-dvh flex-col text-ink" data-auth-config={config.kind}>
      <AuroraBackdrop />
      {mode === 'demo' ? (
        <div className="relative z-10">
          <DemoBanner />
        </div>
      ) : null}

      <main className="relative z-[1] flex flex-1 flex-col items-center justify-center px-safe-4 py-10 sm:py-16">
        {/* Pri promeni teme polje se ponovo crta (`colorKey`): boja čestica prati `--haze` teme. */}
        <StaticParticles theme={theme} />

        <div className="relative w-full max-w-[452px]">
          <GlassPanel variant="hero" as="section" className="overflow-hidden p-6 sm:p-8" aria-labelledby="auth-title">
            <div className="flex items-center gap-3.5">
              <BrandMark size={44} />
              <div className="min-w-0">
                <h1 id="auth-title" className="text-[22px] font-semibold leading-7 text-ink">
                  Vazduh Srbije
                </h1>
                <p className="eyebrow">SEPA · kvalitet vazduha</p>
              </div>
            </div>

            <p className="mt-7 font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[30px]">
              Vazduh nad Srbijom, <span className="haze-underline whitespace-nowrap">sat po sat</span>.
            </p>
            <p className="mt-3 text-[14.5px] leading-6 text-muted">
              Trenutno stanje i 30-dnevna istorija kvaliteta vazduha sa automatskih stanica Agencije za zaštitu životne
              sredine, kao Microsoft Fabric aplikacija.
              {mode === 'rayfin' ? ' Prijavite se nalogom koji ima pristup Fabric stavci.' : null}
            </p>

            <ul aria-label="Šta aplikacija prikazuje" className="mt-4 flex flex-wrap gap-1.5">
              {['satni proseci', `${PARAMETERS.length} polutanata`, '30 dana istorije'].map((fact) => (
                <li
                  key={fact}
                  className="inline-flex h-7 items-center rounded-full border border-border bg-card-2 px-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted"
                >
                  {fact}
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-col gap-3">
              <ConfigNotice config={config} />
              {canSignIn ? (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleSignIn}
                  loading={isLoading}
                  icon={mode === 'rayfin' ? <span className="grid size-6 place-items-center rounded-[6px] bg-panel-solid">{msLogo}</span> : undefined}
                  className="w-full"
                >
                  {buttonLabel}
                </Button>
              ) : null}
              {error ? <ErrorBanner title="Prijava nije uspela" message={error} /> : null}
              {!error && sessionError ? <ErrorBanner title="Sesija nije razrešena" message={sessionError} /> : null}
              {!canSignIn && config.kind !== 'config-error' ? (
                <p className="flex items-start gap-2 text-[13px] leading-5 text-muted">
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Prijava će biti dostupna kada se konfiguracija dopuni.
                </p>
              ) : null}
            </div>
          </GlassPanel>

          <Footer mode={mode} className="mt-6 px-2" />
        </div>
      </main>
    </div>
  );
}

