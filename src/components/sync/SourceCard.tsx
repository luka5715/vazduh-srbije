import { BookOpenText, Boxes, ExternalLink, FlaskConical, Gauge, Globe, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { SectionHeader } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export const SOURCE_LINKS = [
  { href: 'https://vazduh.sepa.gov.rs/', label: 'vazduh.sepa.gov.rs', note: 'Portal SEPA – kvalitet vazduha', icon: Globe },
  { href: 'https://opendata.kosava.cloud/api-docs', label: 'opendata.kosava.cloud/api-docs', note: 'Dokumentacija Kosava API-ja', icon: BookOpenText },
] as const;

function LinkTile({ href, label, note, icon: Icon }: { href: string; label: string; note: string; icon: LucideIcon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 items-center gap-3 rounded-tile border border-border bg-card-2 px-3.5 py-3 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--haze)_50%,var(--border-strong))] hover:shadow-lift"
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent-soft-ink">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-5 text-accent group-hover:underline group-hover:underline-offset-2">{label}</span>
        <span className="block truncate text-[12.5px] leading-5 text-muted">{note}</span>
      </span>
      <ExternalLink aria-hidden className="size-4 shrink-0 text-muted transition-colors group-hover:text-ink" />
      <span className="sr-only"> (otvara se u novom prozoru)</span>
    </a>
  );
}

function Note({ icon: Icon, children, tone = 'muted' }: { icon: LucideIcon; children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <li className={cn('flex gap-2.5 text-[13px] leading-5', tone === 'warn' ? 'text-warn-soft-ink' : 'text-muted')}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone === 'warn' ? 'text-warn' : 'text-faint')} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * „O podacima“: izvor (SEPA preko Kosava Open Data API-ja), oba linka i napomene o poštenju
 * prikaza (nije zvanični indeks, preliminarni podaci, SEPA pragovi, demo). Nosi `id="o-podacima"`
 * – na njega vodi link „O podacima“ iz bočne trake. Kad je rastegnuta na visinu susedne kartice
 * („Kako rade podaci“), napomene stoje na dnu (bez rupe ispod kartice).
 */
export function SourceCard({ mode, className, style }: { mode: 'rayfin' | 'demo'; className?: string; style?: CSSProperties }) {
  return (
    <GlassPanel id="o-podacima" className={cn('flex flex-col p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby="source-title">
      <SectionHeader id="source-title" eyebrow="O podacima" title="Izvor i napomene" />
      <p className="mt-3 text-sm leading-6 text-muted">
        Agencija za zaštitu životne sredine (<span className="text-ink">SEPA</span>), državna mreža automatskog monitoringa
        kvaliteta vazduha, preko <span className="text-ink">Kosava Open Data API</span>-ja.
      </p>
      <div className="mb-5 mt-4 grid gap-2">
        {SOURCE_LINKS.map((link) => (
          <LinkTile key={link.href} {...link} />
        ))}
      </div>
      <ul className="mt-auto flex flex-col gap-2.5 border-t border-border pt-4">
        <Note icon={ShieldAlert}>
          <span className="font-medium text-ink">Aplikacija nije zvanični SEPA indeks.</span>
        </Note>
        <Note icon={FlaskConical}>Podaci su preliminarni (neverifikovani) satni proseci.</Note>
        <Note icon={Gauge}>Kategorije prate SEPA satne pragove indeksa kvaliteta vazduha.</Note>
        {mode === 'demo' ? (
          <Note icon={TriangleAlert} tone="warn">
            Demo režim – prikazane vrednosti su izmišljene.
          </Note>
        ) : (
          <Note icon={Boxes}>Microsoft Fabric App (Rayfin).</Note>
        )}
      </ul>
    </GlassPanel>
  );
}
