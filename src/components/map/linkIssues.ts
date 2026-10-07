/**
 * Provera parametara iz linka (`?station=`, `?lens=`, `?okrug=`) prema učitanim podacima:
 * nepoznata stanica, sočivo ili okrug se ne zamenjuju tiho drugim prikazom – `LinkNotice` ih
 * uklanja iz URL-a i kaže šta je prikazano umesto njih. Čiste funkcije (testirane u
 * `linkIssues.test.ts`).
 */

import { PARAMETER_LABELS, PARAMETERS } from '@shared/aqi';

import type { ViewName } from '@/lib/views';

export type LinkIssueParam = 'station' | 'lens' | 'okrug';

export interface LinkIssue {
  param: LinkIssueParam;
  /** Vrednost iz URL-a (sirova, za poruku). */
  value: string;
}

export interface LinkParams {
  stationParam: string | null;
  lensParam: string | null;
  okrugParam: string | null;
}

export interface LinkContext {
  /** Da li stanica sa ovim id-jem postoji u učitanoj mreži (i neaktivna postoji). */
  hasStation: (stationId: string) => boolean;
  /** Okruzi u kojima ima stanica. */
  okrugs: readonly string[];
  isLens: (value: unknown) => boolean;
}

/**
 * Parametri linka koji ne odgovaraju podacima, redom stanica, sočivo, okrug. Prazna vrednost
 * (`?okrug=`) nije greška – isto je kao da parametar nedostaje.
 */
export function findLinkIssues({ stationParam, lensParam, okrugParam }: LinkParams, context: LinkContext): LinkIssue[] {
  const issues: LinkIssue[] = [];
  if (stationParam && !context.hasStation(stationParam)) issues.push({ param: 'station', value: stationParam });
  if (lensParam && !context.isLens(lensParam)) issues.push({ param: 'lens', value: lensParam });
  if (okrugParam && !context.okrugs.includes(okrugParam)) issues.push({ param: 'okrug', value: okrugParam });
  return issues;
}

/** Najviše ovoliko znakova vrednosti iz linka ide u poruku (ostatak „…“). */
const MAX_QUOTED = 40;

function quoted(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return `„${clean.length > MAX_QUOTED ? `${clean.slice(0, MAX_QUOTED - 1)}…` : clean}“`;
}

export interface LinkIssueTextOptions {
  /** Stranica na kojoj se poruka prikazuje (na Mapi umesto stanice dolazi najlošija). */
  view: ViewName;
  /** Postoji bar jedna sveža stanica (Mapa tada prikazuje najlošiju umesto tražene). */
  hasWorst: boolean;
}

/** Poruka za jedan neispravan parametar: šta nije pronađeno i šta je prikazano umesto toga. */
export function linkIssueText(issue: LinkIssue, { view, hasWorst }: LinkIssueTextOptions): string {
  if (issue.param === 'station') {
    const base = 'Stanica iz linka nije pronađena (možda ju je SEPA ugasila ili joj promenila oznaku)';
    if (view !== 'mapa') return `${base}.`;
    return hasWorst ? `${base} – prikazana je stanica sa najlošijim vazduhom sada.` : `${base} – izaberite stanicu na mapi.`;
  }
  if (issue.param === 'lens') {
    const known = PARAMETERS.map((parameter) => PARAMETER_LABELS[parameter]).join(', ');
    return `Polutant iz linka (${quoted(issue.value)}) se ne prati (prate se ${known}) – prikazan je najlošiji polutant.`;
  }
  return `Okrug iz linka (${quoted(issue.value)}) nema stanica u mreži – prikazani su svi okruzi.`;
}

/** Ključ poruke (ista vrednost istog parametra se ne ponavlja). */
export function linkIssueKey(issue: LinkIssue): string {
  return `${issue.param}:${issue.value}`;
}
