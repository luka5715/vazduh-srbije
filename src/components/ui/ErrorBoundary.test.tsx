import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;

function Flaky({ label }: { label: string }) {
  if (shouldThrow) throw new Error('Failed to fetch dynamically imported module');
  return <p>{label}</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    // React beleži uhvaćenu grešku u konzoli – u testu je to očekivano.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('greška u podstablu prikazuje zamenu, a ostatak stabla radi', () => {
    render(
      <div>
        <p>Ljuska</p>
        <ErrorBoundary fallback={<p role="alert">Ekran nije učitan</p>}>
          <Flaky label="Sadržaj" />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('Ljuska')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Ekran nije učitan');
  });

  it('`reset` iz funkcije zamene ponovo prikazuje podstablo', () => {
    render(
      <ErrorBoundary fallback={(reset) => <button onClick={reset}>Pokušaj ponovo</button>}>
        <Flaky label="Sadržaj" />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    expect(screen.getByText('Sadržaj')).toBeInTheDocument();
  });

  it('promena `resetKeys` (npr. druga stranica) poništava grešku', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['pregled']} fallback={<p role="alert">Stranica nije prikazana</p>}>
        <Flaky label="Pregled" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Isti ključ (novi niz iste vrednosti) ne poništava grešku.
    rerender(
      <ErrorBoundary resetKeys={['pregled']} fallback={<p role="alert">Stranica nije prikazana</p>}>
        <Flaky label="Pregled" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKeys={['mapa']} fallback={<p role="alert">Stranica nije prikazana</p>}>
        <Flaky label="Mapa" />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Mapa')).toBeInTheDocument();
  });
});
