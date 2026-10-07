import { describe, expect, it } from 'vitest';

import { columnLabelOffsets, HEAT_GAP, LABEL_CHAR_PX } from './heatGridLabels';

/** Leva i desna ivica prikazanih oznaka u px od početka oblasti ćelija. */
function extents(labels: string[], cell: number, every: number) {
  const offsets = columnLabelOffsets(labels.map((label) => ({ label })), cell, every);
  return offsets.flatMap((offset, c) =>
    offset === null ? [] : [{ c, start: c * (cell + HEAT_GAP) + offset, end: c * (cell + HEAT_GAP) + offset + labels[c].length * LABEL_CHAR_PX }],
  );
}

describe('columnLabelOffsets', () => {
  it('uvek označava poslednju kolonu i ne izlazi desno iz oblasti ćelija', () => {
    const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const shown = extents(labels, 30, 1);
    const span = 24 * 32 - HEAT_GAP;
    expect(shown.at(-1)?.c).toBe(23);
    expect(shown.at(-1)!.end).toBeLessThanOrEqual(span + 0.01);
    expect(shown[0].start).toBeGreaterThanOrEqual(0);
  });

  it('centrira oznaku iznad kolone kad ima mesta', () => {
    const offsets = columnLabelOffsets([{ label: 'aa' }, { label: 'bb' }, { label: 'cc' }], 40, 1);
    // kolona 1: centar 40 + 2 + 20 = 62, oznaka široka 12,4 → početak 55,8 → pomak 13,8
    expect(offsets[1]).toBeCloseTo(13.8, 1);
  });

  it('na uskim ćelijama oznake se nikad ne preklapaju (ni prva uz levu ivicu)', () => {
    const labels = Array.from({ length: 22 }, (_, i) => (i === 21 ? 'danas' : `${String(i + 1).padStart(2, '0')}. 09.`));
    for (const cell of [8, 10, 12, 16]) {
      const every = Math.max(1, Math.ceil((7 * LABEL_CHAR_PX + 8) / (cell + HEAT_GAP)));
      const shown = extents(labels, cell, every);
      expect(shown.length).toBeGreaterThan(0);
      for (let i = 1; i < shown.length; i++) expect(shown[i].start).toBeGreaterThanOrEqual(shown[i - 1].end + 6 - 0.01);
      expect(shown[0].start).toBeGreaterThanOrEqual(0);
    }
  });
});
