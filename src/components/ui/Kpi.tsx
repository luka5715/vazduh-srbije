import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { CountUp } from '@/components/fx/CountUp';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

/**
 * Delovi KPI pločice (ugovor „stat tile“): natpis · vrednost · promena · trend.
 *
 *   <KpiTile label="Medijana PM10" aside={<CategoryChip … />}>
 *     <KpiValue value={38} unit="µg/m³" />
 *     <KpiDelta delta={-4} unit="µg/m³" worseWhen="up" suffix="nego pre 24 h" />
 *     <Sparkline … />
 *   </KpiTile>
 */

export interface KpiTileProps {
  /** Natpis (rečenični oblik, bez dvotačke) – prikazuje se kao mono „eyebrow“. */
  label: string;
  /** Sadržaj desno od natpisa (čip kategorije, prsten, ikona). */
  aside?: ReactNode;
  /** Klik otvara detalje (cela pločica postaje dugme sa podizanjem na hover). */
  onClick?: () => void;
  /**
   * Dodatak za čitače ekrana na kraju klikabilne pločice (npr. „Prikaži na mapi.“). Naziv
   * dugmeta je vidljivi sadržaj pločice + ovaj dodatak (vidljivi tekst je uvek deo naziva).
   */
  actionLabel?: string;
  /** Dodatna linija na dnu (npr. „4 bez svežih podataka“). */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** KPI pločica: staklo `tile` (radijus 14 px), natpis gore, sadržaj, opcioni podnožak. */
export function KpiTile({ label, aside, onClick, actionLabel, footer, children, className }: KpiTileProps) {
  const body = (
    <>
      {/* Natpis se ne lomi usred reči: kad nema mesta, dodatak (`aside`) prelazi u sledeći red.
          Najmanja visina = najveći dodatak (prsten 42/50 px + razmak), pa glavne vrednosti svih
          pločica u redu počinju na istoj visini. */}
      <div className="flex min-h-11 flex-wrap items-start justify-between gap-x-3 gap-y-2 sm:min-h-[50px]">
        <p className="eyebrow flex max-w-full grow basis-[min-content] items-start gap-1">
          <span>{label}</span>
          {onClick ? <ChevronRight aria-hidden className="mt-px size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" /> : null}
        </p>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children}
      {footer ? <div className="mt-auto text-[13px] leading-5 text-muted">{footer}</div> : null}
      {onClick && actionLabel ? <span className="sr-only"> {actionLabel}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <GlassPanel
        as="button"
        variant="tile"
        interactive
        onClick={onClick}
        className={cn('group flex h-full flex-col gap-2.5 p-4 text-left', className)}
      >
        {body}
      </GlassPanel>
    );
  }
  return (
    <GlassPanel as="div" variant="tile" className={cn('flex h-full flex-col gap-2.5 p-4', className)}>
      {body}
    </GlassPanel>
  );
}

export interface KpiValueProps {
  value: number | null;
  /** Jedinica (npr. „µg/m³“) – manja, prigušena, uz broj. */
  unit?: string;
  /** Formatiranje (podrazumevano bez decimala). */
  format?: (value: number) => string;
  /**
   * Animirana promena vrednosti pri osvežavanju (≤ 0,5 s; podrazumevano da). Prvi prikaz je
   * uvek konačna vrednost – nema odbrojavanja od nule (vidi `CountUp`).
   */
  animate?: boolean;
  /** Veličina: `md` 32 px (pločica), `lg` 48 px (heroj). */
  size?: 'md' | 'lg';
  className?: string;
}

/** Velika vrednost pločice (Sora, proporcionalne cifre); promene se animiraju, prvi prikaz je statičan. */
export function KpiValue({ value, unit, format = (v) => formatNumber(v, 0), animate = true, size = 'md', className }: KpiValueProps) {
  return (
    <p className={cn('flex items-baseline gap-1.5 font-heading font-semibold leading-none text-ink', size === 'lg' ? 'text-5xl' : 'text-[32px]', className)}>
      {animate ? <CountUp value={value} format={format} /> : <span>{value === null ? '–' : format(value)}</span>}
      {unit && value !== null ? <span className="font-mono text-xs font-normal tracking-normal text-faint">{unit}</span> : null}
    </p>
  );
}

export interface KpiDeltaProps {
  /** Promena (sada − ranije); null = nema poređenja (ne prikazuje se ništa). */
  delta: number | null;
  /** Koji smer je loš: za zagađenje `up` (porast = gore). */
  worseWhen?: 'up' | 'down';
  unit?: string;
  /** Završetak rečenice, npr. „nego pre 24 h“ ili „od proseka 24 h“. */
  suffix?: string;
  /** Promena manja od ovoga je „bez promene“ (podrazumevano 1). */
  flatThreshold?: number;
  format?: (value: number) => string;
  className?: string;
}

/**
 * Promena sa strelicom i rečima („↑ 4 µg/m³ više nego pre 24 h“). Boje SEPA kategorija su
 * rezervisane za kategorije, pa promena NIJE obojena (crveno/zeleno bi se čitalo kao „Veoma
 * zagađen“/„Dobar“): smer nose strelica i reči, a pogoršanje je podebljano u ink boji.
 */
export function KpiDelta({ delta, worseWhen = 'up', unit, suffix, flatThreshold = 1, format = (v) => formatNumber(v, 0), className }: KpiDeltaProps) {
  if (delta === null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < flatThreshold;
  const up = delta > 0;
  const worse = !flat && (worseWhen === 'up' ? up : !up);
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  const words = flat ? 'bez promene' : up ? 'više' : 'manje';
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1 text-[13px] leading-5 text-muted', className)}>
      <span className={cn('inline-flex items-center gap-0.5', flat ? 'font-medium text-muted' : worse ? 'font-semibold text-ink' : 'font-medium text-muted')}>
        <Icon aria-hidden className="size-3.5" />
        {flat ? null : (
          <span className="tnum">
            {format(Math.abs(delta))}
            {unit ? ` ${unit}` : ''}
          </span>
        )}
      </span>
      <span className={worse ? 'font-semibold text-ink' : undefined}>
        {words}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </p>
  );
}
