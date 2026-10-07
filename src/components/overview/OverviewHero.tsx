import { ClockAlert, Eye, X } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { CountUp } from '@/components/fx/CountUp';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { KosavaCanvas } from '@/components/fx/KosavaCanvas';
import { LiveDot } from '@/components/fx/LiveDot';
import { SegmentRing } from '@/components/fx/SegmentRing';
import { HowToReadButton } from '@/components/HowToRead';
import { CategoryDot } from '@/components/ui/Category';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMyStation } from '@/hooks/useMyStation';
import { CATEGORIES, catVar, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatInt, stationsNoun } from '@/lib/format';
import { dominantDrivers, lensDistribution, okrugLabel } from '@/lib/insights';
import { activeViews, liveStatus } from '@/lib/stations';

import { LiveTicker } from './LiveTicker';
import { MyStationPicker } from './MyStation';
import { distributionRepeatsHeadline, distributionSentence, driverSentence, heroHeadline, lensSentence, staleNote } from './overviewText';

/**
 * Heroj Pregleda – UVEK stanje svih polutanata (sočivo ga ne menja; kad je sočivo izabrano,
 * ispod stoji jedan red raspodele po tom polutantu). Čestice Košave (gustina = medijana PM10),
 * naslov sa podvlačenjem reči kategorije, rečenica raspodele i šta je određuje, segmentirani
 * prsten sa legendom, „Kako čitati“, izbor moje stanice i traka uživo (bez trake na telefonu).
 */
export function OverviewHero({ className, style }: { className?: string; style?: CSSProperties }) {
  const { kpis, hazeRank, particleIntensity, theme, okrug, setOkrug, filteredViews, lens, now, views } = useAtmosfera();
  const { reporting, total, stale, countsByCategory, latestObservedAt } = kpis;
  const { storedId } = useMyStation(views);
  const headline = heroHeadline(countsByCategory, hazeRank);
  const headlineRank = headline?.rank ?? null;
  const driver = useMemo(
    () => (headlineRank === null ? null : driverSentence(dominantDrivers(filteredViews, headlineRank), headlineRank)),
    [filteredViews, headlineRank],
  );
  const lensLine = useMemo(() => lensSentence(lens, lensDistribution(filteredViews, lens)), [filteredViews, lens]);
  // Sat u natpisu: najnoviji sat svežih stanica opsega; kad svežih nema (SEPA kasni > 6 h),
  // najnoviji poznati sat aktivnih stanica opsega – sa starošću i datumom, nikad kao „uživo“.
  const hourAt = useMemo(() => {
    if (latestObservedAt) return latestObservedAt;
    let newest: Date | null = null;
    for (const view of activeViews(filteredViews)) if (view.observedAt && (!newest || view.observedAt > newest)) newest = view.observedAt;
    return newest;
  }, [latestObservedAt, filteredViews]);
  const status = liveStatus(hourAt, now);
  const xl = useMediaQuery('(min-width: 1280px)', true);
  const sm = useMediaQuery('(min-width: 640px)', true);
  const ringSize = xl ? 156 : sm ? 120 : 96;
  const note = staleNote(stale);

  const eyebrow = [
    <span key="title">Stanje vazduha</span>,
    // Sočivo menja ostale panele, ne heroj: natpis to kaže umesto da nosi oznaku sočiva.
    lens !== 'worst' ? <span key="all">svi polutanti</span> : null,
    okrug ? (
      <span key="okrug" className="text-ink">
        {okrugLabel(okrug)}
      </span>
    ) : null,
    hourAt ? (
      <span key="hour">
        {status.live ? 'najnoviji sat' : 'poslednji sat'} <span className="tnum text-ink">{status.label}</span>
      </span>
    ) : null,
    hourAt && status.ageText ? <span key="age">{status.ageText}</span> : null,
  ].filter((part) => part !== null);

  return (
    <GlassPanel variant="hero" className={cn('overflow-hidden', className)} style={style} aria-labelledby="hero-title">
      {/* Maska (pregled.css) prigušuje čestice iza teksta i legende – tragovi ne precrtavaju slova. */}
      <KosavaCanvas intensity={particleIntensity} colorKey={`${hazeRank}-${theme}`} className="ov-hero__particles rounded-[inherit]" />

      <div className="ov-hero__grid relative px-4 pb-5 pt-5 sm:px-7 sm:pb-6 sm:pt-6 lg:px-8 lg:pt-7">
        <div className="ov-hero__text min-w-0">
          {/* Razdvajač „·“ je na kraju PRETHODNOG dela: prelomljen red nikad ne počinje tačkom. */}
          <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
            <LiveDot size={7} color={status.live ? 'var(--ok)' : 'var(--faint)'} pulse={status.live} />
            {eyebrow.map((part, index) =>
              index < eyebrow.length - 1 ? (
                <span key={part.key} className="whitespace-nowrap">
                  {part}
                  <span className="text-muted"> ·</span>
                </span>
              ) : (
                part
              ),
            )}
          </p>
          <h2
            id="hero-title"
            className="mt-2.5 max-w-[19ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.025em] text-ink sm:text-[40px] lg:max-w-none lg:text-[40px] xl:text-[44px] 2xl:text-[52px]"
          >
            {headline ? (
              <>
                {headline.lead} <span className="haze-underline whitespace-nowrap">{headline.word}</span>
              </>
            ) : (
              'Nema svežih merenja'
            )}
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted">
            {/* Jedna ili dve stanice iste kategorije: naslov već broji stanice, ostaje samo „zbog …“. */}
            {distributionRepeatsHeadline(countsByCategory) && driver ? null : distributionSentence(countsByCategory)}
            {driver ? <span className="text-ink/90"> {driver}</span> : null}
          </p>
          {lensLine ? (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-5 text-muted">
              <Eye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />
              <span>{lensLine}</span>
            </p>
          ) : null}
        </div>

        <div className="ov-hero__ring">
          <HeroRing size={ringSize} reporting={reporting} total={total} counts={countsByCategory} />
          <HeroLegend counts={countsByCategory} okrug={okrug} />
        </div>

        <div className="ov-hero__foot flex flex-col gap-1 text-xs leading-5 text-faint">
          {note ? (
            <p className="flex items-start gap-1.5">
              <ClockAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {note}
            </p>
          ) : null}
          <p>Gustina čestica u pozadini prati medijanu PM10 mreže.</p>
        </div>

        <div className="ov-hero__actions flex flex-wrap items-center gap-2">
          <HowToReadButton />
          {storedId === null ? <MyStationPicker label="Izaberi moju stanicu" /> : null}
          {okrug ? (
            <button
              type="button"
              onClick={() => setOkrug(null)}
              className="touch-target inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
              Prikaži celu mrežu
            </button>
          ) : null}
        </div>
      </div>

      {/* Traka uživo samo od 640 px: na telefonu ponavlja „Najlošije sada“ i produžava heroj. */}
      <LiveTicker className="hidden sm:flex" />
    </GlassPanel>
  );
}

