import { ArrowRight } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { HeatGrid, NotLoadedNote, type HeatGridCell, type HeatGridColumn, type HeatGridRow } from '@/components/charts/HeatGrid';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { CategoryChip } from '@/components/ui/Category';
import { EmptyNote, ErrorBanner } from '@/components/ui/Feedback';
import { LensScope } from '@/components/ui/LensScope';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMeasure } from '@/hooks/useMeasure';
import { CATEGORIES, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatDayLong, formatDayShort, formatInt, pluralSr } from '@/lib/format';
import { lensLabel, okrugLabel, okrugOf, scopeLabel } from '@/lib/insights';
import { historyCoverage } from '@/lib/syncRules';

import { PanelHead } from './PanelHead';
import { ALERT_RANK, calendarMatrix, calendarSentence, minCoveredHours, notLoadedDays, type CalendarRow } from './trendData';
import type { NetworkDaily } from './useNetworkDaily';

/**
 * „Kalendar · 30 dana“: stanice opsega (filter okruga) × dani, ćelija = dnevna SEPA
 * kategorija polutanta sočiva (kategorija najviše satne vrednosti; za „Najlošiji“ najgora
 * kategorija svih polutanata). Nepotpuni su današnji dan (kolona) i dani stanica sa manje od
 * 18 h merenja (ćelija) – šrafirani, i ne ulaze u brojeve ni u redosled.
 * Na uskom ekranu grafikon prikazuje poslednjih dana koliko staje (tabela uvek ima svih 30).
 */
