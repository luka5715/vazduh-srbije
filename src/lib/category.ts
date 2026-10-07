/**
 * Pomoćnici za boje SEPA kategorija u komponentama.
 *
 * Komponente nikad ne pišu heksadecimalne boje: koriste CSS promenljive iz
 * src/main.css (`--cat-N`, `--cat-ink-N`) ili gotove Tailwind klase ispod.
 * Puna imena klasa su nabrojana da bi ih Tailwind skener pronašao.
 */

import { CATEGORIES, categoryOf, type Category, type CategoryRank } from '@shared/aqi';

export { CATEGORIES, categoryOf };
export type { Category, CategoryRank };

export const RANKS: readonly CategoryRank[] = [0, 1, 2, 3, 4, 5];

/** `var(--cat-3)` – boja oznake kategorije, prati temu. */
export function catVar(rank: number): string {
  return `var(--cat-${clamp(rank)})`;
}

const BG = ['bg-cat-0', 'bg-cat-1', 'bg-cat-2', 'bg-cat-3', 'bg-cat-4', 'bg-cat-5'] as const;
const INK = ['text-cat-ink-0', 'text-cat-ink-1', 'text-cat-ink-2', 'text-cat-ink-3', 'text-cat-ink-4', 'text-cat-ink-5'] as const;
const BORDER = ['border-cat-0', 'border-cat-1', 'border-cat-2', 'border-cat-3', 'border-cat-4', 'border-cat-5'] as const;

export function catBgClass(rank: number): string {
  return BG[clamp(rank)];
}

export function catInkClass(rank: number): string {
  return INK[clamp(rank)];
}

export function catBorderClass(rank: number): string {
  return BORDER[clamp(rank)];
}

function clamp(rank: number): CategoryRank {
  return Math.min(5, Math.max(0, Math.round(rank))) as CategoryRank;
}
