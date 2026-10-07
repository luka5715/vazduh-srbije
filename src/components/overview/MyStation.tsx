import { ArrowUpRight, ChevronDown, Star, X } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMyStation } from '@/hooks/useMyStation';
import { cn } from '@/lib/cn';
import { formatConcentration } from '@/lib/format';
import { deltaVs24h, lensLabel, lensOf, okrugLabel, okrugOf } from '@/lib/insights';
import { activeViews, isInactive, liveStatus, STALE_HOURS, type StationView } from '@/lib/stations';

import { deltaPhrase, nextThreshold } from './overviewText';

const NO_OKRUG = 'Bez okruga';

/**
 * Izbor moje stanice: nativni `<select>` (na telefonu sistemski birač), aktivne stanice
 * grupisane po okrugu. Uvek prikazuje natpis (`label`), ne izabranu stanicu – izbor odmah
 * postaje moja stanica, a kartica „Moja stanica“ prikazuje koja je. `field-sizing: content`
 * daje širinu natpisa (bez toga je select širok kao najduži naziv stanice).
 */
export function MyStationPicker({ label, className }: { label: string; className?: string }) {
  const { views } = useAtmosfera();
  const { setMyStation } = useMyStation(views);
  const groups = useMemo(() => {
    const byOkrug = new Map<string, StationView[]>();
    for (const station of activeViews(views)) {
      const okrug = okrugOf(station);
      const key = okrug ? okrugLabel(okrug) : NO_OKRUG;
      byOkrug.set(key, [...(byOkrug.get(key) ?? []), station]);
    }
    return [...byOkrug.entries()].sort(([a], [b]) => (a === NO_OKRUG ? 1 : b === NO_OKRUG ? -1 : a.localeCompare(b, 'sr-Latn')));
  }, [views]);
  if (!groups.length) return null;
  return (
    <label className={cn('relative inline-flex h-8 max-w-full items-center', className)}>
      <span className="sr-only">Moja stanica – stanica koja se prikazuje prva na Pregledu (pamti se samo u ovom pregledaču)</span>
      <Star aria-hidden className="pointer-events-none absolute left-3 size-3.5 text-muted" />
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) setMyStation(event.target.value);
        }}
        className="h-8 max-w-full cursor-pointer appearance-none truncate rounded-full border border-border-strong bg-transparent pl-8 pr-8 text-[13px] font-medium text-ink transition-colors [field-sizing:content] hover:bg-card-2"
      >
        <option value="">{label}</option>
        {groups.map(([okrug, stations]) => (
          <optgroup key={okrug} label={okrug}>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.station.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 size-3.5 text-muted" />
    </label>
  );
}

/**
 * „Moja stanica“ na vrhu Pregleda (samo kad je izabrana): kategorija i dominantna vrednost,
 * promena prema proseku 24 h, koliko do sledećeg praga, kad je izmereno i savet uz
 * kategoriju (formulacija aplikacije, ne SEPA). Ne zavisi od filtera okruga. Zastarela,
 * neaktivna ili nestala stanica se tako i prikazuje – bez stare kategorije i saveta.
 */
export function MyStationCard({ className, style }: { className?: string; style?: CSSProperties }) {
  const { views, lens, now, openStation } = useAtmosfera();
  const { view, missing, setMyStation } = useMyStation(views);
  if (!view && !missing) return null;

  const remove = (
    <button
      type="button"
      onClick={() => setMyStation(null)}
      aria-label="Ukloni moju stanicu"
      title="Ukloni moju stanicu"
      className="touch-target grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted transition-colors hover:border-border-strong hover:text-ink"
    >
      <X aria-hidden className="size-3.5" />
    </button>
  );
  const header = (where: string | null) => (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="eyebrow flex min-w-0 items-center gap-1.5">
        <Star aria-hidden className="size-3.5 shrink-0 fill-current text-accent" />
        <span>Moja stanica</span>
        {where ? <span className="min-w-0 truncate normal-case tracking-normal">· {where}</span> : null}
      </p>
      <div className="flex items-center gap-1.5">
        <MyStationPicker label="Promeni stanicu" />
        {remove}
      </div>
    </div>
  );

  if (!view) {
    return (
      <GlassPanel className={cn('flex flex-col gap-2 p-4 sm:p-5', className)} style={style} aria-label="Moja stanica">
        {header(null)}
        <p className="text-sm text-muted">Sačuvana stanica više nije u mreži (SEPA ju je možda ugasila ili promenila oznaku). Izaberite drugu stanicu.</p>
      </GlassPanel>
    );
  }

  const okrug = okrugOf(view);
  const where = [view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ') || null;
  const reading = lensOf(view, 'worst');
  const inactive = isInactive(view);
  const fresh = !view.stale && reading.category !== null;
  const status = liveStatus(view.observedAt, now);
  const category = fresh ? reading.category : null;
  const next = category && reading.parameter && reading.value !== null ? nextThreshold(reading.parameter, reading.value, category.rank) : null;
  const delta = fresh && reading.parameter ? deltaVs24h(view, reading.parameter) : null;
  const phrase = delta ? deltaPhrase(delta.delta, delta.direction) : null;
  const lensReading = lens !== 'worst' ? lensOf(view, lens) : null;
  const titleId = `my-station-${view.id}`;

  return (
    <GlassPanel className={cn('ov-mine flex flex-col gap-3 p-4 sm:p-5', className)} style={style} aria-labelledby={titleId}>
      {header(where)}
      <div className="ov-mine__body">
        <div className="min-w-0">
          <h2 id={titleId} className="font-heading text-xl font-semibold leading-7 text-ink sm:text-2xl sm:leading-8">
            <button
              type="button"
              onClick={() => openStation(view.id)}
              className="group inline-flex max-w-full items-center gap-1.5 text-left hover:underline hover:decoration-border-strong hover:underline-offset-4"
            >
              <span className="min-w-0">{view.station.name}</span>
              <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              <span className="sr-only">. Otvori na mapi.</span>
            </button>
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">
            {view.observedAt ? (
              <>
                {fresh ? 'Izmereno' : 'Poslednje merenje'} <span className="tnum text-ink">{status.label}</span> · {status.ageText}
              </>
            ) : (
              'Stanica još nema merenja.'
            )}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 lg:items-end lg:text-right">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:justify-end">
            <CategoryChip category={category} stale={view.stale && view.snapshot !== null} size="lg" />
            {reading.parameter && reading.value !== null ? (
              <p className={cn('flex items-baseline gap-1.5 whitespace-nowrap', !fresh && 'opacity-70')}>
                <span className="unit-label text-muted">{PARAMETER_LABELS[reading.parameter]}</span>
                <span className="font-heading text-[28px] font-semibold leading-none text-ink">{formatConcentration(reading.value)}</span>
                <span className="unit-label text-faint">{UNIT}</span>
              </p>
            ) : null}
          </div>
          {fresh ? (
            <p className="text-[13px] leading-5 text-muted">
              {phrase ? (
                <>
                  <span className="tnum font-semibold text-ink">
                    {phrase.arrow}
                    {phrase.amount ? ` ${phrase.amount}` : ''}
                  </span>{' '}
                  {phrase.words}
                </>
              ) : (
                'Bez proseka 24 h'
              )}
              {next ? (
                <>
                  {' · '}
                  {next.remaining > 0 ? (
                    <>
                      još <span className="tnum font-semibold text-ink">{formatConcentration(next.remaining)}</span> {UNIT} do kategorije {next.nextLabel}
                    </>
                  ) : (
                    <>na samoj granici kategorije {next.nextLabel}</>
                  )}
                </>
              ) : category ? (
                ' · iznad svih SEPA pragova'
              ) : null}
            </p>
          ) : null}
          {lensReading ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-muted lg:justify-end">
              {lensReading.category ? <CategoryDot rank={lensReading.category.rank} size={8} /> : null}
              {lensReading.value !== null && lensReading.category ? (
                <span>
                  Po {lensLabel(lens)}: <span className="tnum font-semibold text-ink">{formatConcentration(lensReading.value)}</span> {UNIT} ·{' '}
                  {lensReading.category.label}
                </span>
              ) : (
                <span>Po {lensLabel(lens)}: nema sveže vrednosti na ovoj stanici.</span>
              )}
            </p>
          ) : null}
        </div>
      </div>

      {category ? (
        <div className="flex flex-col gap-0.5 rounded-tile bg-card-2 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <p className="flex items-start gap-2 text-sm leading-5 text-ink">
            <CategoryDot rank={category.rank} size={8} className="mt-1.5" />
            {category.advice}
          </p>
          <p className="shrink-0 pl-4 text-xs leading-5 text-faint sm:pl-0">Savet aplikacije, nije zvaničan tekst SEPA.</p>
        </div>
      ) : (
        <p className="rounded-tile bg-card-2 px-3 py-2.5 text-sm leading-5 text-muted">
          {inactive
            ? 'Stanica je u SEPA mreži označena kao neaktivna – izaberite drugu stanicu.'
            : view.snapshot
              ? `Nema merenja u poslednjih ${STALE_HOURS} h, pa se kategorija i savet ne prikazuju.`
              : 'Za ovu stanicu još nema merenja u bazi.'}
        </p>
      )}
    </GlassPanel>
  );
}
