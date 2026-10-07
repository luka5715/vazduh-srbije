/**
 * Minimalne skale i podeoci za ručno crtane SVG grafikone.
 */

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert(pixel: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/** „Lep“ gornji kraj ose: 0,1,2,5 × 10^n iznad maksimuma. */
export function niceMax(max: number, minimum = 10): number {
  const target = Math.max(max, minimum);
  if (!Number.isFinite(target) || target <= 0) return minimum;
  const exponent = Math.floor(Math.log10(target));
  const magnitude = 10 ** exponent;
  const fraction = target / magnitude;
  let nice: number;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 2.5) nice = 2.5;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

/** Ravnomerni podeoci od 0 do `max` (uključivo), `count` koraka. */
export function ticks(max: number, count = 4): number[] {
  const result: number[] = [];
  for (let i = 0; i <= count; i++) result.push((max / count) * i);
  return result;
}

/** Indeks najbližeg slota za x-koordinatu u traci [x0, x1] podeljenoj na `n` slotova. */
export function nearestSlot(x: number, x0: number, x1: number, n: number): number {
  if (n <= 0) return -1;
  const band = (x1 - x0) / n;
  const index = Math.floor((x - x0) / band);
  return Math.min(n - 1, Math.max(0, index));
}

/** SVG putanja stuba sa zaobljenim gornjim i ravnim donjim ivicama. */
export function roundedTopBar(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, width / 2, height);
  if (height <= 0 || width <= 0) return '';
  const right = x + width;
  const bottom = y + height;
  return `M${x} ${bottom}V${y + r}Q${x} ${y} ${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom}Z`;
}

/** Medijana konačnih brojeva ili null. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
