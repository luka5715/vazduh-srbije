import '@/styles/stanice.css';

import { SearchX } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { StationTable } from '@/components/StationTable';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { LinkNotice } from '@/components/map/LinkNotice';
import { StationCards } from '@/components/stations/StationCards';
import { StationsToolbar } from '@/components/stations/StationsToolbar';
import {
  bandsFor,
  buildStationRows,
  encodeGroup,
  encodeSort,
  groupCounts,
  groupLabel,
  nextSort,
  parseGroup,
  parseSort,
  searchRows,
  sortRows,
  statusSummary,
  type SortKey,
  type SortState,
  type StationGroup,
} from '@/components/stations/stationRows';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { GROUP_PARAM, INACTIVE_PARAM, OKRUG_PARAM, QUERY_PARAM, SORT_PARAM, useView } from '@/hooks/useView';
import { formatInt, pluralSr } from '@/lib/format';
import { lensLabel, stationsWithoutOkrug } from '@/lib/insights';
import { activeViews, isInactive } from '@/lib/stations';

/**
 * Stanice: sve stanice (filtrirane po okrugu) kroz sočivo polutanta – pretraga bez obzira
 * na kvačice, čipovi okruga, filter po kategoriji, sortiranje. Na širem prostoru tabela sa
 * lepljivim zaglavljem, na užem kartice. Izbor stanice je otvara na Mapi.
 *
 * Pretraga, filter kategorije, redosled i prikaz neaktivnih žive u URL-u (`?q=`, `?grupa=`,
 * `?sort=`, `?neaktivne=1`, zamenom unosa): „Nazad“ sa Mape vraća listu kakva je bila.
 * Neaktivne stanice (SEPA ih je ugasila) nisu na listi dok ih korisnik ne uključi.
 * Kartice bez filtera i pretrage: prvih 20 i „+N stanica“ (`cardSlice`); svaka promena
 * pretrage, okruga, grupe ili redosleda vraća listu na prvih 20.
 */
