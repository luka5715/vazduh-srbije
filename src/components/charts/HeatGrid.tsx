import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

import { CategoryLegend, PARTIAL_HATCH, PARTIAL_OUTLINE } from '@/components/charts/CategoryLegend';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { columnLabelOffsets, HEAT_GAP as GAP, LABEL_CHAR_PX, LABEL_CHAR_PX_PHONE } from '@/components/charts/heatGridLabels';
import { catInkVar, DOT_RANK } from '@/components/charts/marks';
import { useDismissOutside } from '@/components/charts/useTouchInspect';
import { CategoryDot } from '@/components/ui/Category';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useMeasure } from '@/hooks/useMeasure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { catVar, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, pluralSr } from '@/lib/format';

export interface HeatGridColumn {
  key: string;
  /** Kratka oznaka ose (npr. „07“ ili „06. 10.“); oznake se proređuju da se ne sudaraju. */
  label: string;
  /** Pun opis za tooltip i tabelu (npr. „07:00“ ili „06. 10. 2026.“). */
  title?: string;
  /** Nepotpuna kolona (npr. današnji dan) – ćelije imaju šrafuru i isprekidan obris (vidi legendu). */
  partial?: boolean;
  /**
   * Za kolonu u bazi nema nijednog reda (npr. dan istorije koji nije učitan): ćelije su prazni
   * isprekidani okviri „nije učitano“ – drugačije od „nema merenja“ (red postoji, vrednosti nema).
   */
  notLoaded?: boolean;
}

export interface HeatGridCell {
  /** Vrednost (µg/m³) ili null kad nema merenja. */
  value: number | null;
  /** SEPA kategorija 0–5 (boja ćelije) ili null. */
  rank: number | null;
  /** Dodatna napomena u tooltip-u i tabeli (npr. polutant koji određuje kategoriju). */
  note?: string;
  /** Nepotpuna ćelija (npr. dan stanice sa manje od 18 h merenja) – šrafura kao nepotpuna kolona. */
  partial?: boolean;
  /**
   * Ćelija bez reda u bazi na danu koji je u bazi nepotpun (deo stanica učitan): isti prazan
   * isprekidan okvir kao kolona „nije učitano“, ne siva „nema merenja“ – stanica možda nije
   * merila, a možda njen dan nije učitan.
   */
  notLoaded?: boolean;
}

export interface HeatGridRow {
  id: string;
  label: string;
  /** Kraći naziv za uske ekrane (podrazumevano `label` bez zajedničkog početka svih redova). */
  shortLabel?: string;
  /** Sitniji tekst ispod/uz naziv (opština, šifra). */
  sublabel?: string;
  /** Tačno `columns.length` ćelija. */
  cells: HeatGridCell[];
}

export interface HeatGridProps {
  rows: HeatGridRow[];
  columns: HeatGridColumn[];
  /** Naziv grafikona za čitače ekrana i natpis tabele (npr. „Ritam mreže, PM10, poslednja 24 sata“). */
  label: string;
  unit?: string;
  /** Formatiranje vrednosti (podrazumevano koncentracija: 1 decimala ispod 100, vidi `formatConcentration`). */
  formatValue?: (value: number) => string;
  /** Broj redova pre dugmeta „+N“ (podrazumevano 14). */
  maxRows?: number;
  /** Klik na red ili Enter na ćeliji (npr. otvaranje stanice); na dodir tek drugi tap na istu ćeliju. */
  onRowSelect?: (rowId: string) => void;
  /** Kontrolisan prikaz grafikon/tabela; bez `view` komponenta ima sopstveni prekidač. */
  view?: View;
  onViewChange?: (view: View) => void;
  /** Prekidač grafikon/tabela u traci iznad mreže (podrazumevano kad prikaz nije kontrolisan). */
  showToggle?: boolean;
  /** Legenda SEPA kategorija (podrazumevano da). */
  showLegend?: boolean;
  /** Natpis nepotpunog perioda u legendi (podrazumevano „danas – nepotpun dan“). */
  partialLabel?: string;
  /** Imenica za redove u dugmetu „+N“: [1, 2–4, 5+] (podrazumevano stanica/stanice/stanica). */
  rowNoun?: [string, string, string];
  /** Visina ćelije u px (podrazumevano 22; na uskim ekranima 18; uz grub pokazivač – dodir – bar 24). */
  cellHeight?: number;
  /** Sopstveni sadržaj tooltip-a. */
  renderTooltip?: (row: HeatGridRow, column: HeatGridColumn, cell: HeatGridCell) => ReactNode;
  emptyText?: string;
  className?: string;
  'data-testid'?: string;
}

