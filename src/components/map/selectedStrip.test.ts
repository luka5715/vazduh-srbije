import { describe, expect, it } from 'vitest';

import { detailBelowViewport } from './selectedStrip';

const entry = (isIntersecting: boolean, top: number) => ({ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly });

describe('detailBelowViewport', () => {
  it('detalji ispod ekrana → traka se prikazuje', () => {
    expect(detailBelowViewport(entry(false, 900))).toBe(true);
    expect(detailBelowViewport(entry(false, 1))).toBe(true);
  });

  it('detalji na ekranu ili već prođeni (iznad) → traka se ne prikazuje', () => {
    expect(detailBelowViewport(entry(true, 500))).toBe(false);
    expect(detailBelowViewport(entry(true, -40))).toBe(false);
    expect(detailBelowViewport(entry(false, -1200))).toBe(false);
    expect(detailBelowViewport(entry(false, 0))).toBe(false);
  });
});
