/** Razmak između ćelija toplotne mape (px). */
export const HEAT_GAP = 2;
/** Procena širine jednog znaka oznake kolone (IBM Plex Mono, 10 px – `tick-label` od `sm`). */
export const LABEL_CHAR_PX = 6.2;
/** Isto za 11 px (`tick-label` na telefonu, ispod 640 px). */
export const LABEL_CHAR_PX_PHONE = 6.8;

/**
 * Položaj oznaka kolona toplotne mape: px od leve ivice kolone, ili null za kolonu bez
 * oznake. Oznake idu od poslednje (najnovije) kolone na svakih `every` kolona, centrirane su
 * iznad kolone i pomerene unutar oblasti ćelija na ivicama; oznaka koja bi dodirnula
 * susednu (razmak < 6 px) se izostavlja – oznake se nikad ne preklapaju. `charPx` je procena
 * širine znaka za trenutnu veličinu slova (`LABEL_CHAR_PX` od `sm`, `LABEL_CHAR_PX_PHONE` ispod).
 */
export function columnLabelOffsets(columns: { label: string }[], cellWidth: number, every: number, charPx: number = LABEL_CHAR_PX): (number | null)[] {
  const n = columns.length;
  const pitch = cellWidth + HEAT_GAP;
  const span = n * pitch - HEAT_GAP;
  const result: (number | null)[] = columns.map(() => null);
  let limit = Number.POSITIVE_INFINITY;
  for (let c = n - 1; c >= 0; c -= Math.max(1, every)) {
    const width = columns[c].label.length * charPx;
    if (!width) continue;
    const columnStart = c * pitch;
    const centered = columnStart + cellWidth / 2 - width / 2;
    const start = Math.max(0, Math.min(centered, span - width));
    if (start + width + 6 > limit) continue;
    result[c] = Math.round((start - columnStart) * 10) / 10;
    limit = start;
  }
  return result;
}
