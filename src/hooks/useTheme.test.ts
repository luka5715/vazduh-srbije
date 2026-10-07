import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, THEME_PAGE_COLOR, useTheme } from './useTheme';

/** jsdom nema matchMedia: sistem je „tamna tema“ (kao Android sa tamnim režimom). */
function stubDarkSystem() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function addThemeMetas() {
  for (const [media, content] of [
    ['(prefers-color-scheme: light)', '#edf2f7'],
    ['(prefers-color-scheme: dark)', '#070c14'],
  ]) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = content;
    document.head.appendChild(meta);
  }
}

const metaContents = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);

describe('useTheme', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    stubDarkSystem();
    document.documentElement.className = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it('radi i kad localStorage baca grešku (blokirani kolačići, Fabric iframe)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    const { result } = renderHook(() => useTheme());
    // Bez sačuvanog izbora prati sistem (ovde tamna tema).
    expect(result.current.theme).toBe('dark');
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(document.documentElement).toHaveClass('light');
    expect(() => act(() => result.current.setTheme('dark'))).not.toThrow();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
  });

  it('radi i kad metode Storage bacaju grešku', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.sessionStorage });
    const { result } = renderHook(() => useTheme());
    expect(() => act(() => result.current.setTheme('dark'))).not.toThrow();
    expect(document.documentElement).toHaveClass('dark');
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('boja trake pregledača (theme-color) prati ručni izbor teme, ne samo sistem', () => {
    addThemeMetas();
    // Sistem je taman, korisnik bira svetlu temu.
    applyTheme('light');
    expect(metaContents()).toEqual([THEME_PAGE_COLOR.light, THEME_PAGE_COLOR.light]);
    expect(THEME_PAGE_COLOR.light).toBe('#edf2f7');
    applyTheme('dark');
    expect(metaContents()).toEqual(['#070c14', '#070c14']);
  });
});
