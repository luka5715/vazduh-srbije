// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  deadlineWarning,
  isAlreadyRunningError,
  stationWarning,
  summarizeSyncWarnings,
  SYNC_ALREADY_RUNNING,
  warningsFromMessage,
} from '../../rayfin/functions/src/shared/syncNotes';

describe('syncNotes', () => {
  it('formats the time-limit warning with Serbian plurals', () => {
    expect(deadlineWarning(1)).toBe('1 stanica preskočena – vremenski limit');
    expect(deadlineWarning(3)).toBe('3 stanice preskočene – vremenski limit');
    expect(deadlineWarning(5)).toBe('5 stanica preskočeno – vremenski limit');
    expect(deadlineWarning(12)).toBe('12 stanica preskočeno – vremenski limit');
    expect(deadlineWarning(22)).toBe('22 stanice preskočene – vremenski limit');
  });

  it('counts failed and skipped stations; other notices (demo) are not partial', () => {
    const warnings = [deadlineWarning(4), stationWarning(106, 'HTTP 500 za https://x/observations?station_id=106'), stationWarning(37, 'fetch failed')];
    expect(summarizeSyncWarnings(warnings)).toEqual({ failedStations: 2, skippedStations: 4, partial: true });
    expect(summarizeSyncWarnings(['Demo režim: podaci nisu stvarna merenja.'])).toEqual({ failedStations: 0, skippedStations: 0, partial: false });
    expect(summarizeSyncWarnings([])).toMatchObject({ partial: false });
  });

  it('reads warnings back from SyncRun.message and says when the count is only a lower bound', () => {
    expect(warningsFromMessage(null)).toEqual({ warnings: [], complete: true });
    expect(warningsFromMessage('Stanica 1: a | Stanica 2: b')).toEqual({ warnings: ['Stanica 1: a', 'Stanica 2: b'], complete: true });
    const five = Array.from({ length: 5 }, (_, i) => `Stanica ${i}: x`).join(' | ');
    expect(warningsFromMessage(five).complete).toBe(false);
    expect(warningsFromMessage('Stanica 1: veoma dugačka poruka…').complete).toBe(false);
  });

  it('recognizes the already-running refusal', () => {
    expect(isAlreadyRunningError(`${SYNC_ALREADY_RUNNING} (pokrenuta pre 2 min u drugoj sesiji).`)).toBe(true);
    expect(isAlreadyRunningError('HTTP 500')).toBe(false);
    expect(isAlreadyRunningError(undefined)).toBe(false);
  });
});
