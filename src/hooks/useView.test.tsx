import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { foreignPageParams, PAGE_PARAMS } from '@/lib/views';

import { applyParamUpdates, GROUP_PARAM, LENS_PARAM, OKRUG_PARAM, useStickyFilters, useView } from './useView';

describe('applyParamUpdates', () => {
  it('menja više parametara odjednom; null i prazno ih uklanjaju', () => {
    const next = applyParamUpdates(new URLSearchParams('view=stanice&q=nis&okrug=X'), { q: null, okrug: '', sort: 'name-asc' });
    expect(next.toString()).toBe('view=stanice&sort=name-asc');
  });

  it('promena sočiva uklanja filter kategorije; isto sočivo ga zadržava', () => {
    const before = new URLSearchParams('view=stanice&lens=NO2&grupa=umeren');
    expect(applyParamUpdates(before, { [LENS_PARAM]: 'PM10' }).get(GROUP_PARAM)).toBeNull();
    expect(applyParamUpdates(before, { [LENS_PARAM]: null }).get(GROUP_PARAM)).toBeNull();
    expect(applyParamUpdates(before, { [LENS_PARAM]: 'NO2' }).get(GROUP_PARAM)).toBe('umeren');
    expect(applyParamUpdates(before, { [OKRUG_PARAM]: 'Y' }).get(GROUP_PARAM)).toBe('umeren');
    // Izričito postavljena grupa u istom upisu ostaje.
    expect(applyParamUpdates(before, { [LENS_PARAM]: 'PM10', [GROUP_PARAM]: 'dobar' }).get(GROUP_PARAM)).toBe('dobar');
  });
});

describe('parametri stranica', () => {
  it('pretraga, grupa, redosled i neaktivne pripadaju samo Stanicama', () => {
    expect(PAGE_PARAMS.stanice).toEqual(['q', 'grupa', 'sort', 'neaktivne']);
    expect(foreignPageParams('mapa')).toEqual(['q', 'grupa', 'sort', 'neaktivne']);
    expect(foreignPageParams('stanice')).toEqual([]);
  });
});

/** Proba: trenutni URL i dugmad za navigaciju kroz `useView` (+ pamćenje filtera kao u provideru). */
function Probe() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const { navigate, replaceParams, setFilterParam, lensParam, okrugParam } = useView();
  const remember = useStickyFilters(lensParam, okrugParam);
  return (
    <>
      <p data-testid="url">{location.search}</p>
      <button type="button" onClick={() => replaceParams({ q: 'demo b', grupa: 'umeren', sort: 'name-asc' })}>
        filteri
      </button>
      <button type="button" onClick={() => navigate('mapa', { stationId: 'st-1' })}>
        otvori
      </button>
      <button type="button" onClick={() => navigate('stanice')}>
        stanice
      </button>
      <button
        type="button"
        onClick={() => {
          remember(LENS_PARAM, 'PM10');
          setFilterParam(LENS_PARAM, 'PM10');
        }}
      >
        pm10
      </button>
      <button type="button" onClick={() => routerNavigate(-1)}>
        nazad
      </button>
    </>
  );
}

const url = () => new URLSearchParams(screen.getByTestId('url').textContent ?? '');

describe('useView – filteri Stanica i „Nazad“', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', () => undefined);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderAt(entry: string) {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
      </MemoryRouter>,
    );
  }

  it('prelazak na Mapu ne nosi pretragu; „Nazad“ vraća Stanice sa njom', () => {
    renderAt('/?view=stanice&lens=NO2');
    fireEvent.click(screen.getByText('filteri'));
    expect(url().get('q')).toBe('demo b');
    expect(url().get('grupa')).toBe('umeren');

    fireEvent.click(screen.getByText('otvori'));
    expect(url().get('view')).toBe('mapa');
    expect(url().get('station')).toBe('st-1');
    expect(url().get('lens')).toBe('NO2');
    for (const name of ['q', 'grupa', 'sort']) expect(url().get(name)).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText('nazad'));
    });
    expect(url().get('view')).toBe('stanice');
    expect(url().get('q')).toBe('demo b');
    expect(url().get('grupa')).toBe('umeren');
    expect(url().get('sort')).toBe('name-asc');
  });

  it('novi ulazak na Stanice iz navigacije počinje bez pretrage', () => {
    renderAt('/?view=stanice');
    fireEvent.click(screen.getByText('filteri'));
    fireEvent.click(screen.getByText('otvori'));
    fireEvent.click(screen.getByText('stanice'));
    expect(url().get('view')).toBe('stanice');
    expect(url().get('q')).toBeNull();
  });

  it('sočivo promenjeno na Mapi: „Nazad“ vraća novo sočivo i uklanja filter kategorije starog', () => {
    // Unos istorije koji je napravio ruter (`idx`; MemoryRouter ne piše u window.history).
    Object.defineProperty(window.history, 'state', { configurable: true, get: () => ({ idx: 1 }) });
    onTestFinished(() => {
      delete (window.history as { state?: unknown }).state;
    });
    renderAt('/?view=stanice&lens=NO2');
    fireEvent.click(screen.getByText('filteri'));
    fireEvent.click(screen.getByText('otvori'));
    fireEvent.click(screen.getByText('pm10'));
    expect(url().get('lens')).toBe('PM10');
    act(() => {
      fireEvent.click(screen.getByText('nazad'));
    });
    expect(url().get('view')).toBe('stanice');
    expect(url().get('lens')).toBe('PM10');
    expect(url().get('grupa')).toBeNull();
    expect(url().get('q')).toBe('demo b');
  });
});
