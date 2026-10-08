import { describe, expect, it } from 'vitest';

import { formatRelative } from '@/lib/format';
import { liveStatus } from '@/lib/stations';

import { headlineOf, type HeadlineContext } from './heroHeadline';
import { UNMEASURED } from './runModel';

const NOW = new Date('2026-10-07T09:30:00Z');

function context(overrides: Partial<HeadlineContext> = {}): HeadlineContext {
  return { lastSync: new Date(NOW.getTime() - 4 * 60_000), now: NOW, mode: 'rayfin', auto: false, expectation: UNMEASURED, backfillDays: null, ...overrides };
}

describe('heroHeadline – rečenica „SEPA kasni“ heroja Sinhronizacije', () => {
  it('starost poslednjeg sata se računa od KRAJA intervala, isto kao čip ljuske i pločica „Najnoviji sat u bazi“', () => {
    // Najnoviji sat u bazi: 04:00–05:00Z (06–07 h lokalno); završio se u 05:00Z → pre 4 h 30 min („pre 5 h“
    // zaokruženo), a ne pre 5 h 30 min od početka („pre 6 h“), što je ranije pisalo samo u ovoj rečenici.
    const latest = new Date('2026-10-07T04:00:00Z');
    const headline = headlineOf({ kind: 'sepa-late', latestObservedAt: latest }, context());
    const sub = String(headline.sub);
    const { ageText } = liveStatus(latest, NOW);
    expect(ageText).toBe('pre 5 h');
    expect(sub).toContain(`poslednji sat u bazi je 6–7 h, ${ageText}.`);
    expect(sub).not.toContain(formatRelative(latest, NOW)); // 'pre 6 h' – od početka intervala
    expect(sub).toContain('nema novih merenja od 07:00');
    expect(headline).toMatchObject({ lead: 'SEPA', word: 'kasni' });
  });

  it('bez ijednog merenja u bazi rečenica to kaže bez starosti', () => {
    const headline = headlineOf({ kind: 'sepa-late', latestObservedAt: null }, context());
    expect(String(headline.sub)).toContain('u bazi još nema merenja nijedne aktivne stanice');
  });
});
