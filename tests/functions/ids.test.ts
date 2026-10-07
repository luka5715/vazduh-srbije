// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { dailyStatId, snapshotId, stationId, uuidV5, VAZDUH_NAMESPACE } from '../../rayfin/functions/src/ids';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV5', () => {
  it('produces RFC 4122 version-5, variant-1 UUIDs', () => {
    for (const name of ['', 'a', 'station|37', 'daily|38|PM2.5|2026-10-05', 'Niš O.š. Sveti Sava']) {
      expect(uuidV5(name)).toMatch(UUID_V5);
    }
    expect(VAZDUH_NAMESPACE).toMatch(UUID_ANY);
  });

  it('matches the RFC 4122 reference vector (DNS namespace, "www.example.com")', () => {
    // Appendix-style known answer used by Python's uuid5 and RFC 9562 §A.4.
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('is deterministic', () => {
    expect(uuidV5('station|37')).toBe(uuidV5('station|37'));
    expect(stationId(37)).toBe(stationId(37));
    expect(dailyStatId(38, 'PM10', '2026-10-05')).toBe(dailyStatId(38, 'PM10', '2026-10-05'));
  });

  it('depends on the namespace', () => {
    expect(uuidV5('station|37', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toBe(uuidV5('station|37'));
  });

  it('is byte-sensitive to the name (UTF-8)', () => {
    expect(uuidV5('Nis')).not.toBe(uuidV5('Niš'));
    expect(uuidV5('station|37')).not.toBe(uuidV5('station|37 '));
  });
});

describe('entity id helpers', () => {
  it('distinct keys give distinct ids across helpers', () => {
    const ids = [
      stationId(36),
      stationId(37),
      stationId(38),
      stationId(106),
      snapshotId(36),
      snapshotId(37),
      dailyStatId(37, 'PM10', '2026-10-05'),
      dailyStatId(37, 'PM2.5', '2026-10-05'),
      dailyStatId(37, 'PM10', '2026-10-06'),
      dailyStatId(38, 'PM10', '2026-10-05'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID_V5);
  });

  it('station and snapshot ids for the same station differ', () => {
    expect(stationId(37)).not.toBe(snapshotId(37));
  });

  it('600 daily-stat keys (4 stations × 5 parameters × 30 days) are all unique', () => {
    const ids = new Set<string>();
    for (const sepaId of [36, 37, 38, 106]) {
      for (const parameter of ['PM10', 'PM2.5', 'NO2', 'SO2', 'O3']) {
        for (let d = 1; d <= 30; d++) {
          ids.add(dailyStatId(sepaId, parameter, `2026-09-${String(d).padStart(2, '0')}`));
        }
      }
    }
    expect(ids.size).toBe(600);
  });

  it('ids are stable across runs (regression against accidental key-format changes)', () => {
    expect(stationId(37)).toBe(uuidV5('station|37'));
    expect(snapshotId(37)).toBe(uuidV5('snapshot|37'));
    expect(dailyStatId(37, 'PM10', '2026-10-05')).toBe(uuidV5('daily|37|PM10|2026-10-05'));
  });
});