interface Position {
  r: number;
  c: number;
}

const MIN_CELL = 8;
/** Visina reda uz grub pokazivač (dodir): veća meta za prst. */
const TOUCH_ROW = 24;
/** Širina blagog prelaza na levoj ivici pokrivača lepljive kolone (px). */
const COVER_FADE = 8;

/** Dodir ili olovka: tap prvo pokazuje vrednost, drugi tap na istu ćeliju otvara red. */
const isTouchLike = (pointerType: string) => pointerType === 'touch' || pointerType === 'pen';

/**
 * Pristupačna toplotna mapa (redovi × kolone) u SEPA kategorijama: ćelije sa razmakom od 2 px,
 * lepljivi nazivi redova, proređene oznake kolona (bez sudara), tooltip na hover i fokus,
 * kretanje strelicama (jedan tab-stop, „roving tabindex“), Enter otvara red, „+N“ proširuje
 * listu, a prekidač prikazuje tabelarnog blizanca. Tekst je u ink tokenima, boja nikad nije
 * jedini nosilac (tooltip i tabela imaju naziv kategorije), a ćelije „Zagađen“ ili lošije
 * imaju i centralnu tačku (čitljivo i bez razlikovanja boja). U režimu visokog kontrasta
 * (forced-colors) ćelije zadržavaju boje i dobijaju obris (vidi `.heat-cell` u main.css).
 *
 * Dodir: prvi tap na ćeliju je zakači i prikaže tooltip, drugi tap na istu ćeliju otvara red
 * (naziv reda otvara odmah); tap van mreže ili Esc briše izbor. Kad mreža ne staje u širinu,
 * vodoravni skrol počinje od najnovije kolone (desno).
 */
