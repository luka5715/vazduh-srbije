import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vazduh-theme';

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

/** Tema koju nameće host (Fabric portal / ugrađeni pregled) preko data-theme ili data-appearance. */
function hostTheme(): Theme | null {
  if (typeof document === 'undefined') return null;
  for (const attribute of ['data-theme', 'data-appearance']) {
    const value = document.documentElement.getAttribute(attribute);
    if (value === 'dark' || value === 'light') return value;
  }
  return null;
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Boja strane po temi (`--page` u main.css) – za traku pregledača (`<meta name="theme-color">`). */
export const THEME_PAGE_COLOR: Record<Theme, string> = { light: '#edf2f7', dark: '#070c14' };

/**
 * Postavlja klasu teme na `<html>` (idempotentno; koristi je i kružno otkrivanje teme) i
 * boju trake pregledača: svi `theme-color` meta tagovi dobijaju boju izabrane teme, pa traka
 * (npr. Android Chrome) prati ručni izbor, ne samo sistemsku temu.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  try {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_PAGE_COLOR[theme]);
    }
  } catch {
    /* bez meta tagova (testovi, ugrađeni host) – samo klasa teme */
  }
}

/**
 * Svetla/tamna tema: izbor korisnika u localStorage; bez izbora prati sistem
 * (i reaguje na promenu sistemskog podešavanja). Inline skripta u index.html
 * postavlja klasu pre prvog crtanja, ovde je samo održavamo.
 */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readStored() ?? hostTheme() ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readStored() === null) setThemeState(hostTheme() ?? (media.matches ? 'dark' : 'light'));
    };
    media.addEventListener('change', onChange);
    // Host može naknadno da promeni data-theme (npr. prebacivanje teme u Fabric portalu).
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-appearance'] });
    return () => {
      media.removeEventListener('change', onChange);
      observer.disconnect();
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* bez localStorage tema važi do osvežavanja strane */
    }
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  return { theme, toggle, setTheme };
}
