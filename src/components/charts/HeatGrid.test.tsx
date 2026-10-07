import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { HeatGrid, type HeatGridColumn, type HeatGridRow } from './HeatGrid';

beforeAll(() => {
  // jsdom nema ResizeObserver (useMeasure); širina 0 je dovoljna – ćelije se i dalje crtaju.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const columns: HeatGridColumn[] = [
  { key: '2026-10-05', label: '05. 10.', title: '05. 10. 2026.' },
  { key: '2026-10-06', label: '06. 10.', title: '06. 10. 2026.' },
  { key: '2026-10-07', label: 'danas', title: '07. 10. 2026. (danas)', partial: true },
];

const rows: HeatGridRow[] = [
  {
    id: 'a',
    label: 'Demo stanica A',
    cells: [
      { value: 57.46, rank: 2 },
      { value: 150, rank: 3, partial: true },
      { value: 260, rank: 4 },
    ],
  },
];

describe('HeatGrid – tačka „Zagađen“ ili lošije, nepotpune ćelije, visok kontrast', () => {
  it('ćelije od „Zagađen“ naviše imaju tačku; nepotpuna ćelija/kolona ima oznaku i opis', () => {
    const { container } = render(<HeatGrid rows={rows} columns={columns} label="Kalendar" unit="µg/m³" />);
    const cells = [...container.querySelectorAll('[role="gridcell"]')];
    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.querySelectorAll('span').length)).toEqual([0, 1, 1]);
    expect(cells.every((cell) => cell.hasAttribute('data-mark') && cell.classList.contains('heat-cell'))).toBe(true);
    expect(cells.map((cell) => cell.hasAttribute('data-partial'))).toEqual([false, true, true]);
    // Podrazumevano zaokruživanje: 1 decimala ispod 100, ceo broj od 100.
    expect(cells[0].getAttribute('aria-label')).toBe('Demo stanica A, 05. 10. 2026.: 57,5 µg/m³, Umeren');
    expect(cells[1].getAttribute('aria-label')).toBe('Demo stanica A, 06. 10. 2026.: 150 µg/m³, Zagađen, nepotpun period');
    expect(container.textContent).toContain('tačka = „Zagađen“ ili lošije');
  });

  it('kolona bez podataka u bazi je „nije učitano“ – prazan okvir, drugačije od „nema merenja“', () => {
    const notLoadedColumns: HeatGridColumn[] = [{ ...columns[0], notLoaded: true }, columns[1], columns[2]];
    const grid: HeatGridRow[] = [{ id: 'a', label: 'Demo stanica A', cells: [{ value: null, rank: null }, { value: null, rank: null }, { value: 260, rank: 4 }] }];
    const { container } = render(<HeatGrid rows={grid} columns={notLoadedColumns} label="Kalendar" unit="µg/m³" />);
    const cells = [...container.querySelectorAll('[role="gridcell"]')];
    expect(cells[0].getAttribute('aria-label')).toBe('Demo stanica A, 05. 10. 2026.: nije učitano');
    expect(cells[0].hasAttribute('data-not-loaded')).toBe(true);
    expect(cells[1].getAttribute('aria-label')).toBe('Demo stanica A, 06. 10. 2026.: nema merenja');
    expect(cells[1].hasAttribute('data-not-loaded')).toBe(false);
    expect(container.textContent).toContain('nije učitano');
  });
});