export function HeatGrid({
  rows,
  columns,
  label,
  unit,
  formatValue = (value) => formatConcentration(value),
  maxRows = 14,
  onRowSelect,
  view: controlledView,
  onViewChange,
  showToggle,
  showLegend = true,
  partialLabel,
  rowNoun = ['stanica', 'stanice', 'stanica'],
  cellHeight,
  renderTooltip,
  emptyText = 'Nema podataka za prikaz.',
  className,
  'data-testid': testId,
}: HeatGridProps) {
  const [ownView, setOwnView] = useState<View>('chart');
  const view = controlledView ?? ownView;
  const setView = (next: View) => {
    if (controlledView === undefined) setOwnView(next);
    onViewChange?.(next);
  };
  const toggleVisible = showToggle ?? controlledView === undefined;

  const [expanded, setExpanded] = useState(false);
  const [wrapRef, size] = useMeasure<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Position>({ r: 0, c: Math.max(0, columns.length - 1) });
  const [hover, setHover] = useState<(Position & { x: number; y: number }) | null>(null);
  /** Ćelija zakačena dodirom (tooltip ostaje; drugi tap na nju otvara red). */
  const [pinned, setPinned] = useState<Position | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const pointerTypeRef = useRef('mouse');
  const moveFocusRef = useRef(false);
  const coarse = useMediaQuery('(pointer: coarse)');
  /** Oznake kolona su `tick-label`: 11 px ispod 640 px, 10 px od `sm` – procena širine znaka prati veličinu. */
  const smUp = useMediaQuery('(min-width: 40rem)', true);
  const labelCharPx = smUp ? LABEL_CHAR_PX : LABEL_CHAR_PX_PHONE;

  const visibleRows = expanded ? rows : rows.slice(0, maxRows);
  const hiddenCount = rows.length - visibleRows.length;
  const n = columns.length;
  const narrow = size.width > 0 && size.width < 480;
  const labelWidth = narrow ? 100 : 156;
  const prefix = useMemo(() => commonWordPrefix(rows.map((row) => row.label)), [rows]);
  const displayLabel = (row: HeatGridRow) => (narrow ? (row.shortLabel ?? (prefix ? row.label.slice(prefix.length) : row.label)) : row.label);
  const baseHeight = cellHeight ?? (narrow ? 18 : 22);
  const height = coarse ? Math.max(TOUCH_ROW, baseHeight) : baseHeight;
  const rawCell = n > 0 ? (size.width - labelWidth - GAP * n) / n : 0;
  const cellWidth = Math.max(MIN_CELL, rawCell);
  const overflowing = rawCell < MIN_CELL;
  const template = `${labelWidth}px repeat(${n}, minmax(${MIN_CELL}px, 1fr))`;
  /** Koliko je mreža odskrolovana (samo dok se preliva) – toliko ćelija prolazi ispod naziva. */
  const scrolled = overflowing ? scrollLeft : 0;
  const lastColumnKey = n > 0 ? columns[n - 1].key : '';

  // Kad mreža ne staje: skrol do desnog kraja (najnovija kolona vidljiva) pri montiranju,
  // promeni širine i promeni kolona. Stanje `scrollLeft` ažurira `onScroll`.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !overflowing || view !== 'chart') return;
    scroller.scrollLeft = scroller.scrollWidth;
  }, [overflowing, size.width, n, lastColumnKey, view]);

  const clearPin = () => {
    setPinned(null);
    setHover(null);
  };
  useDismissOutside(wrapRef, pinned !== null, clearPin);

  // Oznake kolona: svaka k-ta, poravnato tako da je poslednja (najnovija) uvek označena.
  const labelEvery = useMemo(() => {
    const longest = columns.reduce((max, column) => Math.max(max, column.label.length), 0);
    const needed = longest * labelCharPx + 8;
    return Math.max(1, Math.ceil(needed / (cellWidth + GAP)));
  }, [columns, cellWidth, labelCharPx]);
  const labelOffsets = useMemo(() => columnLabelOffsets(columns, cellWidth, labelEvery, labelCharPx), [columns, cellWidth, labelEvery, labelCharPx]);

  const hasPartial = columns.some((column) => column.partial) || rows.some((row) => row.cells.some((cell) => cell.partial));
  const hasCellNotLoaded = rows.some((row) => row.cells.some((cell) => cell.notLoaded));
  const hasNotLoaded = hasCellNotLoaded || columns.some((column) => column.notLoaded);
  const safeFocus: Position = {
    r: Math.min(focus.r, Math.max(0, visibleRows.length - 1)),
    c: Math.min(focus.c, Math.max(0, n - 1)),
  };

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-r="${safeFocus.r}"][data-c="${safeFocus.c}"]`);
    cell?.focus();
  }, [safeFocus.r, safeFocus.c]);

  const describe = (row: HeatGridRow, column: HeatGridColumn, cell: HeatGridCell) => {
    const when = column.title ?? column.label;
    if (column.notLoaded) return `${row.label}, ${when}: ${NOT_LOADED}`;
    if (cell.notLoaded) return `${row.label}, ${when}: ${NOT_LOADED_CELL}`;
    if (cell.value === null || cell.rank === null) return `${row.label}, ${when}: nema merenja`;
    const value = `${formatValue(cell.value)}${unit ? ` ${unit}` : ''}`;
    const note = cell.note ? `, ${cell.note}` : '';
    return `${row.label}, ${when}: ${value}, ${categoryOf(cell.rank).label}${note}${column.partial || cell.partial ? ', nepotpun period' : ''}`;
  };

  const showTooltipAt = (element: HTMLElement, position: Position) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setHover({ ...position, x: rect.left + rect.width / 2 - wrapRect.left, y: rect.top - wrapRect.top - 4 });
  };

  const positionFromEvent = (target: EventTarget | null): { element: HTMLElement; position: Position } | null => {
    const element = (target as HTMLElement | null)?.closest<HTMLElement>('[data-r][data-c]');
    if (!element) return null;
    return { element, position: { r: Number(element.dataset.r), c: Number(element.dataset.c) } };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Dodir bira ćeliju tapom (vidi `onCellClick`); prevlačenje prstom skroluje.
    if (event.pointerType === 'touch' || pinned) return;
    const hit = positionFromEvent(event.target);
    if (!hit) {
      setHover(null);
      return;
    }
    if (hover && hover.r === hit.position.r && hover.c === hit.position.c) return;
    showTooltipAt(hit.element, hit.position);
  };

  const onCellClick = (event: MouseEvent<HTMLDivElement>, row: HeatGridRow, position: Position) => {
    if (isTouchLike(pointerTypeRef.current)) {
      if (onRowSelect && pinned && pinned.r === position.r && pinned.c === position.c) {
        onRowSelect(row.id);
        return;
      }
      setPinned(position);
      showTooltipAt(event.currentTarget, position);
      return;
    }
    onRowSelect?.(row.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { r, c } = safeFocus;
    let next: Position | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = { r, c: Math.min(n - 1, c + 1) };
        break;
      case 'ArrowLeft':
        next = { r, c: Math.max(0, c - 1) };
        break;
      case 'ArrowDown':
        next = { r: Math.min(visibleRows.length - 1, r + 1), c };
        break;
      case 'ArrowUp':
        next = { r: Math.max(0, r - 1), c };
        break;
      case 'Home':
        next = { r: event.ctrlKey ? 0 : r, c: 0 };
        break;
      case 'End':
        next = { r: event.ctrlKey ? visibleRows.length - 1 : r, c: n - 1 };
        break;
      case 'Enter':
      case ' ':
        if (onRowSelect && visibleRows[r]) {
          event.preventDefault();
          onRowSelect(visibleRows[r].id);
        }
        return;
      case 'Escape':
        clearPin();
        return;
      default:
        return;
    }
    event.preventDefault();
    moveFocusRef.current = true;
    setFocus(next);
  };

  const hovered = hover ? { row: visibleRows[hover.r], column: columns[hover.c] } : null;
  const hoveredCell = hovered?.row?.cells[hover!.c];
  const noun = (count: number) => pluralSr(count, rowNoun[0], rowNoun[1], rowNoun[2]);

  return (
    <div ref={wrapRef} className={cn('relative flex flex-col gap-3', className)} data-testid={testId}>
      {showLegend || toggleVisible ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {showLegend ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <CategoryLegend partialDay={hasPartial} partialLabel={partialLabel} dotRank={DOT_RANK} />
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden data-mark className="inline-block size-2.5 rounded-[3px] bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]" />
                nema merenja
              </span>
              {hasNotLoaded ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <NotLoadedKey />
                  {hasCellNotLoaded ? NOT_LOADED_PARTLY : NOT_LOADED}
                </span>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          {toggleVisible ? <ViewToggle value={view} onChange={setView} label={`Prikaz: ${label}`} /> : null}
        </div>
      ) : null}

      {rows.length === 0 || n === 0 ? (
        <p className="rounded-tile border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted">{emptyText}</p>
      ) : view === 'table' ? (
        <HeatTable rows={visibleRows} columns={columns} label={label} unit={unit} formatValue={formatValue} narrow={narrow} displayLabel={displayLabel} />
      ) : (
        <div
          ref={scrollRef}
          className={cn('-mx-1 px-1 pb-1', overflowing && 'overflow-x-auto')}
          onScroll={(event) => {
            setScrollLeft(event.currentTarget.scrollLeft);
            // Tooltip je pozicioniran prema ćeliji – pri skrolu bi ostao na starom mestu.
            if (hover || pinned) clearPin();
          }}
        >
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${label}. Strelice pomeraju izbor${onRowSelect ? ', Enter otvara red' : ''}.`}
            aria-rowcount={rows.length + 1}
            aria-colcount={n + 1}
            className="flex flex-col"
            style={{ gap: GAP, minWidth: overflowing ? labelWidth + n * (MIN_CELL + GAP) : undefined }}
            onPointerDown={(event) => {
              pointerTypeRef.current = event.pointerType;
            }}
            onPointerMove={onPointerMove}
            onPointerLeave={(event) => {
              if (event.pointerType === 'touch' || pinned) return;
              setHover(null);
            }}
            onKeyDown={onKeyDown}
          >
            {/* Oznake kolona */}
            <div role="row" aria-rowindex={1} className="grid" style={{ gridTemplateColumns: template, columnGap: GAP }}>
              {/* Pri vodoravnom skrolu lepljiva ćelija pokriva oznake koje prolaze ispod naziva. */}
              <div role="columnheader" className={cn('relative', overflowing && 'sticky left-0 z-[1]')}>
                <StickyCover width={scrolled} max={labelWidth} />
                <span className="sr-only">Naziv</span>
              </div>
              {columns.map((column, c) => {
                const offset = labelOffsets[c];
                return (
                  <div key={column.key} role="columnheader" className="relative h-4">
                    <span className="sr-only">{column.title ?? column.label}</span>
                    {offset !== null ? (
                      <span
                        aria-hidden
                        className="tick-label absolute top-0 whitespace-nowrap leading-4 text-muted"
                        style={{ left: offset }}
                      >
                        {column.label}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {visibleRows.map((row, r) => (
              <div key={row.id} role="row" aria-rowindex={r + 2} className="group/row grid" style={{ gridTemplateColumns: template, columnGap: GAP }}>
                <div role="rowheader" className="sticky left-0 z-[1] flex min-w-0 items-center pr-2" style={{ height }}>
                  <StickyCover width={scrolled} max={labelWidth} />
                  {onRowSelect ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onRowSelect(row.id)}
                      title={row.sublabel ? `${row.label} · ${row.sublabel}` : row.label}
                      className="relative h-full w-full min-w-0 truncate text-left text-xs text-muted transition-colors hover:text-ink group-hover/row:text-ink"
                    >
                      {displayLabel(row)}
                    </button>
                  ) : (
                    <span className="relative min-w-0 truncate text-xs text-muted group-hover/row:text-ink" title={row.label}>
                      {displayLabel(row)}
                    </span>
                  )}
                </div>
                {row.cells.slice(0, n).map((cell, c) => {
                  const column = columns[c];
                  const isFocus = safeFocus.r === r && safeFocus.c === c;
                  const isHover = hover?.r === r && hover?.c === c;
                  const notLoaded = Boolean(column.notLoaded || cell.notLoaded);
                  const partial = !notLoaded && Boolean(column.partial || cell.partial);
                  const measured = !notLoaded && cell.rank !== null && cell.value !== null;
                  return (
                    <div
                      key={column.key}
                      role="gridcell"
                      data-r={r}
                      data-c={c}
                      data-mark
                      data-partial={partial || undefined}
                      data-not-loaded={notLoaded || undefined}
                      tabIndex={isFocus ? 0 : -1}
                      aria-label={describe(row, column, cell)}
                      onFocus={(event) => {
                        setFocus({ r, c });
                        showTooltipAt(event.currentTarget, { r, c });
                      }}
                      onBlur={() => {
                        setHover(null);
                        setPinned(null);
                      }}
                      onClick={(event) => onCellClick(event, row, { r, c })}
                      className={cn(
                        'heat-cell relative flex items-center justify-center rounded-[3px] transition-[box-shadow,filter] duration-100',
                        // Dvobojni prsten (površina + ink) – vidljiv i na svetlim i na tamnim ćelijama.
                        'focus-visible:z-[3] focus-visible:shadow-[0_0_0_2px_var(--panel-solid),0_0_0_4px_var(--ink)] focus-visible:outline-hidden',
                        onRowSelect && 'cursor-pointer',
                        partial && PARTIAL_OUTLINE,
                        notLoaded && NOT_LOADED_OUTLINE,
                        isHover && 'z-[2] shadow-[0_0_0_2px_var(--panel-solid),0_0_0_4px_var(--ink)] brightness-110',
                      )}
                      style={{
                        height,
                        backgroundColor: measured
                          ? catVar(cell.rank as number)
                          : notLoaded
                            ? 'transparent'
                            : 'color-mix(in oklab, var(--muted) 16%, transparent)',
                        backgroundImage: partial ? PARTIAL_HATCH : undefined,
                      }}
                    >
                      {/* „Zagađen“ ili lošije: tačka u mastilu kategorije – nosilac bez boje (CVD). */}
                      {measured && (cell.rank as number) >= DOT_RANK ? (
                        <span aria-hidden className="pointer-events-none size-1 shrink-0 rounded-full" style={{ backgroundColor: catInkVar(cell.rank as number) }} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {hiddenCount > 0 || expanded ? (
        rows.length > maxRows ? (
          <button
            type="button"
            onClick={() => {
              clearPin();
              setExpanded((value) => !value);
            }}
            aria-expanded={expanded}
            className="touch-target self-start rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-card-2"
          >
            {expanded ? 'Prikaži manje' : `+${hiddenCount} ${noun(hiddenCount)}`}
          </button>
        ) : null
      ) : null}

      {view === 'chart' && hover && hovered?.row && hovered.column && hoveredCell ? (
        <ChartTooltip x={hover.x} y={hover.y} containerWidth={size.width} placement="above">
          {renderTooltip ? (
            renderTooltip(hovered.row, hovered.column, hoveredCell)
          ) : (
            <DefaultTooltip row={hovered.row} column={hovered.column} cell={hoveredCell} unit={unit} formatValue={formatValue} />
          )}
          {onRowSelect && pinned && pinned.r === hover.r && pinned.c === hover.c ? (
            <p className="mt-1.5 border-t border-border pt-1 text-[11px] text-muted">Dodirnite ponovo za mapu</p>
          ) : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** Natpis dana bez ijednog reda dnevne statistike u bazi. */
export const NOT_LOADED = 'nije učitano';
/** Natpis legende kad postoje i ćelije bez reda na danu koji je u bazi nepotpun. */
const NOT_LOADED_PARTLY = 'nije (potpuno) učitano';
/** Ćelija bez reda u bazi na nepotpunom danu (vidi `HeatGridCell.notLoaded`). */
const NOT_LOADED_CELL = 'nema podataka u bazi – dan nije potpuno učitan';

/** Prazan isprekidan okvir „nije učitano“ (bez ispune – drugačije od sive „nema merenja“). */
export const NOT_LOADED_OUTLINE = 'outline-1 outline-dashed outline-faint -outline-offset-1';

/** Ključ legende za „nije učitano“: isti prazan isprekidan okvir kao ćelije. */
export function NotLoadedKey() {
  return <span aria-hidden data-mark className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', NOT_LOADED_OUTLINE)} />;
}

/** Tekst u tooltip-u dana koji nije učitan (deli ga i trend mreže). */
export function NotLoadedNote() {
  return (
    <p className="max-w-[230px] text-[11px] leading-4 text-muted">
      <span className="font-medium text-ink">Nije učitano</span> – baza nema dnevnu statistiku za ovaj dan. Sinhronizacija → „Dopuni nedostajuće dane“.
    </p>
  );
}

/**
 * Neprozirni pokrivač u lepljivoj koloni naziva, širok koliko je mreža odskrolovana (samo deo
 * ispod kog zaista prolaze ćelije): u mirovanju nema tamnijeg bloka iza naziva, a pri skrolu
 * ćelije ne prolaze ispod teksta. Produžen 2 px naniže preko razmaka između redova (neprekidan).
 */
function StickyCover({ width, max }: { width: number; max: number }) {
  if (width <= 0) return null;
  // Levo 8 px blagog prelaza (preko praznog dela), pa puna boja tačno koliko ćelije zalaze ispod.
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 -bottom-[2px]"
      style={{ width: Math.min(max, width + COVER_FADE), background: `linear-gradient(to right, transparent, var(--panel-solid) ${COVER_FADE}px)` }}
    />
  );
}

/** Zajednički početak naziva svih redova, po celim rečima (npr. „Demo stanica “); prazan kad ga nema. */
function commonWordPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  const split = labels.map((label) => label.split(' '));
  const words: string[] = [];
  for (let i = 0; i < split[0].length - 1; i++) {
    const word = split[0][i];
    if (split.every((parts) => parts.length > i + 1 && parts[i] === word)) words.push(word);
    else break;
  }
  return words.length ? `${words.join(' ')} ` : '';
}

function DefaultTooltip({
  row,
  column,
  cell,
  unit,
  formatValue,
}: {
  row: HeatGridRow;
  column: HeatGridColumn;
  cell: HeatGridCell;
  unit?: string;
  formatValue: (value: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold text-ink">{row.label}</p>
      <p className="tnum font-mono text-[11px] text-muted">
        {column.title ?? column.label}
        {!column.notLoaded && (column.partial || cell.partial) ? ' · nepotpun period' : ''}
      </p>
      {column.notLoaded ? (
        <NotLoadedNote />
      ) : cell.notLoaded ? (
        <p className="max-w-[230px] text-[11px] leading-4 text-muted">
          <span className="font-medium text-ink">Nema podataka u bazi</span> – dan nije potpuno učitan. Sinhronizacija → „Dopuni nedostajuće dane“.
        </p>
      ) : cell.value === null || cell.rank === null ? (
        <p className="text-faint">Nema merenja</p>
      ) : (
        <>
          <p className="flex items-baseline gap-1">
            <span className="tnum text-sm font-semibold text-ink">{formatValue(cell.value)}</span>
            {unit ? <span className="text-faint">{unit}</span> : null}
            {cell.note ? <span className="text-muted">· {cell.note}</span> : null}
          </p>
          <p className="flex items-center gap-1.5 text-ink">
            <CategoryDot rank={cell.rank} size={8} />
            {categoryOf(cell.rank).label}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Tabelarni blizanac toplotne mape (WCAG-ekvivalent): vrednost + tačka + naziv kategorije za čitače.
 * Na uskom ekranu kraći nazivi redova; tabela se otvara skrolovana do desnog kraja (najnovije kolone).
 */
function HeatTable({
  rows,
  columns,
  label,
  unit,
  formatValue,
  narrow,
  displayLabel,
}: {
  rows: HeatGridRow[];
  columns: HeatGridColumn[];
  label: string;
  unit?: string;
  formatValue: (value: number) => string;
  narrow: boolean;
  displayLabel: (row: HeatGridRow) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, []);
  const caption = `${label}${unit ? `, ${unit}` : ''}`;
  return (
    <div ref={scrollRef} tabIndex={0} role="region" aria-label={caption} className="max-h-[480px] overflow-auto rounded-tile border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          {label}
          {unit ? `, ${unit}` : ''}
        </caption>
        <thead className="sticky top-0 z-[2] bg-panel-solid text-muted">
          <tr>
            <th scope="col" className="sticky left-0 z-[3] bg-panel-solid px-2.5 py-2 text-left font-medium">
              Naziv
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn('tnum whitespace-nowrap py-2 text-right font-mono text-[11px] font-medium', narrow ? 'px-1.5' : 'px-2')}>
                {column.label}
                {column.partial ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <th
                scope="row"
                title={narrow ? row.label : undefined}
                className={cn('sticky left-0 z-[1] truncate bg-panel-solid px-2.5 py-1.5 text-left font-medium text-ink', narrow ? 'max-w-[120px]' : 'max-w-[180px]')}
              >
                {narrow ? displayLabel(row) : row.label}
              </th>
              {row.cells.slice(0, columns.length).map((cell, c) => (
                <td key={columns[c].key} className={cn('whitespace-nowrap py-1.5 text-right', narrow ? 'px-1.5' : 'px-2')} title={columns[c].notLoaded ? NOT_LOADED : cell.notLoaded ? NOT_LOADED_CELL : cell.note}>
                  {columns[c].notLoaded || cell.notLoaded ? (
                    <span className="text-faint">
                      <span aria-hidden>○</span>
                      <span className="sr-only">{columns[c].notLoaded ? NOT_LOADED : NOT_LOADED_CELL}</span>
                    </span>
                  ) : cell.value === null || cell.rank === null ? (
                    <span className="text-faint">–</span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1">
                      <span className="tnum text-ink">
                        {formatValue(cell.value)}
                        {cell.partial && !columns[c].partial ? '*' : ''}
                      </span>
                      <CategoryDot rank={cell.rank} size={7} />
                      <span className="sr-only">
                        {categoryOf(cell.rank).label}
                        {cell.partial ? ', nepotpun period' : ''}
                      </span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {columns.some((column) => column.partial) || rows.some((row) => row.cells.some((cell) => cell.partial)) ? (
        <p className="px-2.5 py-1.5 text-[11px] text-faint">* nepotpun period</p>
      ) : null}
      {columns.some((column) => column.notLoaded) || rows.some((row) => row.cells.some((cell) => cell.notLoaded)) ? (
        <p className="px-2.5 pb-1.5 text-[11px] text-faint">
          ○ {NOT_LOADED} – baza nema dnevnu statistiku za taj dan
          {rows.some((row) => row.cells.some((cell) => cell.notLoaded)) ? ' (ili za tu stanicu, kad je dan u bazi nepotpun)' : ''}
        </p>
      ) : null}
    </div>
  );
}
