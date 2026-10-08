// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  deadlineWarning,
  isAlreadyRunningError,
  stationWarning,
  summarizeSyncWarnings,
  SYNC_ALREADY_RUNNING,
  unwrittenRowsWarning,
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

  it('formats the unwritten-rows warning with Serbian plurals', () => {
    expect(unwrittenRowsWarning(1)).toBe('1 red nije upisan u bazu');
    expect(unwrittenRowsWarning(3)).toBe('3 reda nisu upisana u bazu');
    expect(unwrittenRowsWarning(5)).toBe('5 redova nije upisano u bazu');
    expect(unwrittenRowsWarning(21)).toBe('21 red nije upisan u bazu');
    expect(unwrittenRowsWarning(112)).toBe('112 redova nije upisano u bazu');
  });

  it('counts failed and skipped stations and unwritten rows; other notices (demo) are not partial', () => {
    const warnings = [deadlineWarning(4), stationWarning(106, 'HTTP 500 za https://x/observations?station_id=106'), stationWarning(37, 'fetch failed')];
    expect(summarizeSyncWarnings(warnings)).toEqual({ failedStations: 2, skippedStations: 4, unwrittenRows: 0, partial: true });
    expect(summarizeSyncWarnings(['Demo režim: podaci nisu stvarna merenja.'])).toEqual({ failedStations: 0, skippedStations: 0, unwrittenRows: 0, partial: false });
    expect(summarizeSyncWarnings([])).toMatchObject({ partial: false });
    // A run that wrote everything but 3 rows is partial too (the frontend shows „Delimično“).
    expect(summarizeSyncWarnings([unwrittenRowsWarning(3)])).toEqual({ failedStations: 0, skippedStations: 0, unwrittenRows: 3, partial: true });
    expect(summarizeSyncWarnings(warningsFromMessage(`${deadlineWarning(2)} | ${unwrittenRowsWarning(1)} | ${stationWarning(5, 'x')}`).warnings)).toEqual({
      failedStations: 1,
      skippedStations: 2,
      unwrittenRows: 1,
      partial: true,
    });
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
