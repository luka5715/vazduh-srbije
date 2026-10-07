/**
 * Pretraga bez obzira na dijakritike i veličinu slova (paleta komandi, filteri).
 */

/** „Čačak“ → „cacak“, „Đurđevo“ → „djurdjevo“ (đ nema NFD dekompoziciju, pa ide ručno). */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ocena poklapanja upita sa jednim tekstom (veće = bolje, 0 = nema poklapanja):
 * ceo tekst počinje upitom > neka reč počinje upitom > upit je podniz > slova upita
 * se javljaju redom (rasuto poklapanje, kraći razmak je bolji).
 * Upit i tekst moraju biti već normalizovani (`normalizeText`).
 */
export function matchScore(query: string, text: string): number {
  if (!query) return 1;
  if (!text) return 0;
  if (text.startsWith(query)) return 100 - Math.min(20, text.length - query.length) * 0.1;
  const wordIndex = text.split(/[\s\-–,()/.]+/).findIndex((word) => word.startsWith(query));
  if (wordIndex >= 0) return 80 - wordIndex;
  const index = text.indexOf(query);
  if (index >= 0) return 60 - Math.min(20, index) * 0.5;
  // Rasuto poklapanje: sva slova upita redom.
  let position = -1;
  let gaps = 0;
  for (const char of query) {
    if (char === ' ') continue;
    const next = text.indexOf(char, position + 1);
    if (next < 0) return 0;
    if (position >= 0) gaps += next - position - 1;
    position = next;
  }
  return Math.max(1, 30 - gaps);
}

/** Najbolja ocena preko više polja (naziv, šifra, opština, okrug); polja mogu imati težinu. */
export function bestScore(query: string, fields: Array<string | null | undefined | [string | null | undefined, number]>): number {
  let best = 0;
  for (const field of fields) {
    const [text, weight] = Array.isArray(field) ? field : [field, 1];
    if (!text) continue;
    const score = matchScore(query, normalizeText(text)) * weight;
    if (score > best) best = score;
  }
  return best;
}
