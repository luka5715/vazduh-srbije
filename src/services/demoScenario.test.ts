import { afterEach, describe, expect, it } from 'vitest';

import { DEMO_SCENARIO_NOTES, DEMO_SCENARIOS, demoScenario, parseDemoScenario } from './demoScenario';

describe('parseDemoScenario', () => {
  it('poznate vrednosti vraća, sve ostalo je podrazumevani demo', () => {
    expect(parseDemoScenario('empty')).toBe('empty');
    expect(parseDemoScenario('late')).toBe('late');
    expect(parseDemoScenario('smog')).toBe('smog');
    expect(parseDemoScenario('beograd')).toBe('beograd');
    expect(parseDemoScenario('default')).toBe('default');
    expect(parseDemoScenario('Smog')).toBe('default');
    expect(parseDemoScenario('foo')).toBe('default');
    expect(parseDemoScenario('')).toBe('default');
    expect(parseDemoScenario(null)).toBe('default');
    expect(parseDemoScenario(undefined)).toBe('default');
  });

  it('svaki scenario ima napomenu za traku „DEMO PODACI“ (prazna samo za podrazumevani)', () => {
    for (const scenario of DEMO_SCENARIOS) {
      expect(typeof DEMO_SCENARIO_NOTES[scenario]).toBe('string');
      if (scenario !== 'default') expect(DEMO_SCENARIO_NOTES[scenario]).toMatch(/^Scenario/);
    }
    expect(DEMO_SCENARIO_NOTES.default).toBe('');
    // Izmišljenost je u samom nazivu scenarija.
    expect(DEMO_SCENARIO_NOTES.smog).toContain('Demo – smog');
    expect(DEMO_SCENARIO_NOTES.beograd).toContain('Demo – Beograd');
  });
});

describe('demoScenario (iz adrese)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('čita `?demo=` pre `#` (#/?demo=smog i ?demo=beograd#/)', () => {
    window.history.replaceState(null, '', '/?demo=beograd#/?view=mapa');
    expect(demoScenario()).toBe('beograd');
    window.history.replaceState(null, '', '/#/?view=pregled&demo=smog');
    expect(demoScenario()).toBe('smog');
  });

  it('bez parametra ili sa nepoznatim: podrazumevani demo', () => {
    window.history.replaceState(null, '', '/#/?view=pregled');
    expect(demoScenario()).toBe('default');
    window.history.replaceState(null, '', '/?demo=nepoznat#/');
    expect(demoScenario()).toBe('default');
  });
});
