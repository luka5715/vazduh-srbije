import { Check, CornerDownLeft, Eye, History, ListFilter, MapPin, Moon, RefreshCw, Search, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { formatValue } from '@/components/stations/stationRows';
import { CategoryChip } from '@/components/ui/Category';
import { Dialog } from '@/components/ui/Dialog';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';
import { lensOf } from '@/lib/insights';

import { NAV_ITEMS } from './navigation';
import {
  flattenGroups,
  paletteResults,
  pushRecent,
  type PaletteAction,
  type PaletteContext,
  type PaletteItem,
} from './paletteCommands';

const RECENT_KEY = 'vazduh-palette-recent';

/** Nedavno otvorene stanice (samo ovaj pregledač; prazno kad je skladište nedostupno). */
function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* skladište nedostupno (privatni prozor, iframe) – bez pamćenja */
  }
}

const PAGE_ICONS = new Map(NAV_ITEMS.map((item) => [item.name, item.icon]));

function iconFor(item: PaletteItem, theme: 'light' | 'dark'): LucideIcon {
  switch (item.action.type) {
    case 'station':
      return item.group === 'recent' ? History : MapPin;
    case 'page':
      return PAGE_ICONS.get(item.action.view) ?? Search;
    case 'okrug':
      return ListFilter;
    case 'lens':
      return Eye;
    case 'theme':
      return theme === 'dark' ? Sun : Moon;
    case 'refresh':
      return RefreshCw;
  }
}

/** Naslov sa istaknutim delom koji odgovara upitu. */
function Highlighted({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>;
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] px-px text-ink">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export interface PaletteBodyProps extends Omit<PaletteContext, 'query'> {
  titleId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onRun: (action: PaletteAction) => void;
}

/**
 * Sadržaj palete (pretraga, grupe rezultata, podnožje). Stanje upita živi ovde, a dijalog
 * ga montira samo dok je otvoren – svako otvaranje počinje od praznog upita.
 */
