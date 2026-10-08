import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CategoryLegend } from '@/components/charts/CategoryLegend';

import { ErrorBanner, RefreshFailedNote } from './Feedback';
import { KpiDelta } from './Kpi';

describe('ErrorBanner', () => {
  it('ljudska poruka je vidljiva, sirova greška samo pod sklopivim „Detalji“; bez detalja nema sklopa', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ErrorBanner title="Podaci nisu učitani" message="Greška pri čitanju baze. Pokušajte ponovo; ako se ponavlja, javite vlasniku." detail="GraphQL errors: filter gte is not supported" onRetry={onRetry} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Podaci nisu učitani');
    expect(alert.textContent).toContain('Greška pri čitanju baze.');
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Detalji');
    expect(details?.textContent).toContain('filter gte is not supported');
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<ErrorBanner title="Podaci nisu učitani" message="Nepoznata greška" />);
    expect(screen.getByRole('alert').querySelector('details')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RefreshFailedNote', () => {
  it('bez vremena: ranije učitani podaci, dugme ponovo učitava', () => {
    const onRetry = vi.fn();
    render(<RefreshFailedNote onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain('Osvežavanje nije uspelo – prikazani su ranije učitani podaci.');
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('sa vremenom učitavanja: isti dan samo sat, drugi dan i datum (Beograd)', () => {
    const now = new Date('2026-10-07T14:00:00Z');
    const { rerender } = render(<RefreshFailedNote onRetry={() => {}} loadedAt={new Date('2026-10-07T12:05:00Z')} now={now} />);
    expect(screen.getByRole('status').textContent).toContain('prikazani su podaci od 14:05.');
    rerender(<RefreshFailedNote onRetry={() => {}} loadedAt={new Date('2026-10-06T20:30:00Z')} now={now} />);
    expect(screen.getByRole('status').textContent).toContain('prikazani su podaci od 06. 10. 22:30.');
  });
});

describe('KpiDelta – promena bez boja SEPA kategorija', () => {
  it('pogoršanje je podebljano u ink boji, poboljšanje prigušeno; nikad danger/ok', () => {
    const { container, rerender } = render(<KpiDelta delta={4} unit="µg/m³" suffix="nego pre 24 h" />);
    expect(container.textContent).toContain('više nego pre 24 h');
    expect(container.innerHTML).not.toMatch(/text-(danger|ok)\b/);
    expect(container.querySelector('.font-semibold.text-ink')).not.toBeNull();
    rerender(<KpiDelta delta={-4} unit="µg/m³" suffix="nego pre 24 h" />);
    expect(container.textContent).toContain('manje nego pre 24 h');
    expect(container.innerHTML).not.toMatch(/text-(danger|ok)\b/);
    expect(container.querySelector('.text-ink')).toBeNull();
  });
});

describe('CategoryLegend – tačka za „Zagađen“ ili lošije', () => {
  it('sa dotRank dodaje tačke u kvadratiće od te kategorije i stavku objašnjenja', () => {
    const { container } = render(<CategoryLegend dotRank={3} partialDay partialLabel="nepotpun dan (danas ili < 18 h merenja)" />);
    const swatches = container.querySelectorAll('li > span[data-mark]');
    expect(swatches).toHaveLength(7); // 6 kategorija + nepotpun dan
    const withDot = [...swatches].slice(0, 6).map((swatch) => swatch.children.length > 0);
    expect(withDot).toEqual([false, false, false, true, true, true]);
    expect(container.textContent).toContain('tačka = „Zagađen“ ili lošije');
    expect(container.textContent).toContain('nepotpun dan (danas ili < 18 h merenja)');
  });

  it('bez dotRank nema tačaka ni objašnjenja', () => {
    const { container } = render(<CategoryLegend />);
    expect(container.textContent).not.toContain('tačka');
    expect([...container.querySelectorAll('li > span[data-mark]')].every((swatch) => swatch.children.length === 0)).toBe(true);
  });
});
