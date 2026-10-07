import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDemoCore } from '@/demo/fixture';
import { buildStationViews } from '@/lib/stations';

import { HAZE_CAPTION, HAZE_RADIUS, SerbiaMap } from './SerbiaMap';

const NOW = new Date('2026-10-07T09:30:00Z');
const core = buildDemoCore(NOW);
const views = buildStationViews(core.stations, core.snapshots, NOW);

describe('SerbiaMap – izmaglica', () => {
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

  it('krugovi iste veličine za sve kategorije i natpis u legendi', () => {
    const { container } = render(<SerbiaMap views={views} />);
    const circles = [...container.querySelectorAll('.smap__haze circle')];
    const ranks = new Set(circles.map((circle) => circle.getAttribute('fill')));
    expect(circles.length).toBeGreaterThan(5);
    expect(ranks.size).toBeGreaterThan(1);
    expect(new Set(circles.map((circle) => circle.getAttribute('r')))).toEqual(new Set([String(HAZE_RADIUS)]));
    expect(screen.getByTestId('haze-caption')).toHaveTextContent(HAZE_CAPTION);
  });

  it('kompaktna mapa nikad ne crta izmaglicu (nema mesta za natpis)', () => {
    const { container } = render(<SerbiaMap views={views} compact showHaze />);
    expect(container.querySelector('.smap__haze')).toBeNull();
    expect(screen.queryByTestId('haze-caption')).toBeNull();
  });

  it('isključena izmaglica: ni sloja ni natpisa; legenda navodi skrivene neaktivne', () => {
    const { container } = render(<SerbiaMap views={views} showHaze={false} hiddenInactive={2} />);
    expect(container.querySelector('.smap__haze')).toBeNull();
    expect(screen.queryByTestId('haze-caption')).toBeNull();
    expect(container.textContent).toContain('2 neaktivne stanice (SEPA ih je ugasila) nisu na mapi.');
  });
});
