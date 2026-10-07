import { ArrowDownUp, ChevronDown, CircleCheck, Clock, ClockAlert, Info, MapPinned, MapPinOff, PowerOff, Search, X, type LucideIcon } from 'lucide-react';
import { useId, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { PARAMETER_LABELS, PARAMETERS } from '@shared/aqi';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { CategoryDot } from '@/components/ui/Category';
import { LensScope } from '@/components/ui/LensScope';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { catVar } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatInt, pluralSr, stationsNoun } from '@/lib/format';
import { lensLabel, okrugLabel, type Lens } from '@/lib/insights';
import { liveStatus, STALE_HOURS, type StationView } from '@/lib/stations';

import { OkrugChips } from './OkrugChips';
import { groupLabel, LAG_NOTE_HOURS, type GroupCount, type SortState, type StationGroup, type StatusSummary } from './stationRows';

// ---------------------------------------------------------------------------
// Pretraga
// ---------------------------------------------------------------------------

export function SearchField({
  value,
  onChange,
  onSubmit,
  inputRef,
  placeholder = 'Naziv, šifra, opština ili okrug…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter u polju (otvara prvu pronađenu stanicu). */
  onSubmit: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Kraći tekst za usko polje (telefon, pored izbora redosleda). */
  placeholder?: string;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div className={cn('relative', className)}>
      <label className="block">
        <span className="sr-only">Pretraga stanica po nazivu, šifri, opštini ili okrugu</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            } else if (event.key === 'Escape' && value) {
              event.preventDefault();
              onChange('');
            }
          }}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-ctl border border-border-strong bg-panel pl-9 pr-9 text-sm text-ink shadow-[var(--shadow-inset)] transition-colors placeholder:text-faint',
            'hover:border-[color-mix(in_oklab,var(--haze)_40%,var(--border-strong))] focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
      </label>
      <span id={hintId} className="sr-only">
        Bez obzira na kvačice. Enter otvara prvu pronađenu stanicu na mapi.
      </span>
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef?.current?.focus();
          }}
          aria-label="Obriši pretragu"
          className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card-2 hover:text-ink"
        >
          {/* Dodir: nevidljiva površina 44 × 44 px (dugme je već `absolute`, pa ne može `touch-target`). */}
          <span aria-hidden className="absolute left-1/2 top-1/2 hidden size-11 -translate-x-1/2 -translate-y-1/2 pointer-coarse:block" />
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raspodela po kategorijama (legenda + filter)
// ---------------------------------------------------------------------------

function groupColor(group: StationGroup): string {
  return typeof group === 'number' ? catVar(group) : 'var(--faint)';
}

/**
 * Raspodela stanica po kategoriji sočiva: segmentirana traka (razmaci 2 px) i čipovi sa
 * nazivom i brojem koji su ujedno filter (jedan izbor; ponovni klik ga uklanja).
 */
