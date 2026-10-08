import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DayCoverageStatus, HistoryCoverage } from '@/lib/syncRules';

import { HistoryStrip } from './HistoryStrip';

function coverageOf(statuses: DayCoverageStatus[]): HistoryCoverage {
  const days = statuses.map((status, i) => ({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, status, complete: status === 'complete' ? 26 : status === 'missing' ? 0 : 12, reported: status === 'missing' ? 0 : 26 }));
  const incomplete = days.filter((d) => d.status === 'partial' || d.status === 'missing').map((d) => d.day);
  return {
    days,
    stations: 26,
    completeDays: days.filter((d) => d.status === 'complete').length,
    incomplete,
    missing: days.filter((d) => d.status === 'missing').map((d) => d.day),
    expired: days.filter((d) => d.status === 'expired').map((d) => d.day),
    oldestIncompleteExpiresInDays: incomplete.length ? 3 : null,
  };
}

describe('HistoryStrip – greška čitanja (R12)', () => {
  it('ljudski naslov, savet, „Detalji“ i „Pokušaj ponovo“ koje ponovo čita pokrivenost', () => {
    const reload = vi.fn();
    render(
      <HistoryStrip
        coverage={null}
        loading={false}
        error="Greška pri čitanju baze. Pokušajte ponovo; ako se ponavlja, javite vlasniku."
        errorDetail="GraphQL errors: The specified input object field `gte` does not exist"
        reload={reload}
        activity={null}
      />,
    );
    expect(screen.getByText('Pokrivenost istorije nije učitana')).toBeInTheDocument();
    expect(screen.getByText(/Greška pri čitanju baze\. Pokušajte ponovo/)).toBeInTheDocument();
    expect(screen.getByText('Detalji')).toBeInTheDocument();
    expect(screen.getByText(/input object field/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('bez `reload` i detalja: samo naslov i poruka', () => {
    render(<HistoryStrip coverage={null} loading={false} error="Nema veze sa Rayfin API-jem. Proverite internet vezu." activity={null} />);
    expect(screen.getByText('Pokrivenost istorije nije učitana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pokušaj ponovo' })).toBeNull();
    expect(screen.queryByText('Detalji')).toBeNull();
  });
});

describe('HistoryStrip – istekao dan (R13)', () => {
  it('legenda bez „istekao“ dok takvog dana nema', () => {
    render(<HistoryStrip coverage={coverageOf(['complete', 'partial', 'missing'])} loading={false} error={null} activity={null} />);
    expect(screen.queryByText('istekao')).toBeNull();
    expect(screen.getByTitle(/nije učitan \(0\/26 stanica/)).toBeInTheDocument();
  });

  it('istekao dan: šrafirana ćelija sa objašnjenjem „izvor ga već briše“ i stavka legende', () => {
    render(<HistoryStrip coverage={coverageOf(['expired', 'complete', 'complete'])} loading={false} error={null} activity={null} />);
    expect(screen.getByText('istekao')).toBeInTheDocument();
    const cell = screen.getByTitle(/istekao – izvor ga već briše/);
    expect(cell.style.backgroundImage).toMatch(/repeating-linear-gradient\(45deg/);
  });
});
