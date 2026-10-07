import { describe, expect, it } from 'vitest';

import { isLens } from '@/lib/insights';

import { findLinkIssues, linkIssueKey, linkIssueText, type LinkContext } from './linkIssues';

const context: LinkContext = {
  hasStation: (id) => id === 'st-1' || id === 'st-2',
  okrugs: ['Nišavski okrug', 'Grad Beograd'],
  isLens,
};

describe('findLinkIssues', () => {
  it('ispravni parametri (i prazni ili bez njih) nisu greška', () => {
    expect(findLinkIssues({ stationParam: 'st-1', lensParam: 'NO2', okrugParam: 'Grad Beograd' }, context)).toEqual([]);
    expect(findLinkIssues({ stationParam: null, lensParam: null, okrugParam: null }, context)).toEqual([]);
    expect(findLinkIssues({ stationParam: '', lensParam: '', okrugParam: '' }, context)).toEqual([]);
    expect(findLinkIssues({ stationParam: null, lensParam: 'worst', okrugParam: null }, context)).toEqual([]);
  });

  it('nalazi nepoznatu stanicu, polutant i okrug (redom stanica, sočivo, okrug)', () => {
    const issues = findLinkIssues({ stationParam: 'does-not-exist', lensParam: 'CO', okrugParam: 'Nepostojeci' }, context);
    expect(issues).toEqual([
      { param: 'station', value: 'does-not-exist' },
      { param: 'lens', value: 'CO' },
      { param: 'okrug', value: 'Nepostojeci' },
    ]);
    expect(issues.map(linkIssueKey)).toEqual(['station:does-not-exist', 'lens:CO', 'okrug:Nepostojeci']);
  });

  it('okrug se poredi tačno (veličina slova je deo naziva iz podataka)', () => {
    expect(findLinkIssues({ stationParam: null, lensParam: null, okrugParam: 'grad beograd' }, context)).toEqual([{ param: 'okrug', value: 'grad beograd' }]);
  });
});

describe('linkIssueText', () => {
  it('stanica: na Mapi kaže šta je prikazano umesto nje, drugde samo da nije pronađena', () => {
    const issue = { param: 'station' as const, value: 'x' };
    expect(linkIssueText(issue, { view: 'mapa', hasWorst: true })).toBe(
      'Stanica iz linka nije pronađena (možda ju je SEPA ugasila ili joj promenila oznaku) – prikazana je stanica sa najlošijim vazduhom sada.',
    );
    expect(linkIssueText(issue, { view: 'mapa', hasWorst: false })).toMatch(/– izaberite stanicu na mapi\.$/);
    expect(linkIssueText(issue, { view: 'stanice', hasWorst: true })).toBe('Stanica iz linka nije pronađena (možda ju je SEPA ugasila ili joj promenila oznaku).');
  });

  it('polutant i okrug navode vrednost iz linka (skraćenu) i šta je prikazano', () => {
    expect(linkIssueText({ param: 'lens', value: 'CO' }, { view: 'pregled', hasWorst: true })).toBe(
      'Polutant iz linka („CO“) se ne prati (prate se PM10, PM2.5, NO₂, SO₂, O₃) – prikazan je najlošiji polutant.',
    );
    expect(linkIssueText({ param: 'okrug', value: 'Nepostojeci' }, { view: 'mapa', hasWorst: true })).toBe(
      'Okrug iz linka („Nepostojeci“) nema stanica u mreži – prikazani su svi okruzi.',
    );
    const long = linkIssueText({ param: 'okrug', value: 'x'.repeat(80) }, { view: 'mapa', hasWorst: true });
    expect(long).toContain(`„${'x'.repeat(39)}…“`);
  });
});
