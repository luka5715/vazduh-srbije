import { useMemo, useState, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { HeatGrid, type HeatGridColumn, type HeatGridRow } from '@/components/charts/HeatGrid';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { SectionHeader } from '@/components/ui/Card';
import { LensScope } from '@/components/ui/LensScope';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMeasure } from '@/hooks/useMeasure';
import { CATEGORIES } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatDateTime, formatHourAt, formatInt, formatTime, pluralSr } from '@/lib/format';
import { lensLabel, okrugLabel, okrugOf, scopeLabel, stationHourMatrix } from '@/lib/insights';

import { rhythmSummary, sharedWordPrefix } from './overviewText';

/** Prag za sažetak ritma: kategorija „Zagađen“ ili lošija. */
const ALERT_RANK = 3;
/** Uski ekran HeatGrid-a (kolona naziva 100 px, ćelija ≥ 8 px + razmak 2 px). */
const NARROW_PX = 480;
const NARROW_LABEL_PX = 104;
const NARROW_COLUMN_PX = 10;
/** Najmanje sati na uskom ekranu (ispod toga mreža gubi smisao ritma dana). */
const MIN_HOURS = 12;

/**
 * „Ritam mreže · 24 h“: stanice (filter okruga, najlošije gore) × poslednja 24 sata,
 * ćelija = SEPA kategorija polutanta sočiva (za „Najlošiji“ najgora kategorija u tom satu).
 * Iznad mreže je jedna rečenica sažetka: koliko stanica je prešlo u „Zagađen“ i kada najviše.
 * Na uskom ekranu grafikon prikazuje poslednjih sati koliko staje (najnoviji sat je uvek
 * vidljiv); tabela ima svih 24. Stanice koje ne mere polutant sočiva nisu prazni redovi.
 */
export function NetworkRhythm({ className, style }: { className?: string; style?: CSSProperties }) {
  const { views, filteredViews, lens, okrug, openStation, now } = useAtmosfera();
  const namePrefix = useMemo(() => sharedWordPrefix(views.map((view) => view.station.name)), [views]);
  const matrix = useMemo(() => stationHourMatrix(filteredViews, lens), [filteredViews, lens]);
  const [view, setView] = useState<View>('chart');
  const [wrapRef, { width }] = useMeasure<HTMLDivElement>();

  const total = matrix.hours.length;
  const fitting = width > 0 && width < NARROW_PX ? Math.max(MIN_HOURS, Math.floor((width - NARROW_LABEL_PX) / NARROW_COLUMN_PX)) : total;
  const shown = view === 'chart' ? Math.min(total, fitting) : total;
  const offset = total - shown;
  const trimmed = shown < total;

  const allColumns: HeatGridColumn[] = useMemo(
    () =>
      matrix.hours.map((hour) => ({
        key: hour.toISOString(),
        label: formatTime(hour).slice(0, 2),
        title: formatDateTime(hour),
      })),
    [matrix.hours],
  );
  const allRows: HeatGridRow[] = useMemo(
    () =>
      matrix.rows.map((row) => {
        const rowOkrug = okrugOf(row.view);
        return {
          id: row.id,
          label: row.view.station.name,
          shortLabel: namePrefix && row.view.station.name.startsWith(namePrefix) ? row.view.station.name.slice(namePrefix.length) : undefined,
          sublabel: [row.view.station.municipality, rowOkrug ? okrugLabel(rowOkrug) : null].filter(Boolean).join(' · ') || row.view.station.code,
          cells: row.cells.map((cell) => ({
            value: cell.value,
            rank: cell.category?.rank ?? null,
            note: lens === 'worst' && cell.parameter ? PARAMETER_LABELS[cell.parameter] : undefined,
          })),
        };
      }),
    [matrix.rows, lens, namePrefix],
  );
  // Prikaz seče najnovije sate sa kraja; sažetak i redosled uvek važe za sva 24 sata.
  const columns = useMemo(() => (offset ? allColumns.slice(offset) : allColumns), [allColumns, offset]);
  const rows = useMemo(() => (offset ? allRows.map((row) => ({ ...row, cells: row.cells.slice(offset) })) : allRows), [allRows, offset]);

  const summary = rhythmSummary(allRows, ALERT_RANK);
  const threshold = `„${CATEGORIES[ALERT_RANK].label}“ ili lošijoj`;
  const lead =
    allRows.length === 0
      ? null
      : summary.stations > 0 && summary.peakIndex !== null
        ? `${formatInt(summary.stations)} ${pluralSr(summary.stations, 'stanica je bar jednom bila', 'stanice su bar jednom bile', 'stanica je bar jednom bilo')} u kategoriji ${threshold}; najviše u ${formatHourAt(matrix.hours[summary.peakIndex], now)} (${formatInt(summary.peakCount)} ${pluralSr(summary.peakCount, 'stanica', 'stanice', 'stanica')}).`
        : `Nijedna stanica nije bila u kategoriji ${threshold} u poslednja 24 sata.`;

  return (
    <GlassPanel className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby="rhythm-title">
      <SectionHeader
        id="rhythm-title"
        eyebrow={<LensScope lens={lens} okrug={okrug} prefix="24 h" />}
        actions={allRows.length ? <ViewToggle value={view} onChange={setView} label="Prikaz ritma mreže" /> : undefined}
        title="Ritam mreže"
        hint={
          <>
            {lead ? <span className="block text-ink">{lead}</span> : null}
            <span className="block">
              {lens === 'worst' ? 'Ćelija je najgora kategorija stanice u tom satu (bilo koji polutant).' : `Ćelija je satna kategorija ${lensLabel(lens)}.`}{' '}
              Klik na red otvara stanicu na mapi.
            </span>
          </>
        }
      />
      <div ref={wrapRef}>
        <HeatGrid
          rows={rows}
          columns={columns}
          label={`Ritam mreže, ${lensLabel(lens)}, ${scopeLabel(okrug)}, ${trimmed ? `poslednjih ${formatInt(shown)} ${pluralSr(shown, 'sat', 'sata', 'sati')}` : 'poslednja 24 sata'}`}
          unit={UNIT}
          onRowSelect={openStation}
          cellHeight={18}
          view={view}
          onViewChange={setView}
          showToggle={false}
          emptyText={
            matrix.missing > 0 && lens !== 'worst'
              ? `Nijedna sveža stanica${okrug ? ` u okrugu (${okrugLabel(okrug)})` : ''} ne meri ${lensLabel(lens)}.`
              : okrug
                ? `Nema satnih serija svežih stanica u okrugu (${okrugLabel(okrug)}).`
                : 'Nema satnih serija svežih stanica.'
          }
          data-testid="network-rhythm"
        />
      </div>
      {trimmed && allRows.length > 0 ? (
        <p className="-mt-1 text-xs text-muted">
          Na uskom ekranu prikazano je poslednjih {formatInt(shown)} {pluralSr(shown, 'sat', 'sata', 'sati')}; sva {formatInt(total)} su u prikazu „Tabela“.
        </p>
      ) : null}
      {matrix.missing > 0 && allRows.length > 0 ? (
        <p className="-mt-1 text-xs text-faint">
          {formatInt(matrix.missing)} {pluralSr(matrix.missing, 'stanica ne meri', 'stanice ne mere', 'stanica ne meri')} {lensLabel(lens)} – {pluralSr(matrix.missing, 'nije prikazana', 'nisu prikazane', 'nisu prikazane')}.
        </p>
      ) : null}
    </GlassPanel>
  );
}
