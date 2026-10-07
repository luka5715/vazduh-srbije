import { ExternalLink } from 'lucide-react';

import { HowToReadButton } from '@/components/HowToRead';
import { cn } from '@/lib/cn';

function OutLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only"> (otvara se u novom prozoru)</span>
    </a>
  );
}

export interface FooterProps {
  mode: 'rayfin' | 'demo';
  /**
   * `shell`: podnožje svake stranice u ljusci (levo poravnato, puna širina sa linijom);
   * `standalone`: centriran blok ispod kartice na samostalnim ekranima (prijava).
   */
  variant?: 'shell' | 'standalone';
  className?: string;
}

/**
 * Pripisivanje izvora – jedini izvor ovog teksta u aplikaciji: SEPA / Kosava, oba linka,
 * napomena da aplikacija nije zvanični SEPA indeks i da su podaci preliminarni, i „Kako čitati
 * podatke“ (pragovi, svežina, pravilo najlošijeg polutanta – `HowToReadButton`).
 */
export function Footer({ mode, variant = 'standalone', className }: FooterProps) {
  const shell = variant === 'shell';
  const body = (
    <>
      <p>
        Izvor: Agencija za zaštitu životne sredine (SEPA), Kosava Open Data API
        <span className={shell ? undefined : 'hidden sm:inline'}> · Pragovi: SEPA indeks kvaliteta vazduha</span>.
      </p>
      <p className={cn('flex flex-wrap gap-x-4 gap-y-1', !shell && 'justify-center')}>
        <HowToReadButton variant="link" />
        <OutLink href="https://vazduh.sepa.gov.rs/">vazduh.sepa.gov.rs</OutLink>
        <OutLink href="https://opendata.kosava.cloud/api-docs">opendata.kosava.cloud/api-docs</OutLink>
      </p>
      <p className={shell ? 'text-faint' : undefined}>
        Aplikacija nije zvanični SEPA indeks. Podaci su preliminarni (neverifikovani) satni proseci.
        {mode === 'demo' ? ' Demo režim – prikazane vrednosti su izmišljene.' : ' Microsoft Fabric App (Rayfin).'}
      </p>
    </>
  );

  if (shell) {
    return (
      <footer className={cn('border-t border-border', className)}>
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-2 px-safe-4 py-6 text-[13px] leading-5 text-muted sm:px-safe-6 xl:px-safe-8">{body}</div>
      </footer>
    );
  }
  return <footer className={cn('flex flex-col gap-1.5 text-center text-[12.5px] leading-5 text-muted', className)}>{body}</footer>;
}
