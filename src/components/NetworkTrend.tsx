import { ArrowRight } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';

import { CATEGORIES, PARAMETER_LABELS } from '@shared/aqi';

import { CategoryLegend } from '@/components/charts/CategoryLegend';
import { NOT_LOADED, NotLoadedKey } from '@/components/charts/HeatGrid';
import { NetworkTrendChart, NetworkTrendTable } from '@/components/charts/NetworkTrendChart';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { PanelHead } from '@/components/trends/PanelHead';
import { ALERT_RANK, notLoadedDays, pollutedInsight, pollutedSentence, scopedDayCounts, trendSummary } from '@/components/trends/trendData';
import type { NetworkDaily } from '@/components/trends/useNetworkDaily';
import { EmptyNote, ErrorBanner } from '@/components/ui/Feedback';
import { LensScope } from '@/components/ui/LensScope';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { formatInt, pluralSr } from '@/lib/format';
import { lensLabel, scopeLabel } from '@/lib/insights';

export interface NetworkTrendProps {
  /** Dnevna statistika mreže (jedan upit za celu stranicu, vidi `useNetworkDaily`). */
  daily: NetworkDaily;
  className?: string;
  style?: CSSProperties;
}

/**
 * „Trend mreže · 30 dana“: udeo stanica po dnevnoj SEPA kategoriji, kroz sočivo polutanta
 * („Najlošiji“ = najgora kategorija svih polutanata) i filter okruga, sa izračunatom
 * rečenicom (udeo „Zagađen“ ili lošije juče i prosek završenih dana). Završeni dani broje
 * samo pokrivene dane stanica (≥ 18 h merenja). Prekidač prikazuje tabelarnog blizanca.
 */
export function NetworkTrend({ daily, className, style }: NetworkTrendProps) {
  const { filteredViews, okrug, lens, navigate } = useAtmosfera();
  const [view, setView] = useState<View>('chart');
  const { state, days, today } = daily;
  const stationIds = useMemo(() => (okrug ? new Set(filteredViews.map((v) => v.id)) : null), [okrug, filteredViews]);
  const rows = useMemo(() => {
    if (!state.data) return [];
    // Dani bez ijednog reda u bazi (cela mreža, ne okrug): „nije učitano“, ne „nema podataka“.
    const notLoaded = notLoadedDays(state.data, days, today);
    return scopedDayCounts(state.data, days, stationIds, lens, today).map((row) => (notLoaded.has(row.day) ? { ...row, notLoaded: true } : row));
  }, [state.data, days, stationIds, lens, today]);
  const notLoadedCount = rows.filter((row) => row.notLoaded).length;
  const hasAny = rows.some((r) => r.total > 0);
  const lead = useMemo(() => pollutedSentence(pollutedInsight(rows, today), today, CATEGORIES[ALERT_RANK].label), [rows, today]);
  const excluded = useMemo(() => trendSummary(rows, today).shortStationDays, [rows, today]);
  /** Završen dan u kom nijedna stanica nema pokriven dan – crta se šrafirana senka stuba. */
  const shortOnly = rows.some((row) => row.day !== today && row.total === 0 && (row.short ?? 0) > 0);
  const scope = scopeLabel(okrug);
  const chartLabel = `Udeo stanica po dnevnoj SEPA kategoriji, ${lensLabel(lens)}, ${scope}`;

  return (
    <GlassPanel
      className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)}
      style={style}
      aria-labelledby="network-trend-title"
      aria-busy={state.status === 'loading' || state.refreshing}
      data-testid="network-trend"
    >
      <PanelHead
        id="network-trend-title"
        eyebrow={<LensScope lens={lens} okrug={okrug} prefix={`${days.length} dana`} />}
        title="Trend mreže"
        actions={<ViewToggle value={view} onChange={setView} label="Prikaz trenda mreže" />}
        lead={state.status === 'ready' && hasAny ? lead : null}
        hint={
          <>
            {lens === 'worst'
              ? 'Stub je udeo stanica po najgoroj dnevnoj kategoriji (najviša satna vrednost bilo kog polutanta).'
              : `Stub je udeo stanica po dnevnoj kategoriji ${PARAMETER_LABELS[lens]} (najviša satna vrednost tog dana).`}
            {excluded > 0 ? ` Dani stanica sa manje od 18 h merenja nisu uračunati: ${formatInt(excluded)}.` : ''}
            {notLoadedCount > 0
              ? ` ${formatInt(notLoadedCount)} ${pluralSr(notLoadedCount, 'dan nije učitan', 'dana nisu učitana', 'dana nije učitano')} u bazu (prazni okviri).`
              : ''}
            {/* Samo uz miš i tastaturu (precizan pokazivač); na dodir se dan bira tapom. */}
            <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline"> Strelice ←/→ biraju dan.</span>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <CategoryLegend partialDay partialLabel={shortOnly ? 'nepotpun dan (danas ili < 18 h)' : undefined} />
        {notLoadedCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <NotLoadedKey />
            {NOT_LOADED}
          </span>
        ) : null}
      </div>
      <div className={cn('transition-opacity duration-200', state.refreshing && 'opacity-60')}>
        {state.status === 'loading' ? (
          <TrendSkeleton />
        ) : state.status === 'error' ? (
          <ErrorBanner title="Trend mreže nije učitan" message={state.error ?? 'Nepoznata greška'} onRetry={state.reload} />
        ) : !hasAny ? (
          <EmptyNote className="flex-wrap">
            {okrug ? `Nema dnevne statistike za ${scope}.` : 'Još nema dnevne statistike.'}{' '}
            <button
              type="button"
              onClick={() => navigate('sinhronizacija')}
              className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline"
            >
              Dopuni istoriju na Sinhronizaciji <ArrowRight aria-hidden className="size-3.5" />
            </button>
          </EmptyNote>
        ) : view === 'chart' ? (
          <NetworkTrendChart rows={rows} today={today} label={chartLabel} />
        ) : (
          <NetworkTrendTable rows={rows} today={today} label={chartLabel} />
        )}
      </div>
    </GlassPanel>
  );
}

/** Skelet u obliku stubova (dok se dnevna statistika prvi put učitava). */
function TrendSkeleton() {
  const heights = [62, 70, 58, 76, 66, 80, 72, 64, 74, 68, 78, 60, 70, 82, 66, 72, 58, 76, 70, 64, 80, 74, 68, 62, 78, 70, 66, 72, 76, 60];
  return (
    <div aria-hidden className="flex h-[236px] items-end gap-[2px] pb-[26px] pl-10">
      {heights.map((h, i) => (
        <div key={i} className="skeleton flex-1 !rounded-b-none !rounded-t-[4px]" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
