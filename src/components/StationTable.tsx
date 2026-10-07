import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { PARAMETER_LABELS, PARAMETERS, UNIT, type Parameter } from '@shared/aqi';

import { DeltaInline, LensBar, LensValue, PollutantValue, RowChip, StationMeta, TrendSpark } from '@/components/stations/parts';
import { isStaleGroup, rowTint, type SortKey, type SortState, type StationRow } from '@/components/stations/stationRows';
import { cn } from '@/lib/cn';
import { lensLabel, type Lens } from '@/lib/insights';

export interface StationTableProps {
  rows: StationRow[];
  lens: Lens;
  /** Broj pojaseva SEPA skale u traci (zajednički za sve redove). */
  bands: number;
  sort: SortState;
  onSort: (key: SortKey) => void;
  /** Otvara stanicu na Mapi. */
  onOpen: (stationId: string) => void;
  /** Stanica iz `?station=` (poslednja otvorena) – blago istaknuta. */
  currentId: string | null;
  /** Najnoviji sat mreže (za oznaku „kasni“). */
  latest: Date | null;
  className?: string;
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
  children,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
  children?: ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('st-th', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'st-sort inline-flex max-w-full items-center gap-1 rounded-[6px] whitespace-nowrap transition-colors hover:text-ink',
          active ? 'text-ink' : 'text-muted',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <span className="truncate">{children ?? label}</span>
        <Icon aria-hidden className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
      </button>
    </th>
  );
}

/**
 * Tabela stanica (širi ekrani): lepljivo zaglavlje, redovi bez zebre sa sjajem u boji
 * kategorije na hover, istaknuta kolona sočiva (vrednost, čip, traka sa crticama SEPA
 * pragova), poslednja 24 h (mini grafikon + promena prema proseku) i svi polutanti.
 * Klik na red ili Enter na nazivu otvara stanicu na Mapi. Kolone polutanata se prikazuju
 * tek kad ima mesta (kontejnerski upit u src/styles/stanice.css).
 */
export function StationTable({ rows, lens, bands, sort, onSort, onOpen, currentId, latest, className }: StationTableProps) {
  const lensParameter: Parameter | null = lens === 'worst' ? null : lens;
  return (
    <table className={cn('st-table w-full border-separate border-spacing-0 text-[13px]', className)}>
      <caption className="sr-only">
        Stanice državne mreže kroz sočivo {lensLabel(lens)}: trenutna satna vrednost u {UNIT}, SEPA kategorija, promena prema proseku poslednja 24 sata i
        vrednosti svih polutanata. Izbor stanice je otvara na mapi.
      </caption>
      <colgroup>
        <col />
        <col className="st-col-lens" />
        <col className="st-col-trend" />
        {PARAMETERS.map((parameter) => (
          <col key={parameter} className="st-col-compact" />
        ))}
        <col className="st-col-go" />
      </colgroup>
      <thead>
        <tr>
          <SortHeader label="Stanica" sortKey="name" sort={sort} onSort={onSort} className="st-th--first" />
          <SortHeader label={lensLabel(lens)} sortKey="lens" sort={sort} onSort={onSort} className="st-lens">
            <span className="text-ink">{lens === 'worst' ? 'Najlošiji polutant' : lensLabel(lens)}</span>
            <span className="font-normal text-faint"> · SEPA skala</span>
          </SortHeader>
          <SortHeader label="Poslednja 24 h" sortKey="delta" sort={sort} onSort={onSort}>
            Poslednja 24 h
          </SortHeader>
          {PARAMETERS.map((parameter) => (
            <SortHeader
              key={parameter}
              label={PARAMETER_LABELS[parameter]}
              sortKey={parameter}
              sort={sort}
              onSort={onSort}
              align="right"
              className={cn('st-compact', parameter === lensParameter && 'st-compact--lens')}
            />
          ))}
          <th scope="col" className="st-th st-th--last">
            <span className="sr-only">Otvori na mapi</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <StationTableRow
            key={row.id}
            row={row}
            index={index}
            bands={bands}
            lensParameter={lensParameter}
            current={row.id === currentId}
            latest={latest}
            onOpen={onOpen}
          />
        ))}
      </tbody>
    </table>
  );
}

function StationTableRow({
  row,
  index,
  bands,
  lensParameter,
  current,
  latest,
  onOpen,
}: {
  row: StationRow;
  index: number;
  bands: number;
  lensParameter: Parameter | null;
  current: boolean;
  latest: Date | null;
  onOpen: (stationId: string) => void;
}) {
  const { view, reading } = row;
  const stale = isStaleGroup(row.group);
  // Za „Najlošiji“ je istaknut dominantni polutant reda, inače polutant sočiva.
  const emphasized = lensParameter ?? reading.parameter;
  return (
    <tr
      className={cn('st-row', index < 14 && 'st-row--enter')}
      style={{ ...rowTint(row), animationDelay: index < 14 ? `${index * 18}ms` : undefined }}
      data-stale={stale || undefined}
      data-current={current || undefined}
      onClick={() => onOpen(view.id)}
    >
      <td className="st-td st-td--first">
        <button type="button" title={view.station.name} className="st-name block max-w-full truncate text-left text-[14px] font-medium leading-5">
          {view.station.name}
          <span className="sr-only">{current ? ' (poslednja otvorena)' : ''}, otvori na mapi</span>
        </button>
        <StationMeta row={row} latest={latest} className="mt-0.5" />
      </td>
      <td className="st-td st-lens">
        <div className="flex items-center justify-between gap-3">
          <LensValue row={row} />
          <RowChip row={row} />
        </div>
        {reading.value !== null && reading.parameter ? (
          <LensBar parameter={reading.parameter} value={reading.value} rank={reading.category?.rank ?? null} bands={bands} muted={stale} delay={Math.min(index, 14) * 18} className="mt-2.5" />
        ) : (
          <span aria-hidden className="mt-2.5 block h-1.5 rounded-full border border-dashed border-border-strong" />
        )}
      </td>
      <td className="st-td">
        <div className="flex items-center gap-3">
          <TrendSpark row={row} className="w-[64px] shrink-0" />
          <DeltaInline row={row} />
        </div>
      </td>
      {PARAMETERS.map((parameter) => (
        <td key={parameter} className={cn('st-td st-compact text-right', parameter === lensParameter && 'st-compact--lens')}>
          <PollutantValue row={row} parameter={parameter} emphasized={parameter === emphasized} />
        </td>
      ))}
      <td className="st-td st-td--last text-right">
        <ArrowUpRight aria-hidden className="st-go ml-auto size-4" />
      </td>
    </tr>
  );
}
