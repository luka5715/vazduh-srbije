/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  syncAirQuality: {
    input: { hoursBack: number };
    output: { ok: boolean; syncRunId: string; from: string; to: string; stationsSeen: number; stationsWritten: number; observationsSeen: number; snapshotsWritten: number; dailyStatsWritten: number; durationMs: number; warnings: string[]; error?: undefined | string };
  };
  backfillDay: {
    input: { day: string };
    output: { ok: boolean; syncRunId: string; day: string; stationsSeen: number; observationsSeen: number; dailyStatsWritten: number; durationMs: number; warnings: string[]; error?: undefined | string };
  };
};