export function StationsView() {
  const { views, filteredViews, lens, okrug, okrugs, setOkrug, openStation, networkKpis } = useAtmosfera();
  const { stationParam, params, replaceParams } = useView();
  const latest = networkKpis.latestObservedAt;

  const query = params.get(QUERY_PARAM) ?? '';
  const sortValue = params.get(SORT_PARAM);
  const sort = useMemo(() => parseSort(sortValue), [sortValue]);
  const requestedGroup = parseGroup(params.get(GROUP_PARAM));
  const showInactive = params.get(INACTIVE_PARAM) === '1';
  const searchRef = useRef<HTMLInputElement>(null);

  const inactiveInScope = useMemo(() => filteredViews.filter(isInactive).length, [filteredViews]);
  const listed = useMemo(() => (showInactive ? filteredViews : activeViews(filteredViews)), [showInactive, filteredViews]);
  // Brojevi na čipovima okruga prate istu listu (sa neaktivnima samo kad su uključene).
  const chipViews = useMemo(() => (showInactive ? views : activeViews(views)), [showInactive, views]);
  const withoutOkrug = useMemo(() => stationsWithoutOkrug(views), [views]);

  const rows = useMemo(() => buildStationRows(listed, lens, latest), [listed, lens, latest]);
  const bands = useMemo(() => bandsFor(rows), [rows]);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const status = useMemo(() => statusSummary(rows), [rows]);
  // Grupa iz URL-a važi dok u njoj ima stanica (promena sočiva je uklanja – vidi useView).
  const activeGroup = requestedGroup !== null && counts.some((entry) => entry.group === requestedGroup) ? requestedGroup : null;

  const searched = useMemo(() => searchRows(rows, query), [rows, query]);
  const visible = useMemo(
    () => sortRows(activeGroup === null ? searched.rows : searched.rows.filter((row) => row.group === activeGroup), sort),
    [searched, activeGroup, sort],
  );

  const filtersActive = query.trim() !== '' || activeGroup !== null || okrug !== null;
  // „+N stanica“ važi za jednu listu: svaka promena pretrage/okruga/grupe/redosleda je sklapa
  // (stanje izvedeno iz ključa liste – postavlja se tokom rendera, pa nema kadra sa svim karticama).
  const listKey = `${query}|${okrug ?? ''}|${activeGroup ?? ''}|${sortValue ?? ''}|${showInactive ? 1 : 0}`;
  const [expansion, setExpansion] = useState({ key: listKey, expanded: false });
  if (expansion.key !== listKey) setExpansion({ key: listKey, expanded: false });
  const cardsExpanded = expansion.key === listKey && expansion.expanded;
  const toggleCards = useCallback(() => setExpansion((current) => ({ key: listKey, expanded: !(current.key === listKey && current.expanded) })), [listKey]);
  // Jedan upis u URL (vidi `replaceParams`): okrug, pretraga i grupa se brišu zajedno.
  const resetFilters = useCallback(() => replaceParams({ [QUERY_PARAM]: null, [GROUP_PARAM]: null, [OKRUG_PARAM]: null }), [replaceParams]);
  const setQuery = useCallback((value: string) => replaceParams({ [QUERY_PARAM]: value || null }), [replaceParams]);
  const setSort = useCallback((next: SortState) => replaceParams({ [SORT_PARAM]: encodeSort(next) }), [replaceParams]);
  const onSort = useCallback((key: SortKey) => setSort(nextSort(sort, key)), [setSort, sort]);
  const onToggleGroup = useCallback(
    (group: StationGroup) => replaceParams({ [GROUP_PARAM]: activeGroup === group ? null : encodeGroup(group) }),
    [replaceParams, activeGroup],
  );
  const onToggleInactive = useCallback(
    () =>
      replaceParams({
        [INACTIVE_PARAM]: showInactive ? null : '1',
        // Sakrivanje neaktivnih uklanja i filter „Neaktivne“.
        ...(showInactive && requestedGroup === 'inactive' ? { [GROUP_PARAM]: null } : null),
      }),
    [replaceParams, showInactive, requestedGroup],
  );
  const openFirst = () => {
    if (query.trim() && visible[0]) openStation(visible[0].id);
  };

  const emptyText = query.trim()
    ? `Nijedna stanica ne odgovara pretrazi „${query.trim()}“${activeGroup !== null ? ` u grupi „${groupLabel(activeGroup)}“` : ''}.`
    : activeGroup !== null
      ? `Nijedna stanica nije u grupi „${groupLabel(activeGroup)}“ (${lensLabel(lens)}).`
      : inactiveInScope > 0 && !showInactive
        ? `Nema aktivnih stanica za izabrani okrug (${formatInt(inactiveInScope)} ${pluralSr(inactiveInScope, 'neaktivna je sakrivena', 'neaktivne su sakrivene', 'neaktivnih je sakriveno')}).`
        : 'Nema stanica za izabrani okrug.';

  return (
    <div data-testid="view-stanice" className="@container flex flex-col gap-4 lg:gap-5">
      <LinkNotice />
      <StationsToolbar
        lens={lens}
        okrug={okrug}
        okrugs={okrugs}
        onOkrugChange={setOkrug}
        allViews={chipViews}
        status={status}
        inactiveInScope={inactiveInScope}
        showInactive={showInactive}
        onToggleInactive={onToggleInactive}
        withoutOkrug={withoutOkrug}
        shown={visible.length}
        latest={latest}
        query={query}
        onQueryChange={setQuery}
        onSubmitQuery={openFirst}
        searchRef={searchRef}
        counts={counts}
        activeGroup={activeGroup}
        onToggleGroup={onToggleGroup}
        sort={sort}
        onSortChange={setSort}
        filtersActive={filtersActive}
        onReset={resetFilters}
      />

      {searched.loose && visible.length > 0 ? (
        <p className="-mt-1 px-1 text-xs text-muted" role="status">
          Nema tačnih poklapanja za „{query.trim()}“ – prikazana su približna (slova istim redom).
        </p>
      ) : null}

      {visible.length === 0 ? (
        <GlassPanel variant="tile" as="div" className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="status">
          <SearchX aria-hidden className="size-6 text-faint" />
          <p className="max-w-md text-sm text-muted">{emptyText}</p>
          {filtersActive ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-9 items-center rounded-full border border-border-strong px-4 text-[13px] font-medium text-ink transition-colors hover:bg-card-2"
            >
              Poništi filtere
            </button>
          ) : null}
        </GlassPanel>
      ) : (
        <>
          <GlassPanel as="div" className="st-table-panel hidden overflow-clip @3xl:block" spotlight={false}>
            <StationTable
              rows={visible}
              lens={lens}
              bands={bands}
              sort={sort}
              onSort={onSort}
              onOpen={openStation}
              currentId={stationParam}
              latest={latest}
            />
          </GlassPanel>
          <StationCards
            rows={visible}
            lens={lens}
            bands={bands}
            onOpen={openStation}
            currentId={stationParam}
            latest={latest}
            limit={{ capped: !filtersActive, expanded: cardsExpanded, onToggle: toggleCards }}
            className="@3xl:hidden"
          />
        </>
      )}
    </div>
  );
}
