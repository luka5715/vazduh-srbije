import { Component, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /**
   * Šta se prikazuje umesto podstabla posle greške pri prikazu (npr. neuspelo preuzimanje
   * lenjog JS dela). Funkcija dobija `reset` koji ponovo pokušava prikaz podstabla.
   */
  fallback: ReactNode | ((reset: () => void) => ReactNode);
  /** Promena bilo koje vrednosti (npr. `[view]`) automatski poništava grešku. */
  resetKeys?: readonly unknown[];
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
  /** `resetKeys` u trenutku greške – posle promene granica se sama vraća. */
  keys: readonly unknown[] | undefined;
}

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, index) => !Object.is(value, b[index]));
}

/**
 * Granica greške: greška pri prikazu podstabla (npr. „Failed to fetch dynamically imported
 * module“ kad lenji deo ne stigne posle prekida mreže ili novog postavljanja) ne skida celu
 * aplikaciju, već se na tom mestu prikazuje `fallback`. React grešku i dalje beleži u konzoli.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, keys: undefined };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error ?? new Error('Nepoznata greška') };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (state.error && keysChanged(state.keys, props.resetKeys)) return { error: null, keys: props.resetKeys };
    if (!state.error && state.keys !== props.resetKeys) return { keys: props.resetKeys };
    return null;
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === 'function' ? fallback(this.reset) : fallback;
    }
    return this.props.children;
  }
}
