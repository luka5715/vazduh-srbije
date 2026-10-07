import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { scopeLabel } from '@/lib/insights';

import { LensScope } from './LensScope';

describe('scopeLabel', () => {
  it('okrug ili „cela mreža“', () => {
    expect(scopeLabel(null)).toBe('cela mreža');
    expect(scopeLabel('Zaječarski')).toBe('Zaječarski okrug');
    expect(scopeLabel('Grad Beograd')).toBe('Grad Beograd');
  });
});

describe('LensScope', () => {
  it('bez filtera: sočivo · cela mreža', () => {
    const { container } = render(<LensScope lens="worst" okrug={null} />);
    expect(container.textContent).toBe('Najlošiji · cela mreža');
    expect(container.querySelector('.text-ink')).toBeNull();
  });

  it('sa uvodom i aktivnim okrugom (istaknut)', () => {
    const { container } = render(<LensScope lens="NO2" okrug="Nišavski" prefix="24 h" />);
    expect(container.textContent).toBe('24 h · NO₂ · Nišavski okrug');
    expect(container.querySelector('.text-ink')?.textContent).toBe('Nišavski okrug');
  });
});
