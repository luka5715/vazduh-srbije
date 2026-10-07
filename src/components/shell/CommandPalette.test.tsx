import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StationRecord, StationSnapshotRecord } from '@shared/contracts';

import type { AtmosferaValue } from '@/hooks/useAtmosfera';
import { buildStationViews } from '@/lib/stations';

import { CommandPalette, PaletteBody } from './CommandPalette';

// Ceo `CommandPalette` čita globalno stanje; test mu daje samo ono što paleta koristi.
const atmosfera = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/useAtmosfera', () => ({ useAtmosfera: () => atmosfera.value }));

const NOW = new Date('2026-10-07T09:30:00Z');

function make(id: string, name: string, municipality: string): [StationRecord, StationSnapshotRecord] {
  const t = '2026-10-07T08:00:00Z';
  return [
    { id, sepaId: 1, code: id.toUpperCase(), name, municipality, latitude: null, longitude: null, active: true, updatedAt: NOW.toISOString() },
    {
      id: `snap-${id}`,
      station_id: id,
      observedAt: t,
      category: 1,
      dominant: 'PM10',
      valuesJson: JSON.stringify({ PM10: { v: 30, t, c: 1 } }),
      seriesJson: JSON.stringify({ start: '2026-10-06T09:00:00Z', values: {} }),
      updatedAt: NOW.toISOString(),
    },
  ];
}

const pairs = [make('nis', 'Niš IZJZ', 'Niš'), make('cacak', 'Čačak', 'Čačak')];
const VIEWS = buildStationViews(
  pairs.map((pair) => pair[0]),
  pairs.map((pair) => pair[1]),
  NOW,
);

function setup() {
  const onRun = vi.fn();
  render(
    <PaletteBody
      titleId="t"
      inputRef={createRef<HTMLInputElement>()}
      onRun={onRun}
      views={VIEWS}
      okrugs={['Moravički okrug', 'Nišavski okrug']}
      okrug={null}
      lens="worst"
      view="pregled"
      theme="dark"
      recentIds={[]}
    />,
  );
  return { onRun, input: screen.getByRole('combobox') };
}

describe('PaletteBody', () => {
  it('pretraga bez kvačica + Enter otvara stanicu', () => {
    const { onRun, input } = setup();
    fireEvent.change(input, { target: { value: 'cacak' } });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Čačak');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRun).toHaveBeenCalledWith({ type: 'station', stationId: 'cacak' });
  });

  it('strelice pomeraju izbor i kruže', () => {
    const { input } = setup();
    const count = screen.getAllByRole('option').length;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[count - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('grupe imaju naziv, a prazan rezultat poruku', () => {
    const { input } = setup();
    expect(screen.getByRole('group', { name: 'Idi na stranicu' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Stanice' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'qqqq' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Nema rezultata');
  });

  it('klik na stranicu je otvara', () => {
    const { onRun } = setup();
    fireEvent.click(screen.getByRole('option', { name: /Trendovi/ }));
    expect(onRun).toHaveBeenCalledWith({ type: 'page', view: 'trendovi' });
  });
});

describe('CommandPalette – bez localStorage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    vi.restoreAllMocks();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('radi kad Storage baca grešku: prikazuje se, polje dobija fokus, izbor stanice je otvara', () => {
    // Pravi Storage (jsdom) čije metode bacaju – kao blokirani kolačići u Fabric iframe-u.
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.sessionStorage });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    const openStation = vi.fn();
    const closePalette = vi.fn();
    atmosfera.value = {
      paletteOpen: true,
      closePalette,
      views: VIEWS,
      okrugs: ['Moravički okrug', 'Nišavski okrug'],
      okrug: null,
      lens: 'worst',
      view: 'pregled',
      theme: 'dark',
      navigate: vi.fn(),
      openStation,
      setOkrug: vi.fn(),
      setLens: vi.fn(),
      toggleTheme: vi.fn(),
      refresh: vi.fn(),
    } satisfies Partial<AtmosferaValue>;

    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    // Fokus odmah pri otvaranju (iOS podiže tastaturu samo za fokus u istom koraku).
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'nis' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(openStation).toHaveBeenCalledWith('nis');
    expect(closePalette).toHaveBeenCalled();
  });
});