/**
 * Legenda prstena: kategorije sa brojem stanica. Ispod 1280 px kategorije bez stanica se
 * sažimaju u jedan prigušen red; na širokom ekranu stoji cela SEPA skala (prazne prigušene).
 */
function HeroLegend({ counts, okrug }: { counts: readonly number[]; okrug: string | null }) {
  const zero = RANKS.filter((rank) => counts[rank] === 0).length;
  return (
    <ul className="ov-legend" aria-label={`Broj stanica po kategoriji${okrug ? `, ${okrugLabel(okrug)}` : ''}`}>
      {RANKS.map((rank) => {
        const count = counts[rank];
        return (
          <li
            key={rank}
            className={cn('ov-legend__row', count === 0 ? 'ov-legend__zero border-transparent text-faint' : 'text-ink')}
            style={
              count === 0
                ? undefined
                : {
                    borderColor: `color-mix(in oklab, ${catVar(rank)} 42%, var(--border))`,
                    backgroundColor: `color-mix(in oklab, ${catVar(rank)} 14%, var(--panel-solid))`,
                  }
            }
          >
            <CategoryDot rank={rank} size={8} className={count === 0 ? 'opacity-50' : undefined} />
            <span className="min-w-0 flex-1 truncate">{CATEGORIES[rank].label}</span>
            <span className={cn('tnum font-semibold', count === 0 ? 'text-faint' : 'text-ink')}>{formatInt(count)}</span>
          </li>
        );
      })}
      {zero > 0 ? (
        <li className="ov-legend__rest">
          {zero === RANKS.length ? 'Nijedna stanica nema svežu kategoriju' : 'Ostale kategorije: 0'}
        </li>
      ) : null}
    </ul>
  );
}

function HeroRing({ size, reporting, total, counts }: { size: number; reporting: number; total: number; counts: readonly number[] }) {
  const bezel = size + (size >= 150 ? 30 : 22);
  const ticks = 72;
  const outer = bezel / 2 - 1;
  const big = size >= 150;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: bezel, height: bezel }}>
      <span aria-hidden className="ov-ring-glow" />
      <span aria-hidden className="ov-ring-core" />
      <svg aria-hidden className="ov-bezel" width={bezel} height={bezel} viewBox={`0 0 ${bezel} ${bezel}`}>
        {Array.from({ length: ticks }, (_, i) => {
          const major = i % 6 === 0;
          const angle = (i / ticks) * Math.PI * 2;
          const inner = outer - (major ? 6 : 3);
          const c = bezel / 2;
          return (
            <line
              key={i}
              x1={c + Math.cos(angle) * inner}
              y1={c + Math.sin(angle) * inner}
              x2={c + Math.cos(angle) * outer}
              y2={c + Math.sin(angle) * outer}
              stroke="currentColor"
              strokeOpacity={major ? 0.95 : 0.5}
              strokeWidth={major ? 1.5 : 1}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <SegmentRing
        label="Raspodela svežih stanica po kategoriji"
        size={size}
        thickness={Math.round(size * 0.085)}
        segments={RANKS.map((rank) => ({ key: rank, label: CATEGORIES[rank].label, value: counts[rank], color: catVar(rank) }))}
      >
        <span className={cn('flex items-baseline font-heading font-semibold leading-none text-ink', big ? 'text-[34px]' : size >= 110 ? 'text-[28px]' : 'text-[24px]')}>
          <CountUp value={reporting} />
          <span className={cn('ml-1 font-medium text-faint', big ? 'text-lg' : 'text-sm')}>/ {formatInt(total)}</span>
        </span>
        <span className={cn('font-mono text-[11px] uppercase tracking-[0.12em] text-muted', big ? 'mt-1.5' : 'mt-1')}>{stationsNoun(total)}</span>
      </SegmentRing>
    </div>
  );
}
