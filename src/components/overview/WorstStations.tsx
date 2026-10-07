import { ArrowRight } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT, type Parameter } from '@shared/aqi';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { SectionHeader } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/Category';
import { LensScope } from '@/components/ui/LensScope';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { CATEGORIES, catVar } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatInt } from '@/lib/format';
import { deltaVs24h, lensLabel, okrugLabel, okrugOf, rankByLens, thresholdsFor, type RankedStation } from '@/lib/insights';

import { bandCountFor, bandPosition, deltaPhrase, WORST_LIMIT } from './overviewText';


/**
 * „Najzagađenije stanice“: osam najlošijih svežih stanica kroz sočivo. Traka pokazuje
 * položaj vrednosti na SEPA skali TOG polutanta (pojasevi kategorija iste širine, crtice
 * na granicama), pa su stanice sa različitim dominantnim polutantima uporedive. Uz to:
 * vrednost, čip kategorije i promena prema sopstvenom proseku 24 h. Klik → Mapa.
 */
export function WorstStations({ className, style }: { className?: string; style?: CSSProperties }) {
  const { filteredViews, lens, okrug, openStation, navigate, kpis } = useAtmosfera();
  const ranked = useMemo(() => rankByLens(filteredViews, lens, WORST_LIMIT), [filteredViews, lens]);
  const maxRank = ranked.reduce((max, entry) => Math.max(max, entry.reading.category?.rank ?? 0), 0);
  const bands = bandCountFor(maxRank);
  // Širina kolone čipa iz najdužeg naziva kategorije u listi (čip `sm`: 11 px, polu-debeo).
  const longest = ranked.reduce((max, entry) => Math.max(max, entry.reading.category?.label.length ?? 0), 0);
  const chipWidth = Math.ceil(longest * 6.6 + 16);
  const columns = { '--ov-chip-w': `${chipWidth}px`, '--ov-side': `${Math.max(86, chipWidth)}px` } as CSSProperties;

  return (
    <GlassPanel
      className={cn('ov-rank flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)}
      style={style}
      aria-labelledby="worst-title"
    >
      <SectionHeader
        id="worst-title"
        eyebrow={
<LensScope lens={lens} okrug={okrug} />
        }
        title="Najzagađenije stanice"
        hint={`Vrednosti u ${UNIT}. Traka je položaj vrednosti na SEPA skali tog polutanta; crtice su granice kategorija.`}
      />

      {ranked.length === 0 ? (
        <p className="rounded-tile border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted">
          {lens === 'worst' ? 'Nijedna stanica nema sveže podatke.' : `Nijedna stanica nema svežu vrednost ${lensLabel(lens)}.`}
        </p>
      ) : (
        <div className="flex flex-col gap-1" style={columns}>
          <ScaleHead bands={bands} />
          <ol className="flex flex-col" aria-label={`Najzagađenije stanice, ${lensLabel(lens)}`}>
            {ranked.map((entry, index) => (
              <RankRow key={entry.view.id} entry={entry} index={index} bands={bands} onOpen={() => openStation(entry.view.id)} />
            ))}
          </ol>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate('stanice')}
        className="group mt-auto inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-border-strong px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] hover:bg-card-2"
      >
        Sve stanice <span className="tnum text-muted">· {formatInt(kpis.total)}</span>
        <ArrowRight aria-hidden className="size-3.5 text-muted transition-transform group-hover:translate-x-0.5" />
      </button>
    </GlassPanel>
  );
}

/** Zaglavlje kolona (samo u širokom rasporedu): ključ skale u bojama kategorija iznad traka. */
function ScaleHead({ bands }: { bands: number }) {
  return (
    <div aria-hidden className="ov-rank__head px-2 pb-1">
      <span className="eyebrow ov-rank__no">#</span>
      <span className="eyebrow ov-rank__name">Stanica</span>
      <span className="ov-rank__bar flex flex-col gap-1">
        <span className="eyebrow">SEPA skala</span>
        <span data-mark className="flex h-[3px] gap-[2px]">
          {Array.from({ length: bands }, (_, rank) => (
            <span key={rank} className="flex-1 rounded-full opacity-80" style={{ backgroundColor: catVar(rank) }} title={CATEGORIES[rank].label} />
          ))}
        </span>
      </span>
      <span className="eyebrow ov-rank__value whitespace-nowrap">Sada</span>
    </div>
  );
}

function RankRow({ entry, index, bands, onOpen }: { entry: RankedStation; index: number; bands: number; onOpen: () => void }) {
  const { view, reading } = entry;
  const parameter = reading.parameter as Parameter;
  const value = reading.value as number;
  const category = reading.category!;
  const { position, overflow } = bandPosition(parameter, value, bands);
  const delta = deltaVs24h(view, parameter);
  const phrase = delta ? deltaPhrase(delta.delta, delta.direction) : null;
  const okrug = okrugOf(view);
  const where = [view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ');
  const limits = thresholdsFor(parameter).limits;

  const deltaNode = phrase ? (
    <>
      {/* Bez boja kategorija: smer nose strelica i reči, rast je podebljan u ink boji. */}
      <span className={cn('tnum', delta?.direction === 'up' ? 'font-semibold text-ink' : 'font-medium text-muted')}>
        {phrase.arrow}
        {phrase.amount ? ` ${phrase.amount}` : ''}
      </span>{' '}
      <span className="text-muted">{phrase.words}</span>
    </>
  ) : (
    <span className="text-faint">bez proseka 24 h</span>
  );

  // Naziv dugmeta je vidljivi tekst reda (naziv, opština, promena, vrednost, kategorija) +
  // jedinica i radnja samo za čitače ekrana; redni broj daje sama lista (<ol>).
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'ov-rank__row w-full rounded-tile px-2 py-2.5 text-left transition-[background-color,box-shadow] duration-150',
          'hover:bg-[color-mix(in_oklab,var(--haze)_7%,var(--card-2))] hover:shadow-[inset_0_0_0_1px_var(--border)]',
        )}
      >
        <span aria-hidden className="ov-rank__no tnum pt-0.5 font-mono text-[11px] text-faint">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="ov-rank__name min-w-0 truncate text-[14px] font-medium leading-5 text-ink">
          {view.station.name}
        </span>
        <span className="ov-rank__meta flex min-w-0 items-baseline gap-3 text-xs leading-4">
          <span className="min-w-0 truncate text-muted">{where || view.station.code}</span>
          <span className="ov-rank__delta-inline ml-auto shrink-0 whitespace-nowrap">{deltaNode}</span>
        </span>
        <span aria-hidden data-mark className="ov-rank__bar relative block h-2.5" title={`Granice ${PARAMETER_LABELS[parameter]}: ${limits.slice(0, bands - 1).join(' / ')} ${UNIT}`}>
          <span className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]" />
          <span
            className="ov-bar-fill absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.max(3, position * 100).toFixed(2)}%`,
              backgroundColor: catVar(category.rank),
              // Sjaj trake prati jačinu sjaja teme (tamna .55, svetla .25) – u svetloj ne razmazuje boju.
              boxShadow: `0 0 12px -2px color-mix(in oklab, ${catVar(category.rank)} calc(var(--glow-strength) * 150%), transparent)`,
              animationDelay: `${index * 22}ms`,
            }}
          />
          {Array.from({ length: bands - 1 }, (_, i) => (
            <span
              key={i}
              className="absolute -inset-y-[3px] w-px bg-[color-mix(in_oklab,var(--ink)_32%,transparent)]"
              style={{ left: `${(((i + 1) / bands) * 100).toFixed(2)}%` }}
            />
          ))}
          {overflow ? <span className="absolute -right-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-ink" /> : null}
        </span>
        <span className="ov-rank__delta whitespace-nowrap text-xs leading-4">{deltaNode}</span>
        <span className="ov-rank__value flex items-baseline gap-1.5 whitespace-nowrap leading-none">
          <span className="font-heading text-lg font-semibold text-ink">{formatConcentration(value)}</span>
          <span className="sr-only">{UNIT}</span>
          <span className="unit-label w-[34px] text-left text-faint">{PARAMETER_LABELS[parameter]}</span>
        </span>
        <span className="ov-rank__chip">
          <CategoryChip category={category} size="sm" />
        </span>
        <span className="sr-only">, otvori na mapi</span>
      </button>
    </li>
  );
}