export function GroupFilter({
  counts,
  active,
  onToggle,
  lens,
  trailing,
  className,
}: {
  counts: GroupCount[];
  active: StationGroup | null;
  onToggle: (group: StationGroup) => void;
  lens: Lens;
  /** Sadržaj na kraju reda čipova (npr. „Poništi filtere“). */
  trailing?: ReactNode;
  className?: string;
}) {
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;
  const summary = counts.map((entry) => `${groupLabel(entry.group)} ${entry.count}`).join(', ');
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div role="img" aria-label={`Raspodela stanica (${lensLabel(lens)}): ${summary}`} className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {counts.map((entry) => (
          <span
            key={String(entry.group)}
            className={cn('st-seg h-full min-w-[6px] transition-opacity duration-200', active !== null && active !== entry.group && 'opacity-30')}
            style={
              {
                flexGrow: entry.count,
                flexBasis: 0,
                '--st-seg': groupColor(entry.group),
              } as CSSProperties
            }
            data-kind={typeof entry.group === 'number' ? 'cat' : entry.group}
          />
        ))}
      </div>
      {/* Uz dodir veći vertikalni razmak: površine dodira (44 px) susednih redova čipova se ne preklapaju. */}
      <div role="group" aria-label={`Filter po kategoriji (${lensLabel(lens)})`} className="flex flex-wrap gap-1.5 pointer-coarse:gap-y-4">
        {counts.map((entry) => {
          const pressed = active === entry.group;
          return (
            <button
              key={String(entry.group)}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(entry.group)}
              className={cn(
                'touch-target inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition-[background-color,border-color,color] duration-150',
                pressed
                  ? 'border-[color-mix(in_oklab,var(--chip)_70%,var(--border-strong))] bg-[color-mix(in_oklab,var(--chip)_16%,var(--panel))] font-medium text-ink'
                  : 'border-border bg-transparent text-muted hover:border-border-strong hover:text-ink',
              )}
              style={{ '--chip': groupColor(entry.group) } as CSSProperties}
            >
              <CategoryDot rank={typeof entry.group === 'number' ? entry.group : null} size={8} />
              {groupLabel(entry.group)}
              <span className={cn('tnum font-mono text-[11px]', pressed ? 'text-ink' : 'text-faint')}>{entry.count}</span>
            </button>
          );
        })}
        {trailing ? <span className="ml-auto flex">{trailing}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redosled (kartice na telefonu – tabela sortira klikom na zaglavlje)
// ---------------------------------------------------------------------------

interface SortOption {
  value: string;
  label: string;
  /** Kratak natpis zatvorenog izbora u uskom polju (lista opcija i čitač ekrana imaju pun naziv). */
  short: string;
  sort: SortState;
}

function sortOptions(lens: Lens): SortOption[] {
  const lensName = lens === 'worst' ? 'najlošiji polutant' : lensLabel(lens);
  const options: SortOption[] = [
    { value: 'lens:desc', label: `Najlošije prvo (${lensName})`, short: 'Najlošije prvo', sort: { key: 'lens', dir: 'desc' } },
    { value: 'lens:asc', label: `Najbolje prvo (${lensName})`, short: 'Najbolje prvo', sort: { key: 'lens', dir: 'asc' } },
    { value: 'delta:desc', label: 'Najveći rast prema proseku 24 h', short: 'Najveći rast', sort: { key: 'delta', dir: 'desc' } },
    { value: 'delta:asc', label: 'Najveći pad prema proseku 24 h', short: 'Najveći pad', sort: { key: 'delta', dir: 'asc' } },
    { value: 'name:asc', label: 'Naziv A–Ž', short: 'Naziv A–Ž', sort: { key: 'name', dir: 'asc' } },
    { value: 'name:desc', label: 'Naziv Ž–A', short: 'Naziv Ž–A', sort: { key: 'name', dir: 'desc' } },
  ];
  for (const parameter of PARAMETERS) {
    options.push(
      { value: `${parameter}:desc`, label: `${PARAMETER_LABELS[parameter]} – najviše`, short: `${PARAMETER_LABELS[parameter]} najviše`, sort: { key: parameter, dir: 'desc' } },
      { value: `${parameter}:asc`, label: `${PARAMETER_LABELS[parameter]} – najniže`, short: `${PARAMETER_LABELS[parameter]} najniže`, sort: { key: parameter, dir: 'asc' } },
    );
  }
  return options;
}

export function SortSelect({
  sort,
  onChange,
  lens,
  compact = false,
  className,
}: {
  sort: SortState;
  onChange: (sort: SortState) => void;
  lens: Lens;
  /**
   * Usko polje pored pretrage (telefon): visina 40 px i kratak natpis izabrane opcije preko
   * izbora (sam izbor, lista opcija i čitač ekrana zadržavaju pun naziv).
   */
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  const options = sortOptions(lens);
  const value = `${sort.key}:${sort.dir}`;
  const current = options.find((option) => option.value === value);
  return (
    <div className={cn('relative flex items-center', className)}>
      <label htmlFor={id} className="sr-only">
        Redosled stanica
      </label>
      <ArrowDownUp aria-hidden className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const option = options.find((item) => item.value === event.target.value);
          if (option) onChange(option.sort);
        }}
        className={cn(
          'w-full appearance-none truncate border border-border-strong bg-panel pl-8 pr-8 text-xs text-ink shadow-[var(--shadow-inset)] transition-colors',
          'hover:border-[color-mix(in_oklab,var(--haze)_40%,var(--border-strong))] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          compact ? 'h-10 rounded-ctl pr-7 text-transparent' : 'h-8 rounded-full',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {compact && current ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-8 right-7 truncate text-xs leading-10 text-ink">
          {current.short}
        </span>
      ) : null}
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 size-3.5 text-muted" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel alata
// ---------------------------------------------------------------------------

/** „od 1 stanice“, „od 3 stanice“, „od 26 stanica“ (genitiv posle „od“). */
function genitive(count: number): string {
  return pluralSr(count, 'stanice', 'stanice', 'stanica');
}

export interface StationsToolbarProps {
  lens: Lens;
  okrug: string | null;
  okrugs: string[];
  onOkrugChange: (okrug: string | null) => void;
  /** Sve stanice mreže (za brojeve na čipovima okruga). */
  allViews: StationView[];
  status: StatusSummary;
  /** Neaktivne stanice izabranog okruga (i kad nisu na listi). */
  inactiveInScope: number;
  /** Neaktivne stanice su uključene u listu (`?neaktivne=1`). */
  showInactive: boolean;
  onToggleInactive: () => void;
  /** Aktivne stanice kojima okrug nije poznat (nisu ni u jednom okrugu, samo u „Svi okruzi“). */
  withoutOkrug: number;
  shown: number;
  latest: Date | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmitQuery: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  counts: GroupCount[];
  activeGroup: StationGroup | null;
  onToggleGroup: (group: StationGroup) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  filtersActive: boolean;
  onReset: () => void;
}

/**
 * Zaglavlje stranice Stanice: opseg i sočivo, broj prikazanih stanica i status mreže,
 * pretraga, čipovi okruga, raspodela po kategorijama (filter) i redosled za kartice.
 */
export function StationsToolbar(props: StationsToolbarProps) {
  const { lens, okrug, status, shown, latest, filtersActive } = props;
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  // Ispod `sm` (telefon): pretraga i redosled u jednom redu, pa polje pretrage dobija kraći tekst.
  const wide = useMediaQuery('(min-width: 640px)', true);
  const statusParts: Array<{ key: string; icon: LucideIcon; tone: string; text: string; short: string; title: string }> = [];
  statusParts.push({
    key: 'fresh',
    icon: CircleCheck,
    tone: 'text-ok',
    text: `${formatInt(status.fresh)} sa svežim podacima`,
    short: `${formatInt(status.fresh)} ${pluralSr(status.fresh, 'sveža', 'sveže', 'svežih')}`,
    title: `Poslednje merenje nije starije od ${STALE_HOURS} sati.`,
  });
  if (status.lagging)
    statusParts.push({
      key: 'lag',
      icon: Clock,
      tone: 'text-warn',
      text: `${formatInt(status.lagging)} ${pluralSr(status.lagging, 'kasni', 'kasne', 'kasni')}`,
      short: `${formatInt(status.lagging)} ${pluralSr(status.lagging, 'kasni', 'kasne', 'kasni')}`,
      title: `Poslednje merenje kasni bar ${LAG_NOTE_HOURS} sata za najnovijim satom mreže.`,
    });
  if (status.stale)
    statusParts.push({
      key: 'stale',
      icon: ClockAlert,
      tone: 'text-faint',
      text: `${formatInt(status.stale)} bez svežih podataka`,
      short: `${formatInt(status.stale)} bez podataka`,
      title: `Bez merenja duže od ${STALE_HOURS} sati – ne ulaze u stanje mreže.`,
    });
  if (props.withoutOkrug)
    statusParts.push({
      key: 'no-okrug',
      icon: MapPinOff,
      tone: 'text-faint',
      text: `${formatInt(props.withoutOkrug)} ${pluralSr(props.withoutOkrug, 'stanica', 'stanice', 'stanica')} bez okruga`,
      short: `${formatInt(props.withoutOkrug)} bez okruga`,
      title: 'Naziv opštine nije u indeksu okruga: stanica je među „Svi okruzi“, ali ni u jednom okrugu (ni u filteru okruga).',
    });
  if (status.approximate)
    statusParts.push({
      key: 'approx',
      icon: MapPinned,
      tone: 'text-faint',
      text: `${formatInt(status.approximate)} ${pluralSr(status.approximate, 'približna lokacija', 'približne lokacije', 'približnih lokacija')}`,
      short: `${formatInt(status.approximate)} ${pluralSr(status.approximate, 'približna', 'približne', 'približnih')}`,
      title: 'Stanice bez koordinata su na mapi u centru opštine.',
    });

  // Neaktivne stanice (SEPA ih je ugasila): nisu deo mreže, pa nisu na listi dok se ne uključe.
  const inactiveCount = props.inactiveInScope;
  const inactiveToggle = (compact: boolean) =>
    inactiveCount > 0 ? (
      <button
        type="button"
        onClick={props.onToggleInactive}
        title="SEPA je ove stanice označila kao neaktivne: ne broje se u mrežu, a njihova istorija ostaje u Trendovima."
        className="touch-target inline-flex items-center gap-1.5 rounded-[6px] text-muted underline decoration-border-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-current"
      >
        {compact ? null : <PowerOff aria-hidden className="size-3.5 shrink-0 text-faint" />}
        <span className="tnum">
          {props.showInactive
            ? `Sakrij ${pluralSr(inactiveCount, 'neaktivnu', 'neaktivne', 'neaktivne')} (${formatInt(inactiveCount)})`
            : `${formatInt(inactiveCount)} ${pluralSr(inactiveCount, 'neaktivna', 'neaktivne', 'neaktivnih')} · prikaži`}
        </span>
      </button>
    ) : null;

  return (
    <GlassPanel className="st-toolbar flex flex-col gap-3 p-4 sm:gap-4 sm:p-5" aria-labelledby="stations-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">
            <LensScope lens={lens} okrug={okrug} />
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id="stations-title" className="text-base font-semibold leading-6 text-ink">
              {okrug ? `Stanice · ${okrugLabel(okrug)}` : 'Sve stanice'}
            </h2>
            {/* Telefon: objašnjenje je iza malog prekidača (tekst ostaje dostupan). */}
            <button
              type="button"
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen((open) => !open)}
              className="touch-target inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[11px] font-medium text-muted transition-colors hover:text-ink sm:hidden"
            >
              <Info aria-hidden className="size-3" />
              Kako čitati
              <ChevronDown aria-hidden className={cn('size-3 transition-transform duration-150', helpOpen && 'rotate-180')} />
            </button>
          </div>
          <p id={helpId} className={cn('mt-0.5 max-w-[62ch] text-[13px] leading-5 text-muted', !helpOpen && 'max-sm:hidden')}>
            Satne vrednosti u µg/m³{latest ? `, najnoviji sat ${liveStatus(latest, new Date()).label}` : ''}. Traka je položaj vrednosti na SEPA skali polutanta, crtice su
            granice kategorija. Izbor stanice je otvara na mapi.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div aria-hidden>
            <p className="font-heading leading-none text-ink">
              <span className="text-[28px] font-semibold">{formatInt(shown)}</span>
              {shown !== status.total ? <span className="text-base font-medium text-faint"> / {formatInt(status.total)}</span> : null}
            </p>
            <p className="mt-1 text-xs text-muted">
              {shown !== status.total ? `od ${formatInt(status.total)} ${genitive(status.total)}` : stationsNoun(shown)}
            </p>
          </div>
          <p className="sr-only" aria-live="polite">
            {shown !== status.total
              ? `Prikazano ${formatInt(shown)} od ${formatInt(status.total)} ${genitive(status.total)}.`
              : `${formatInt(shown)} ${stationsNoun(shown)}.`}
          </p>
        </div>
      </div>

      <ul className="-mt-1 hidden flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted sm:flex" aria-label="Stanje stanica">
        {statusParts.map(({ key, icon: Icon, tone, text, title }) => (
          <li key={key} className="tnum inline-flex items-center gap-1.5" title={title}>
            <Icon aria-hidden className={cn('size-3.5 shrink-0', tone)} />
            {text}
          </li>
        ))}
        {inactiveCount > 0 ? <li className="inline-flex items-center">{inactiveToggle(false)}</li> : null}
      </ul>
      {/* Telefon: stanje u jednom kratkom redu. */}
      <p className="tnum -mt-1 text-xs leading-4 text-muted sm:hidden">
        {statusParts.map(({ key, short, title }, index) => (
          <span key={key} title={title}>
            {index > 0 ? <span aria-hidden className="text-faint">{' · '}</span> : null}
            {short}
          </span>
        ))}
        {inactiveCount > 0 ? (
          <>
            {statusParts.length ? <span aria-hidden className="text-faint">{' · '}</span> : null}
            {inactiveToggle(true)}
          </>
        ) : null}
      </p>

      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center">
        <div className="flex min-w-0 items-center gap-2 @3xl:w-[300px] @3xl:shrink-0">
          <SearchField
            value={props.query}
            onChange={props.onQueryChange}
            onSubmit={props.onSubmitQuery}
            inputRef={props.searchRef}
            placeholder={wide ? undefined : 'Traži stanicu…'}
            className="min-w-0 flex-1"
          />
          <SortSelect sort={props.sort} onChange={props.onSortChange} lens={lens} compact className="w-[136px] shrink-0 sm:hidden" />
        </div>
        <OkrugChips views={props.allViews} okrugs={props.okrugs} okrug={okrug} onChange={props.onOkrugChange} className="@3xl:flex-1" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:pt-4">
        <GroupFilter
          counts={props.counts}
          active={props.activeGroup}
          onToggle={props.onToggleGroup}
          lens={lens}
          trailing={
            filtersActive ? (
              <button
                type="button"
                onClick={props.onReset}
                className="touch-target inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-ink transition-colors hover:bg-card-2"
              >
                <X aria-hidden className="size-3.5 text-muted" />
                Poništi filtere
              </button>
            ) : null
          }
        />
        {/* Od `sm` do širine tabele redosled je ispod raspodele; na telefonu je pored pretrage. */}
        <SortSelect sort={props.sort} onChange={props.onSortChange} lens={lens} className="max-sm:hidden @3xl:hidden" />
      </div>
    </GlassPanel>
  );
}
