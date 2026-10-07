import type { HTMLAttributes, ReactNode } from 'react';

import { GlassPanel, type GlassVariant } from '@/components/fx/GlassPanel';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Varijanta stakla (podrazumevano `panel`); vidi `GlassPanel`. */
  variant?: GlassVariant;
}

/**
 * Kartica = tanak omotač oko `GlassPanel` (`<section>`), da postojeće komponente rade
 * bez izmena. Novi kod neka koristi `GlassPanel` direktno.
 */
export function Card({ className, children, variant = 'panel', ...rest }: CardProps) {
  return (
    <GlassPanel as="section" variant={variant} {...rest} className={className}>
      {children}
    </GlassPanel>
  );
}

export interface SectionHeaderProps {
  title: string;
  /** Mala pomoćna linija ispod naslova. */
  hint?: ReactNode;
  /** Kontrole desno od naslova (dugmad, pretraga). */
  actions?: ReactNode;
  id?: string;
  as?: 'h2' | 'h3';
  /** Mono natpis iznad naslova (velika slova), npr. „24 h“ ili „PM10“. */
  eyebrow?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, hint, actions, id, as = 'h2', eyebrow, className }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <Heading id={id} className={cn('font-semibold leading-6 text-ink', as === 'h2' ? 'text-base' : 'text-[15px]')}>
          {title}
        </Heading>
        {hint ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
