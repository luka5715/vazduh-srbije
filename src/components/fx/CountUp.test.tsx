import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatConcentration } from '@/lib/format';

import { COUNT_UP_MAX_MS, CountUp } from './CountUp';

/** Ručni sat: kadrovi requestAnimationFrame-a se puštaju tek na `advance(ms)`. */
function fakeFrames() {
  let now = 1000;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const raf = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  });
  const caf = vi.fn((id: number) => {
    queue.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    /** Pomera sat i pušta JEDAN krug kadrova (svaki kadar vidi novo vreme). */
    advance(ms: number) {
      now += ms;
      const pending = [...queue.values()];
      queue.clear();
      act(() => {
        for (const callback of pending) callback(now);
      });
    },
    get pending() {
      return queue.size;
    },
  };
}

/** Vidljivi (aria-hidden) tekst – ono što korisnik vidi na ekranu. */
function visible(container: HTMLElement): string {
  return container.querySelector('[aria-hidden]')?.textContent ?? '';
}

function setReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: /prefers-reduced-motion/.test(query) ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe('CountUp – bez odbrojavanja od nule pri prvom prikazu', () => {
  beforeEach(() => setReducedMotion(false));
  afterEach(() => vi.unstubAllGlobals());

  it('prvi render je odmah formatirana vrednost (ne 0)', () => {
    const frames = fakeFrames();
    const { container } = render(<CountUp value={25} />);
    expect(visible(container)).toBe('25');
    // Ništa ne čeka animaciju: nema zakazanih kadrova.
    expect(frames.pending).toBe(0);
    expect(container.querySelector('.sr-only')?.textContent).toBe('25');
  });

  it('prvi render poštuje `format` (36,7 µg/m³ kao u KPI pločici)', () => {
    fakeFrames();
    const { container } = render(<CountUp value={36.7} format={formatConcentration} />);
    expect(visible(container)).toBe('36,7');
  });

  it('null je crtica, a prelaz crtica → broj ne odbrojava od nule', () => {
    const frames = fakeFrames();
    const { container, rerender } = render(<CountUp value={null} />);
    expect(visible(container)).toBe('–');
    rerender(<CountUp value={13} />);
    expect(visible(container)).toBe('13');
    expect(frames.pending).toBe(0);
  });

  it('kasnija promena vrednosti se animira od prethodne vrednosti i završava za ≤ 500 ms', () => {
    const frames = fakeFrames();
    const { container, rerender } = render(<CountUp value={20} />);
    rerender(<CountUp value={30} />);
    expect(frames.pending).toBe(1);
    frames.advance(0);
    frames.advance(100);
    const mid = Number(visible(container));
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(30);
    frames.advance(COUNT_UP_MAX_MS);
    expect(visible(container)).toBe('30');
    expect(frames.pending).toBe(0);
  });

  it('`duration` se ograničava na 500 ms', () => {
    const frames = fakeFrames();
    const { container, rerender } = render(<CountUp value={0} duration={5000} />);
    rerender(<CountUp value={100} duration={5000} />);
    frames.advance(0);
    frames.advance(COUNT_UP_MAX_MS);
    expect(visible(container)).toBe('100');
    expect(frames.pending).toBe(0);
  });

  it('izričit `from` odbrojava pri prvom prikazu (brojači napretka)', () => {
    const frames = fakeFrames();
    const { container } = render(<CountUp value={87} from={0} />);
    expect(visible(container)).toBe('0');
    expect(container.querySelector('.sr-only')?.textContent).toBe('87');
    frames.advance(0);
    frames.advance(COUNT_UP_MAX_MS);
    expect(visible(container)).toBe('87');
  });

  it('smanjeno kretanje: i uz `from` i pri promeni prikazuje se odmah konačna vrednost', () => {
    setReducedMotion(true);
    const frames = fakeFrames();
    const { container, rerender } = render(<CountUp value={87} from={0} />);
    expect(visible(container)).toBe('87');
    rerender(<CountUp value={90} from={0} />);
    expect(visible(container)).toBe('90');
    expect(frames.pending).toBe(0);
  });
});
