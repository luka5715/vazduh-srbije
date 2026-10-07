import { Clock, MapPinned, PowerOff } from 'lucide-react';

import { classify, PARAMETER_LABELS, UNIT, type Parameter } from '@shared/aqi';

import { Sparkline } from '@/components/fx/Sparkline';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { catMarkVar } from '@/components/charts/marks';
import { categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatDateTime, formatHourInterval } from '@/lib/format';

import { bandLimits, deltaText, formatLastSeen, formatValue, isStaleGroup, LAG_NOTE_HOURS, okrugShort, scalePosition, type StationRow } from './stationRows';

/**
 * Traka u koloni sočiva: položaj vrednosti na SEPA skali polutanta (pojasevi iste širine),
 * tanke crtice na granicama kategorija. Dekorativna – vrednost i kategorija su u tekstu pored.
 */
export function LensBar({
  parameter,
  value,
  rank,
  bands,
  muted = false,
  delay = 0,
  className,
}: {
  parameter: Parameter;
  value: number;
  rank: number | null;
  bands: number;
  muted?: boolean;
  /** Kašnjenje animacije punjenja (ms) – blagi talas niz listu. */
  delay?: number;
  className?: string;
}) {
  const { position, overflow } = scalePosition(parameter, value, bands);
  // Traka od 6 px je tanka oznaka: u svetloj temi tamnija varijanta boje kategorije (`--cat-mark-N`).
  const color = muted || rank === null ? 'var(--faint)' : catMarkVar(rank);
  const limits = bandLimits(parameter, bands);
  return (
    <span
      aria-hidden
      data-mark
      className={cn('st-bar relative block h-1.5', className)}
      title={`Granice kategorija ${PARAMETER_LABELS[parameter]}: ${limits.join(' / ')} ${UNIT}`}
    >
      <span className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]" />
      <span
        className={cn('st-bar__fill absolute inset-y-0 left-0 rounded-full', muted && 'opacity-60')}
        style={{
          width: `${Math.max(3, position * 100).toFixed(2)}%`,
          backgroundColor: color,
          boxShadow: muted ? undefined : `0 0 10px -2px color-mix(in oklab, ${color} calc(var(--glow-strength) * 150%), transparent)`,
          animationDelay: `${delay}ms`,
        }}
      />
      {limits.map((_, i) => (
        <span
          key={i}
          className="absolute -inset-y-[3px] w-px bg-[color-mix(in_oklab,var(--ink)_30%,transparent)]"
          style={{ left: `${(((i + 1) / bands) * 100).toFixed(2)}%` }}
        />
      ))}
      {overflow ? <span className="absolute -right-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-ink" /> : null}
    </span>
  );
}

/**
 * Čip reda: SEPA kategorija kroz sočivo, „Bez svežih podataka“, a za stanicu koju je SEPA
 * ugasila „Neaktivna“ (stara vrednost ostaje siva, bez kategorije).
 */
export function RowChip({ row, className }: { row: StationRow; className?: string }) {
  if (row.group === 'inactive') {
    return (
      <span
        title="SEPA je stanicu označila kao neaktivnu: ne broji se u mrežu, a njena istorija ostaje u Trendovima."
        className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border-strong px-1.5 text-[11px] font-medium text-muted', className)}
      >
        <PowerOff aria-hidden className="size-3" />
        Neaktivna
      </span>
    );
  }
  return <CategoryChip category={row.reading.category} stale={isStaleGroup(row.group)} size="sm" className={className} />;
}

/** Vrednost sočiva: broj (Sora) + oznaka polutanta (mono). */
export function LensValue({ row, size = 'md' }: { row: StationRow; size?: 'md' | 'lg' }) {
  const { reading } = row;
  if (reading.value === null || reading.parameter === null) {
    return <span className="text-[13px] text-faint">{isStaleGroup(row.group) ? 'Nema merenja' : 'Ne meri se'}</span>;
  }
  const stale = isStaleGroup(row.group);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={cn('font-heading font-semibold leading-none', size === 'lg' ? 'text-[22px]' : 'text-[17px]', stale ? 'text-muted' : 'text-ink')}>
        {formatValue(reading.value)}
      </span>
      <span className="unit-label text-faint">
        {PARAMETER_LABELS[reading.parameter]}
        {size === 'lg' ? <span className="normal-case"> · {UNIT}</span> : null}
      </span>
    </span>
  );
}