export function StationCalendar({ daily, className, style }: { daily: NetworkDaily; className?: string; style?: CSSProperties }) {
  const { filteredViews, lens, okrug, openStation, navigate } = useAtmosfera();
  const { state, days: allDays, today } = daily;
  const [view, setView] = useState<View>('chart');
  const [wrapRef, { width }] = useMeasure<HTMLDivElement>();
  // Uski ekran: HeatGrid ima kolonu naziva od 100 px i ćelije od najmanje 8 px (+2 px razmaka),
  // pa grafikon prikazuje poslednjih dana koliko staje bez vodoravnog skrola; tabela ima sve.
  const fitting = width > 0 && width < 480 ? Math.max(14, Math.floor((width - 104) / 10)) : allDays.length;
  const days = useMemo(() => (view === 'chart' && fitting < allDays.length ? allDays.slice(-fitting) : allDays), [view, fitting, allDays]);
  const trimmed = days.length < allDays.length;
  // Redosled i sažetak uvek za ceo prozor od 30 dana; prikaz samo seče poslednje dane.
  const matrix = useMemo(
    () => (state.data ? calendarMatrix(state.data, allDays, filteredViews, lens, today) : null),
    [state.data, allDays, filteredViews, lens, today],
  );
  const offset = allDays.length - days.length;
  const byId = useMemo(() => new Map((matrix?.rows ?? []).map((row) => [row.id, row])), [matrix]);
  const dayIndex = useMemo(() => new Map(allDays.map((day, index) => [day, index])), [allDays]);
  const scope = scopeLabel(okrug);
  // Dani bez ijednog reda u bazi (cela mreža) – „nije učitano“, ne „nema merenja“.
  const notLoaded = useMemo(() => (state.data ? notLoadedDays(state.data, allDays, today) : new Set<string>()), [state.data, allDays, today]);
  // Dani koji su u bazi nepotpuni (pravilo sa Sinhronizacije): stanica bez reda tog dana možda
  // nije merila, a možda njen dan nije učitan – tooltip to kaže umesto „Nema merenja“.
  const incompleteDays = useMemo(
    () => new Set(state.data ? historyCoverage(state.data, today).days.filter((d) => d.status === 'partial').map((d) => d.day) : []),
    [state.data, today],
  );
  // Stanica-dani sa bar jednim redom (bilo koji polutant) na nepotpunim danima: bez reda je
  // ćelija „nije (potpuno) učitano“ (isprekidan okvir), ne siva „nema merenja“.
  const loadedOnIncomplete = useMemo(() => {
    const keys = new Set<string>();
    for (const stat of state.data ?? []) if (incompleteDays.has(stat.day)) keys.add(`${stat.station_id}|${stat.day}`);
    return keys;
  }, [state.data, incompleteDays]);

  const columns: HeatGridColumn[] = useMemo(
    () =>
      days.map((day) => ({
        key: day,
        label: day === today ? 'danas' : formatDayShort(day),
        title: day === today ? `${formatDayLong(day)} (danas)` : formatDayLong(day),
        partial: day === today,
        notLoaded: notLoaded.has(day),
      })),
    [days, today, notLoaded],
  );

  const rows: HeatGridRow[] = useMemo(
    () =>
      (matrix?.rows ?? []).map((row) => {
        const rowOkrug = okrugOf(row.view);
        return {
          id: row.id,
          label: row.view.station.name,
          sublabel: [row.view.station.municipality, rowOkrug ? okrugLabel(rowOkrug) : null].filter(Boolean).join(' · ') || row.view.station.code,
          cells: row.cells.slice(offset).map((cell, index) => {
            const day = allDays[offset + index];
            return {
              value: cell.value,
              rank: cell.rank,
              note: lens === 'worst' && cell.parameter ? PARAMETER_LABELS[cell.parameter] : undefined,
              partial: cell.short,
              notLoaded: incompleteDays.has(day) && !loadedOnIncomplete.has(`${row.id}|${day}`),
            };
          }),
        };
      }),
    [matrix, lens, offset, allDays, incompleteDays, loadedOnIncomplete],
  );

  const alertLabel = CATEGORIES[ALERT_RANK].label;
  const sentence = matrix ? calendarSentence(matrix.rows, alertLabel) : null;
  const shortDays = matrix ? matrix.rows.reduce((sum, row) => sum + row.shortDays, 0) : 0;
  const label = `Kalendar stanica, ${lensLabel(lens)}, ${scope}, poslednjih ${days.length} dana`;
  const hasGrid = state.status === 'ready' && matrix !== null && (matrix.rows.length > 0 || (state.data?.length ?? 0) > 0);

  const renderTooltip = (row: HeatGridRow, column: HeatGridColumn, cell: HeatGridCell) => {
    const index = dayIndex.get(column.key);
    const source: CalendarRow | undefined = byId.get(row.id);
    const day = index !== undefined ? source?.cells[index] : undefined;
    return (
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-ink">{row.label}</p>
        <p className="tnum font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
          {column.title ?? column.label}
          {!column.notLoaded && (column.partial || day?.short) ? ' · nepotpun dan' : ''}
        </p>
        {column.notLoaded ? (
          <NotLoadedNote />
        ) : cell.notLoaded ? (
          <p className="max-w-[230px] text-[11px] leading-4 text-muted">
            <span className="font-medium text-ink">Nema podataka u bazi</span> – ovaj dan je u bazi nepotpun, pa stanica možda nije merila, a možda njen dan nije učitan. Sinhronizacija → „Dopuni nedostajuće dane“.
          </p>
        ) : cell.value === null || cell.rank === null || !day ? (
          <p className="text-faint">Nema merenja</p>
        ) : (
          <>
            <p className="flex items-baseline gap-1">
              <span className="tnum text-sm font-semibold text-ink">{formatConcentration(cell.value)}</span>
              <span className="text-faint">{UNIT}</span>
              <span className="text-muted">· najviši sat{day.parameter ? `, ${PARAMETER_LABELS[day.parameter]}` : ''}</span>
            </p>
            {day.avg !== null ? (
              <p className="text-muted">
                Prosek dana <span className="tnum font-medium text-ink">{formatConcentration(day.avg)}</span> {UNIT}
                {day.hours > 0 && day.hours < 24 ? ` · ${formatInt(day.hours)} ${pluralSr(day.hours, 'sat', 'sata', 'sati')} merenja` : ''}
              </p>
            ) : null}
            <p className="mt-0.5">
              <CategoryChip category={categoryOf(cell.rank)} size="sm" />
            </p>
            {day.short ? (
              <p className="max-w-[220px] text-[11px] leading-4 text-muted">
                Manje od {formatInt(minCoveredHours(column.key))} h merenja – ne ulazi u brojeve i redosled.
              </p>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <GlassPanel
      className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)}
      style={style}
      aria-labelledby="calendar-title"
      aria-busy={state.status === 'loading' || state.refreshing}
      data-testid="station-calendar"
    >
      <PanelHead
        id="calendar-title"
        eyebrow={<LensScope lens={lens} okrug={okrug} prefix={`${allDays.length} dana`} />}
        title="Kalendar stanica"
        actions={hasGrid ? <ViewToggle value={view} onChange={setView} label="Prikaz kalendara stanica" /> : undefined}
        lead={sentence}
        hint={
          <>
            {lens === 'worst'
              ? 'Ćelija je najgora dnevna kategorija stanice (najviša satna vrednost bilo kog polutanta).'
              : `Ćelija je dnevna kategorija ${PARAMETER_LABELS[lens]} (najviša satna vrednost tog dana).`}{' '}
            {shortDays > 0 ? `Šrafirani dani stanica imaju manje od 18 h merenja i ne broje se (${formatInt(shortDays)}). ` : ''}
            {notLoaded.size > 0
              ? `${formatInt(notLoaded.size)} ${pluralSr(notLoaded.size, 'dan nije učitan', 'dana nisu učitana', 'dana nije učitano')} u bazu${days.some((day) => notLoaded.has(day)) ? ' (prazni okviri)' : ''}. `
              : ''}
            Klik na red otvara stanicu na mapi.
          </>
        }
      />
      <div ref={wrapRef} className={cn('transition-opacity duration-200', state.refreshing && 'opacity-60')}>
        {state.status === 'loading' ? (
          <CalendarSkeleton />
        ) : state.status === 'error' ? (
          <ErrorBanner title="Kalendar nije učitan" message={state.error ?? 'Nepoznata greška'} onRetry={state.reload} />
        ) : !matrix || (matrix.rows.length === 0 && (state.data?.length ?? 0) === 0) ? (
          <EmptyNote className="flex-wrap">
            Još nema dnevne statistike.{' '}
            <button
              type="button"
              onClick={() => navigate('sinhronizacija')}
              className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline"
            >
              Dopuni istoriju na Sinhronizaciji <ArrowRight aria-hidden className="size-3.5" />
            </button>
          </EmptyNote>
        ) : (
          <HeatGrid
            rows={rows}
            columns={columns}
            label={label}
            unit={UNIT}
            onRowSelect={openStation}
            renderTooltip={renderTooltip}
            formatValue={formatConcentration}
            partialLabel={shortDays > 0 ? 'nepotpun dan (danas ili < 18 h merenja)' : 'danas – nepotpun dan'}
            view={view}
            onViewChange={setView}
            showToggle={false}
            emptyText={
              lens === 'worst'
                ? `Nema dnevne statistike za ${scope}.`
                : `Nema dnevne statistike ${PARAMETER_LABELS[lens]} za ${scope}.`
            }
            data-testid="calendar-heatmap"
          />
        )}
      </div>
      {trimmed && hasGrid && matrix.rows.length > 0 ? (
        <p className="-mt-1 text-xs text-muted">
          Na uskom ekranu prikazano je poslednjih {formatInt(days.length)} dana; svih {formatInt(allDays.length)} dana je u prikazu „Tabela“.
        </p>
      ) : null}
      {matrix && matrix.missing > 0 && matrix.rows.length > 0 ? (
        <p className="-mt-1 text-xs text-faint">
          Nije prikazano (bez {lens === 'worst' ? 'dnevne statistike' : `dnevne statistike ${PARAMETER_LABELS[lens]}`} u ovom periodu):{' '}
          {formatInt(matrix.missing)} {pluralSr(matrix.missing, 'stanica', 'stanice', 'stanica')}.
        </p>
      ) : null}
    </GlassPanel>
  );
}

/** Skelet mreže dok se dnevna statistika prvi put učitava. */
function CalendarSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-[2px]">
      <div className="mb-1 h-4" />
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="skeleton h-3 w-[92px] shrink-0 sm:w-[148px]" style={{ opacity: 1 - i * 0.06 }} />
          <div className="skeleton h-[18px] flex-1 !rounded-[3px] sm:h-[22px]" style={{ opacity: 1 - i * 0.06 }} />
        </div>
      ))}
    </div>
  );
}