export function PaletteBody({ titleId, inputRef, onRun, views, okrugs, okrug, lens, view, theme, recentIds }: PaletteBodyProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const groups = useMemo(
    () => paletteResults({ query, views, okrugs, okrug, lens, view, theme, recentIds }),
    [query, views, okrugs, okrug, lens, view, theme, recentIds],
  );
  const items = useMemo(() => flattenGroups(groups), [groups]);
  const safeActive = items.length ? Math.min(active, items.length - 1) : -1;
  const optionId = (index: number) => `${listId}-o${index}`;

  useEffect(() => {
    if (safeActive < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [safeActive]);

  const move = (delta: number) => {
    if (!items.length) return;
    setActive((index) => (Math.min(index, items.length - 1) + delta + items.length) % items.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      setActive((index) => Math.min(items.length - 1, index + 5));
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 5));
    } else if (event.key === 'Enter') {
      const item = items[safeActive];
      if (item) {
        event.preventDefault();
        onRun(item.action);
      }
    }
  };

  const activeItem = safeActive >= 0 ? items[safeActive] : null;
  const hint = !activeItem
    ? null
    : activeItem.action.type === 'station'
      ? 'Otvara stanicu na mapi'
      : activeItem.action.type === 'page'
        ? 'Prelazi na stranicu'
        : activeItem.action.type === 'okrug'
          ? 'Filtrira sve stranice'
          : activeItem.action.type === 'lens'
            ? 'Menja sočivo polutanta'
            : null;

  let index = -1;
  let body: ReactNode;
  if (!items.length) {
    body = (
      <p className="px-3 py-8 text-center text-sm text-muted" role="status">
        Nema rezultata za „{query.trim()}“. Probajte naziv grada, opštine ili okruga.
      </p>
    );
  } else {
    body = groups.map((group) => (
      <div key={group.key} role="group" aria-label={group.label} className="pb-1">
        <p aria-hidden className="eyebrow px-3 pb-1.5 pt-3">
          {group.label}
        </p>
        {group.items.map((item) => {
          index += 1;
          const itemIndex = index;
          const selected = itemIndex === safeActive;
          const Icon = iconFor(item, theme);
          const reading = item.view ? lensOf(item.view, lens) : null;
          return (
            <div
              key={item.key}
              id={optionId(itemIndex)}
              role="option"
              aria-selected={selected}
              data-index={itemIndex}
              onPointerMove={() => {
                if (!selected) setActive(itemIndex);
              }}
              onClick={() => onRun(item.action)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-ctl px-3 py-2.5 text-sm text-ink',
                selected && 'bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] shadow-[inset_0_0_0_1px_var(--border-strong)]',
              )}
            >
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-ctl border border-border bg-card-2 text-muted">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <Highlighted text={item.title} range={item.highlight} />
                </span>
                <span className="block truncate text-xs text-muted">{item.subtitle}</span>
              </span>
              {reading && reading.parameter && reading.value !== null ? (
                <span className="shrink-0 text-right text-xs leading-4 text-muted">
                  <span className="tnum font-semibold text-ink">{formatValue(reading.value)}</span>
                  <span className="unit-label block text-faint">
                    {PARAMETER_LABELS[reading.parameter]}
                    <span className="hidden sm:inline"> · {UNIT}</span>
                  </span>
                </span>
              ) : null}
              {item.view ? <CategoryChip category={reading?.category ?? null} stale={item.view.stale} size="sm" className="shrink-0" /> : null}
              {item.current ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                  <Check aria-hidden className="size-3.5" />
                  <span className="hidden sm:inline">aktivno</span>
                  <span className="sr-only sm:hidden">aktivno</span>
                </span>
              ) : null}
              <CornerDownLeft aria-hidden className={cn('hidden size-4 shrink-0 text-faint sm:block', selected ? 'opacity-100' : 'opacity-0')} />
            </div>
          );
        })}
      </div>
    ));
  }

  return (
    <>
      <h2 id={titleId} className="sr-only">
        Pretraga stanica, filtera i stranica
      </h2>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden className="size-[18px] shrink-0 text-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
          aria-label="Pretraži stanice po nazivu, šifri, opštini ili okrugu; stranice i filtere"
          placeholder="Stanica, opština, okrug ili stranica…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
        />
        <kbd className="hidden rounded-[6px] border border-border bg-card-2 px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline">Esc</kbd>
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Rezultati" className="max-h-[min(60dvh,440px)] overflow-y-auto overscroll-contain p-2">
        {body}
      </div>
      {/* Uputstvo za tastaturu – na dodirnim ekranima (bez hover-a) se ne prikazuje. */}
      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-faint [@media(hover:none)]:hidden">
        <span>
          <kbd className="font-mono">↑↓</kbd> izbor
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> otvori
        </span>
        <span className="hidden sm:inline">
          <kbd className="font-mono">Esc</kbd> zatvori
        </span>
        {hint ? <span className="ml-auto truncate">{hint}</span> : null}
      </div>
    </>
  );
}

/**
 * Paleta komandi (Ctrl/⌘K, „/“ ili dugme pretrage u gornjoj traci): pretraga stanica po
 * nazivu, šifri, opštini i okrugu bez obzira na kvačice, filteri (okrug, sočivo, tema,
 * osvežavanje) i stranice. Strelice + Enter; izbor stanice je otvara na Mapi. Nativni
 * modalni dijalog: fokus zarobljen, Esc zatvara, `aria-modal`, fokus se vraća na dugme.
 */
export function CommandPalette() {
  const { paletteOpen, closePalette, views, okrugs, okrug, lens, view, theme, navigate, openStation, setOkrug, setLens, toggleTheme, refresh } =
    useAtmosfera();
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const recentIds = useMemo(() => (paletteOpen ? readRecent() : []), [paletteOpen]);

  const run = (action: PaletteAction) => {
    closePalette();
    switch (action.type) {
      case 'station':
        writeRecent(pushRecent(readRecent(), action.stationId));
        openStation(action.stationId);
        break;
      case 'page':
        navigate(action.view);
        break;
      case 'okrug':
        setOkrug(action.okrug);
        break;
      case 'lens':
        setLens(action.lens);
        break;
      case 'theme':
        toggleTheme();
        break;
      case 'refresh':
        refresh();
        break;
    }
  };

  return (
    <Dialog open={paletteOpen} onClose={closePalette} labelledBy={titleId} placement="top" initialFocusRef={inputRef}>
      <PaletteBody
        titleId={titleId}
        inputRef={inputRef}
        onRun={run}
        views={views}
        okrugs={okrugs}
        okrug={okrug}
        lens={lens}
        view={view}
        theme={theme}
        recentIds={recentIds}
      />
    </Dialog>
  );
}
