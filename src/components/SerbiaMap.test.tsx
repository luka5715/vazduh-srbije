import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDemoCore } from '@/demo/fixture';
import { buildStationViews } from '@/lib/stations';

import { CLUSTER_HAZE_SCALE, HAZE_CAPTION, HAZE_RADIUS, SerbiaMap } from './SerbiaMap';

const NOW = new Date('2026-10-07T09:30:00Z');
const core = buildDemoCore(NOW);
const views = buildStationViews(core.stations, core.snapshots, NOW);
/** Scenario `beograd` uveče: 33 beogradske stanice, nekoliko „Zagađen“. */
const EVENING = new Date('2026-10-07T18:20:00Z');
const beogradCore = buildDemoCore(EVENING, 'beograd');
const beogradViews = buildStationViews(beogradCore.stations, beogradCore.snapshots, EVENING);

function stubResizeObserver() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

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

describe('SerbiaMap – grupe stanica i uvećan okrug (?demo=beograd)', () => {
  beforeEach(stubResizeObserver);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gust okrug je jedno dugme grupe (broj 33, prsten kategorija, oreol), sa redom u legendi i napomenom; dodir zove onOkrug', () => {
    const onOkrug = vi.fn();
    const { container } = render(<SerbiaMap views={beogradViews} onOkrug={onOkrug} />);
    const cluster = screen.getByRole('button', { name: /^Grad Beograd · 33 stanice · .* — dodir otvara okrug$/ });
    expect(cluster.className).toContain('mk--cluster');
    expect(cluster.querySelector('.mk__count')).toHaveTextContent('33');
    expect(cluster.querySelectorAll('.mk__ring circle').length).toBeGreaterThanOrEqual(2);
    expect(cluster.querySelector('.mk__halo')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Demo stanica Beograd \d+,/ })).toBeNull();
    expect(screen.getByTestId('cluster-key')).toHaveTextContent('grupa stanica – dodir otvara okrug');
    expect(screen.getByTestId('map-notes')).toHaveTextContent('Gust okrug (Grad Beograd · 33) je prikazan kao grupa stanica; dodir otvara okrug.');
    // Jedna izmaglica po grupi, 1,5× šira od izmaglice stanice.
    const radii = [...container.querySelectorAll('.smap__haze circle')].map((circle) => circle.getAttribute('r'));
    expect(radii.filter((r) => r === String(HAZE_RADIUS * CLUSTER_HAZE_SCALE))).toHaveLength(1);
    expect(radii.filter((r) => r === String(HAZE_RADIUS)).length).toBeGreaterThan(10);
    // Traka raspodele i dalje broji sve stanice (i članove grupe).
    const counts = [...screen.getByRole('list', { name: /Broj stanica po kategoriji/ }).querySelectorAll('li .tnum')].map((el) => Number(el.textContent));
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(beogradViews.filter((view) => view.position && !view.stale && view.category).length);
    fireEvent.click(cluster);
    expect(onOkrug).toHaveBeenCalledWith('Grad Beograd');
  });

  it('izabrana stanica u grupi: grupa nosi prsten akcenta, talase i natpis sa imenom stanice, broj ostaje 33', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 343, height: 500, top: 0, left: 0, right: 343, bottom: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const member = beogradViews.find((view) => view.station.name === 'Demo stanica Beograd 7')!;
    const { container } = render(<SerbiaMap views={beogradViews} selectedId={member.id} onSelect={vi.fn()} onOkrug={vi.fn()} />);
    const cluster = container.querySelector('button.mk--cluster')!;
    expect(cluster.getAttribute('aria-label')).toMatch(/^Grad Beograd · 33 stanice · .* · sadrži izabranu stanicu — dodir otvara okrug$/);
    expect(cluster.getAttribute('data-selected')).toBe('true');
    expect(cluster.getAttribute('tabindex')).toBe('0');
    expect(cluster.querySelectorAll('.mk__ripple')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Demo stanica Beograd 7,/ })).toBeNull();
    expect(container.textContent).toContain('Demo stanica Beograd 7');
  });

  it('bez onOkrug grupa je i dalje fokusabilna, ali klik ništa ne radi; kompaktna mapa ima manji disk', () => {
    const { container } = render(<SerbiaMap views={beogradViews} compact />);
    const cluster = container.querySelector('button.mk--cluster')!;
    expect(cluster).not.toBeNull();
    // Jedan tab-stop za sve oznake (roving tabindex): posle fokusa grupa je to mesto.
    expect(cluster.hasAttribute('tabindex')).toBe(true);
    fireEvent.focus(cluster);
    expect(cluster.getAttribute('tabindex')).toBe('0');
    expect(container.querySelectorAll('button.mk[tabindex="0"]')).toHaveLength(1);
    fireEvent.click(cluster);
    expect(container.querySelector('button.mk--cluster')).not.toBeNull();
    expect((cluster.querySelector('.mk__disc') as HTMLElement).style.getPropertyValue('--ck-size')).toBe('20px');
  });

  it('uvećan okrug: okvir je ~4× uži od zemlje i sečen, nema grupe, 33 beogradske tačke, razmernik 20 km i mreža „44,5°N“', () => {
    // Izmeren kvadratni okvir 500 × 500 px (jsdom inače meri 0 × 0, pa nema natpisa): okvir ≈ 200 jedinica
    // (3× uvećanje) obuhvata i prigušene susede (Pančevo, Smederevo).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 500, top: 0, left: 0, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { container } = render(<SerbiaMap views={beogradViews} okrug="Grad Beograd" onOkrug={vi.fn()} />);
    const viewBox = container.querySelector('svg.smap__land')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(600 / viewBox[2]).toBeGreaterThanOrEqual(2.5);
    expect(600 / viewBox[2]).toBeLessThanOrEqual(4.5);
    expect(container.querySelector('.smap__area')!.className).toContain('overflow-hidden');
    expect(container.querySelector('button.mk--cluster')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Demo stanica Beograd \d+,/ })).toHaveLength(33);
    expect(container.querySelectorAll('button.mk[data-dim="true"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('button.mk').length).toBeLessThan(beogradViews.length);
    expect(container.textContent).toContain('20 km');
    expect(container.textContent).toContain('44,5°N');
    expect(container.textContent).toContain('20,5°E');
    expect(screen.queryByTestId('cluster-key')).toBeNull();
    // Izmaglica iste veličine na ekranu: poluprečnik u jedinicama prati okvir (≈ 46 / 4).
    const r = Number(container.querySelector('.smap__haze circle')!.getAttribute('r'));
    // viewBox u atributu je zaokružen na 0,01, pa poređenje na dve decimale.
    expect(r).toBeCloseTo((HAZE_RADIUS * viewBox[2]) / 600, 2);
    expect(container.querySelector('svg.smap__land')!.getAttribute('aria-label')).toContain('uvećan i istaknut Grad Beograd');
  });

  it('natpis izabrane stanice na uvećanom okrugu: izmeren pa postavljen (strana, poravnanje, odmak), ne hvata pokazivač', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 343, height: 500, top: 0, left: 0, right: 343, bottom: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const member = beogradViews.find((view) => view.station.name === 'Demo stanica Beograd 33')!;
    const { container } = render(<SerbiaMap views={beogradViews} okrug="Grad Beograd" selectedId={member.id} onSelect={vi.fn()} />);
    const label = screen.getByTestId('selected-label');
    expect(label).toHaveTextContent('Demo stanica Beograd 33');
    expect(['right', 'left', 'above', 'below']).toContain(label.getAttribute('data-side'));
    expect(['center', 'start', 'end']).toContain(label.getAttribute('data-align'));
    expect(label.getAttribute('data-distance')).toMatch(/^\d+$/);
    expect(label.style.visibility).not.toBe('hidden');
    expect(label.style.left).toMatch(/px$/);
    expect(label.style.top).toMatch(/px$/);
    expect(label.className).toContain('pointer-events-none');
    // Spojnica postoji samo kad je natpis odmaknut.
    expect(container.querySelectorAll('[data-testid="selected-leader"]')).toHaveLength(label.getAttribute('data-distance') === '0' ? 0 : 1);
    // Kompaktna mapa nema natpis.
    const compact = render(<SerbiaMap views={beogradViews} okrug="Grad Beograd" selectedId={member.id} compact />);
    expect(compact.container.querySelector('[data-testid="selected-label"]')).toBeNull();
  });

  it('podrazumevani demo (bez gustog okruga): nema grupe ni reda u legendi, okvir cele zemlje', () => {
    const { container } = render(<SerbiaMap views={views} />);
    expect(container.querySelector('button.mk--cluster')).toBeNull();
    expect(screen.queryByTestId('cluster-key')).toBeNull();
    expect(screen.getByTestId('map-notes')).not.toHaveTextContent('grupa');
    const viewBox = container.querySelector('svg.smap__land')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(viewBox[0]).toBe(0);
    expect(viewBox[2]).toBe(600);
  });
});
