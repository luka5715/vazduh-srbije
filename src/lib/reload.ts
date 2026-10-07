/**
 * Ponovo učitava stranicu. URL nosi stranicu, sočivo, okrug i stanicu, pa se stanje čuva.
 * Jedini pouzdan način da Chromium/Edge ponovo preuzme JS deo čiji je `import()` jednom pao
 * (neuspeli modul ostaje u kešu modula do ponovnog učitavanja).
 */
export function reloadPage(): void {
  if (typeof window !== 'undefined') window.location.reload();
}
