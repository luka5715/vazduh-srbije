/**
 * Boje TANKIH oznaka SEPA kategorija (linije, obrisi, prazni markeri, krajnje tačke skica,
 * trake ≤ 6 px, tačke legende). U svetloj temi su `--cat-mark-N` tamnije varijante iste
 * nijanse (≥ 3 : 1 na beloj i na strani), u tamnoj su iste kao `--cat-N`. Ispune (čipovi,
 * ćelije toplotnih mapa, stubovi) ostaju na `catVar` – vidi src/main.css.
 */

function clamp(rank: number): number {
  return Math.min(5, Math.max(0, Math.round(Number.isFinite(rank) ? rank : 0)));
}

/** `var(--cat-mark-3)` – boja tanke oznake kategorije, prati temu. */
export function catMarkVar(rank: number): string {
  return `var(--cat-mark-${clamp(rank)})`;
}

/** `var(--cat-ink-3)` – mastilo na ispuni kategorije (tačka „Zagađen ili lošije“ u ćeliji). */
export function catInkVar(rank: number): string {
  return `var(--cat-ink-${clamp(rank)})`;
}

/** Ćelije toplotne mape od ove kategorije naviše dobijaju tačku (ne samo boju): „Zagađen“ ili lošije. */
export const DOT_RANK = 3;

/**
 * Tanak (1 px) obris u boji oznake preko ispune – u svetloj temi daje ivicu svetlim
 * ispunama (žuta na beloj), u tamnoj je nevidljiv (ista boja). Za `box-shadow`.
 */
export function markEdge(rank: number): string {
  return `inset 0 0 0 1px ${catMarkVar(rank)}`;
}
