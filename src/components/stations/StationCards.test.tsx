import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDemoCore } from '@/demo/fixture';
import { buildStationViews } from '@/lib/stations';

import { StationCards } from './StationCards';
import { bandsFor, buildStationRows, CARD_LIMIT } from './stationRows';

const NOW = new Date('2026-10-07T09:30:00Z');
const core = buildDemoCore(NOW);
const views = buildStationViews(core.stations, core.snapshots, NOW);
const rows = buildStationRows(views, 'worst', NOW);

describe('StationCards – „+N stanica“', () => {
  // Mini grafikoni kartica mere širinu (ResizeObserver), kog u jsdom-u nema.
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('bez filtera prikazuje prvih 20 kartica i dugme sa ostatkom; klik otvara sve', () => {
    expect(rows.length).toBeGreaterThan(CARD_LIMIT);
    const onToggle = vi.fn();
    const { rerender } = render(
      <StationCards rows={rows} lens="worst" bands={bandsFor(rows)} onOpen={() => undefined} currentId={null} latest={NOW} limit={{ capped: true, expanded: false, onToggle }} />,
    );
    expect(screen.getByRole('list', { name: 'Stanice' }).children).toHaveLength(CARD_LIMIT);
    const more = screen.getByRole('button', { name: `+${rows.length - CARD_LIMIT} stanica` });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <StationCards rows={rows} lens="worst" bands={bandsFor(rows)} onOpen={() => undefined} currentId={null} latest={NOW} limit={{ capped: true, expanded: true, onToggle }} />,
    );
    expect(screen.getByRole('list', { name: 'Stanice' }).children).toHaveLength(rows.length);
    expect(screen.getByRole('button', { name: 'Prikaži manje' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('sa filterom ili pretragom (bez ograničenja) nema dugmeta, a lista je cela', () => {
    render(
      <StationCards rows={rows} lens="worst" bands={bandsFor(rows)} onOpen={() => undefined} currentId={null} latest={NOW} limit={{ capped: false, expanded: false, onToggle: () => undefined }} />,
    );
    expect(screen.getByRole('list', { name: 'Stanice' }).children).toHaveLength(rows.length);
    expect(screen.queryByRole('button', { name: /^\+\d+ stanic|^Prikaži manje$/ })).toBeNull();
  });
});
