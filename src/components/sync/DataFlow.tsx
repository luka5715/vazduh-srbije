import { CloudDownload, Cpu, Database, MonitorSmartphone, type LucideIcon } from 'lucide-react';
import { Fragment, useRef, type CSSProperties } from 'react';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { SectionHeader } from '@/components/ui/Card';
import { useVisibility } from '@/hooks/useVisibility';
import { cn } from '@/lib/cn';
import { HISTORY_DAYS, STALE_MINUTES } from '@/lib/syncRules';

import { syncWindowText } from './runModel';

import './sync.css';

interface FlowNode {
  icon: LucideIcon;
  title: string;
  /** Mono oznaka (API, ime funkcije …). */
  tag: string;
  text: string;
}

interface FlowStep {
  verb: string;
  text: string;
}

const NODES: FlowNode[] = [
  { icon: CloudDownload, title: 'SEPA', tag: 'Kosava Open Data API', text: `Satni proseci automatskih stanica, preliminarni; izvor čuva ${HISTORY_DAYS} dana.` },
  { icon: Cpu, title: 'Fabric funkcija', tag: 'syncAirQuality · backfillDay', text: 'Radi na serveru, najviše 240 s po pozivu.' },
  { icon: Database, title: 'Baza', tag: 'SQL baza u Fabric-u', text: 'Trajno čuva stanice, snimke stanja i dnevnu statistiku.' },
  { icon: MonitorSmartphone, title: 'Aplikacija', tag: 'Vazduh Srbije', text: 'Čita bazu: pregled, mapa, stanice i trendovi.' },
];

const STEPS: FlowStep[] = [
  { verb: 'Preuzimanje', text: `${syncWindowText(true)} ili jedan ceo dan istorije` },
  { verb: 'Upis', text: 'snimci stanja i dnevna statistika po danu' },
  { verb: 'Čitanje', text: `osvežava se sama kad su podaci stariji od ${STALE_MINUTES} min` },
];

const RULES: Array<{ value: string; text: string }> = [
  { value: `${STALE_MINUTES} min`, text: 'Stariji podaci se pri otvaranju aplikacije osvežavaju sami.' },
  {
    value: 'ceo dan',
    text: 'Dnevna statistika učitanog prošlog dana pokriva ceo dan; današnji dan se dopunjava svakom sinhronizacijom.',
  },
  { value: `${HISTORY_DAYS} dana`, text: 'Koliko izvor pamti: dan koji nedostaje dopunite pre nego što istekne („Dopuni nedostajuće dane“).' },
];

/**
 * „Kako rade podaci“: četiri čvora (SEPA → Fabric funkcija → baza → aplikacija) povezana
 * sa tri numerisana koraka; po vezi putuje „paket“ podataka (uz smanjeno kretanje stoji
 * na sredini veze; van ekrana ili u skrivenoj kartici miruje). Ispod su tri pravila svežine
 * i potpunosti podataka.
 */
export function DataFlow({ className, style }: { className?: string; style?: CSSProperties }) {
  const flowRef = useRef<HTMLOListElement>(null);
  const visible = useVisibility(flowRef, '0px');
  return (
    <GlassPanel className={cn('flex flex-col p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby="flow-title">
      <SectionHeader id="flow-title" eyebrow="Tok podataka · 3 koraka" title="Kako rade podaci" />

      <ol ref={flowRef} className="sync-flow mt-5" data-paused={!visible} aria-label="Od SEPA do aplikacije">
        {NODES.map((node, index) => {
          const Icon = node.icon;
          const step = STEPS[index];
          return (
            <Fragment key={node.title}>
              <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3.5">
                <span
                  aria-hidden
                  className="grid size-10 place-items-center rounded-ctl border text-accent-soft-ink"
                  style={{
                    backgroundColor: 'var(--accent-soft)',
                    borderColor: 'color-mix(in oklab, var(--accent) 30%, var(--border))',
                    boxShadow: '0 6px 18px -10px var(--accent)',
                  }}
                >
                  <Icon className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-heading text-[15px] font-semibold leading-5 text-ink">{node.title}</span>
                    <span className="font-mono text-[12px] leading-5 text-muted sm:text-[11px]">{node.tag}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted">{node.text}</p>
                </div>
              </li>
              {step ? (
                <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3.5">
                  <span aria-hidden className="relative mx-auto my-1.5 w-px min-h-[46px] bg-[repeating-linear-gradient(to_bottom,var(--border-strong)_0_4px,transparent_4px_8px)]">
                    <span className="sync-flow-track" style={{ '--flow-delay': `${index * 0.9}s` } as CSSProperties}>
                      <span className="sync-flow-dot" />
                    </span>
                  </span>
                  <p className="flex items-center gap-2 py-2 text-[12.5px] leading-5 text-muted">
                    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-[12px] font-medium text-ink sm:text-[10.5px]">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="sr-only">Korak {index + 1}: </span>
                      <span className="font-medium text-ink">{step.verb}</span> · {step.text}
                    </span>
                  </p>
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>

      <dl className="mt-6 grid gap-3 border-t border-border pt-5">
        {RULES.map((rule) => (
          <div key={rule.value} className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-x-3">
            <dt className="font-mono text-[12.5px] font-medium uppercase tracking-[0.06em] text-ink">{rule.value}</dt>
            <dd className="text-[13px] leading-5 text-muted">{rule.text}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}