/** Promena prema sopstvenom proseku 24 h: strelica i iznos (rast je lošiji – podebljan) + reči. */
export function DeltaInline({ row, layout = 'stack', className }: { row: StationRow; layout?: 'stack' | 'inline'; className?: string }) {
  if (!row.delta) {
    if (isStaleGroup(row.group)) return layout === 'inline' ? null : <span className={cn('text-xs text-faint', className)}>–</span>;
    return <span className={cn('text-xs text-faint', className)}>bez proseka 24 h</span>;
  }
  const text = deltaText(row.delta);
  // Bez boja kategorija (crveno/zeleno bi se čitalo kao „Veoma zagađen“/„Dobar“): smer nose
  // strelica i reči, rast je podebljan u ink boji.
  const tone = text.direction === 'up' ? 'font-semibold text-ink' : 'font-medium text-muted';
  const words = layout === 'inline' ? `${text.words} 24 h` : text.words;
  return (
    <span className={cn(layout === 'stack' ? 'flex flex-col leading-4' : 'inline-flex items-baseline gap-1.5 whitespace-nowrap', 'text-xs', className)}>
      <span className={cn('tnum whitespace-nowrap', tone)}>
        {text.arrow}
        {text.amount ? ` ${text.amount}` : ''}
        <span className="sr-only">{text.amount ? ` ${UNIT}` : ''}</span>
      </span>
      <span className="whitespace-nowrap text-muted">{words}</span>
    </span>
  );
}

/**
 * Mini grafikon poslednja 24 h polutanta sočiva sa tankom linijom proseka. Dekorativan
 * (aria-hidden): isti podatak je u tekstu promene pored njega.
 */
export function TrendSpark({ row, height = 26, className }: { row: StationRow; height?: number; className?: string }) {
  if (!row.series) return <span aria-hidden className={cn('block', className)} style={{ height }} />;
  return (
    <div aria-hidden className={cn('st-spark', className)}>
      <Sparkline
        values={row.series}
        label=""
        height={height}
        color="var(--st-spark, var(--muted))"
        fill
        endDot
        reference={row.delta?.avg24}
      />
    </div>
  );
}

/** Mesto i oznake stanice: opština · okrug, približna lokacija, kašnjenje ili poslednje merenje. */
export function StationMeta({ row, latest, className }: { row: StationRow; latest: Date | null; className?: string }) {
  const { view } = row;
  const place = [view.station.municipality, row.okrug ? okrugShort(row.okrug) : null].filter(Boolean).join(' · ') || view.station.code;
  const stale = isStaleGroup(row.group);
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted', className)}>
      <span className="min-w-0 truncate">{place}</span>
      {view.position?.approximate ? (
        <span
          className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border border-dashed border-border-strong px-1.5 text-[11px] leading-none text-muted"
          title="Stanica nema koordinate – na mapi je prikazana u centru opštine."
        >
          <MapPinned aria-hidden className="size-3" />
          približna lokacija
        </span>
      ) : null}
      {stale && view.observedAt ? (
        <span className="tnum text-faint" title={`Poslednje merenje – početak satnog intervala: ${formatDateTime(view.observedAt)}`}>
          poslednje merenje <span className="whitespace-nowrap">{formatLastSeen(view.observedAt)}</span>
        </span>
      ) : null}
      {!stale && row.lagHours >= LAG_NOTE_HOURS && view.observedAt ? (
        <span
          className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-warn-soft px-1.5 text-[11px] leading-none text-warn-soft-ink"
          title={`Poslednje merenje ${formatHourInterval(view.observedAt)}${latest ? `, najnoviji sat mreže je ${formatHourInterval(latest)}` : ''}.`}
        >
          <Clock aria-hidden className="size-3" />
          <span className="tnum">
            kasni {row.lagHours} h · {formatHourInterval(view.observedAt)}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Vrednost jednog polutanta sa tačkom kategorije (tekst kategorije je za čitače ekrana i u `title`). */
export function PollutantValue({ row, parameter, emphasized = false }: { row: StationRow; parameter: Parameter; emphasized?: boolean }) {
  const entry = row.view.values[parameter];
  if (!entry || !Number.isFinite(entry.v)) return <span className="text-faint">–</span>;
  const stale = isStaleGroup(row.group);
  const rank = typeof entry.c === 'number' && entry.c >= 0 && entry.c <= 5 ? entry.c : classify(parameter, entry.v);
  const label = categoryOf(rank).label;
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={stale ? 'Poslednja poznata vrednost (zastarela)' : label}>
      <span className={cn('tnum', stale ? 'text-faint' : emphasized ? 'font-semibold text-ink' : 'text-ink/85')}>{formatValue(entry.v)}</span>
      <CategoryDot rank={stale ? null : rank} size={7} />
      <span className="sr-only">{stale ? 'zastarelo' : label}</span>
    </span>
  );
}
