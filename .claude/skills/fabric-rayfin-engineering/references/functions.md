# User data functions in a Rayfin project

Verified with `@microsoft/fabric-user-data-functions` 1.36.2 and Rayfin CLI 1.36.2 in a live Fabric
workspace (2026-10-08). Guide: `node_modules/@microsoft/rayfin-guide/assets/docs/functions/*.md`.

## Shape of a function

```ts
import { UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { AppSchema } from '../../data/schema.js';   // type-only, .js extension (ESM Node16)

const udf = new UserDataFunctions();

udf.func('syncAirQuality', async (hoursBack: number, ctx: RayfinContext<AppSchema>): Promise<SyncResult> => {
  return runSync(ctx, hoursBack);          // keep the handler thin; logic lives in a testable module
}, []);
```

- Always `udf.func(name, handler, [])`; the third argument stays `[]` (external audiences are declared in
  the `RayfinContext<Schema, AudienceType.X>` annotation instead).
- `RayfinContext` is injected and stripped from the generated input type; `Promise<T>` is unwrapped.
- Throwing surfaces to the frontend as a `FunctionsError` carrying the message. For **expected** failures
  (source down, nothing to do, job already running) return a result object with `ok: false` and `error`,
  and log it; throw only for programming errors.
- Import `RayfinContext` from `@microsoft/fabric-user-data-functions`, not from `@microsoft/rayfin-functions`.
- Log with `console.log` and a stable prefix (`[app]`) so Fabric logs are searchable.

## Files that must exist and must not be edited by hand

| File | Rule |
| --- | --- |
| `rayfin/functions/host.json` | **Tracked in git.** A template `.gitignore` may exclude it, but `rayfin up` requires it and a fresh clone otherwise fails to deploy functions (live failure). Known-good: `version 2.0`, `extensionBundle` `Microsoft.Azure.Functions.ExtensionBundle.Preview` `[4.49.0, 5.0.0)`, `watchDirectories: ["dist"]`. |
| `rayfin/functions/src/types.ts` | Generated `AppFunctionsSchema`; never hand-edit; no Node imports (the frontend compiler resolves it). |
| `rayfin/functions/runtimemetadata.json` | Generated alongside `types.ts`. |
| `rayfin/functions/local.settings.json` | Local only, git-ignored. |

### Typegen and its idempotence gate

The CLI has no standalone `typegen` command; it runs inside `npx rayfin functions init` and the watcher of
`npx rayfin dev functions apply`. A project script can call the same generator directly:

```js
// scripts/typegen.mjs — same generator the CLI uses
const cliPkg = require.resolve('@microsoft/rayfin-cli/package.json');
const { generateFunctionsTypes } = await import(pathToFileURL(join(dirname(cliPkg), 'dist', 'utils', 'functions-types-generator.js')).href);
await generateFunctionsTypes(join(root, 'rayfin', 'functions'));
```

Gate: `npm run typegen && git diff --exit-code rayfin/functions/src/types.ts rayfin/functions/runtimemetadata.json`
must pass - the generator is idempotent, so a diff means someone edited by hand or forgot to regenerate.
A changed signature is then a compile error at every `client.functions.<name>.invoke(...)` call site.

## Time limit: 250 s on the host, your own deadline inside

- The Fabric UDF host aborts an invocation at **250 s**; `invoke(input, { timeoutMs })` is clamped to that
  ceiling (`FUNCTIONS_INVOKE_TIMEOUT_MS`, guide). The UI waits 240 s.
- Therefore the function owns a **shorter deadline**: stop starting new upstream requests after
  `FETCH_START_CUTOFF_MS = 120 s`, abort in-flight requests at `FETCH_DEADLINE_MS = 180 s` (timeouts and
  retry pauses are shortened to the deadline), and leave ~70 s for database writes. Skipped work is a
  warning (`N stanica preskočeno – vremenski limit`), the job still closes as `ok` and the UI shows
  "Delimično".
- One unit of work per call: a 30-day backfill is **30 invocations** driven by the frontend, oldest day
  first, never one loop inside the function.
- If the host kills the function anyway, the log row stays `running`; the frontend treats a `running` row
  older than 5 min as abandoned ("Prekinuto bez završetka") and the server guard ignores it.

## Identity: database writes run as the caller

- `ctx.getDataClient()` uses the invocation's Rayfin token: the **caller's** identity and entity
  permissions. `services.functions.auth.type: application` (required when functions are enabled) applies
  only to external resources reached through `ctx.Tokens.*`, which use the app identity (the item owner).
  It does not switch database access to the app identity (guide, functions/index.md).
- Consequences: an anonymous user cannot invoke a function that writes; every signed-in user with
  "Run and interact" can trigger your write path; and the same user could issue the mutations directly
  through GraphQL. Document that compromise or restrict `create`/`update` with a `policy` on
  `claims.role`/`claims.email` (verify in the real tenant which claims are populated).
- Keep writes idempotent (deterministic ids) so a next run heals rows a stray write damaged.

## `shared/` modules: one source of truth for server and browser

- `rayfin/functions/src/shared/*` holds pure logic both sides need (thresholds, time zone helpers,
  parsers, aggregation, warning texts). **No Node.js imports** there; the frontend imports it via an alias
  (`@shared/*` in `tsconfig.json` `paths` and the Vite `resolve.alias`).
- Server-only helpers (`node:crypto` for UUID v5) live outside `shared/`.
- Warning texts that the frontend parses are a contract: keep the formatter and the regex that reads it
  in the same `shared/` module, with the Serbian plural forms (`1 red nije upisan`, `3 reda nisu upisana`,
  `5 redova nije upisano u bazu`).

## Writes: retry once, report the rest, fail the job when the DB took (almost) nothing

- `isTransientWriteError(error)`: HTTP status from the error object (`status`, `statusCode`,
  `response.status`, nested `cause` up to 3 levels; the SDK puts it on `NetworkError.status`) is 429 or
  >= 500; or the message matches `HTTP 429|5xx`, `fetch failed`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR`...;
  or a `TypeError` with a network message (undici's `TypeError: fetch failed`); or a `NetworkError`
  without a status. A known status that is not 429/5xx (400, 404, 409), a GraphQL input rejection, or a
  programming `TypeError` ("Cannot read properties of undefined") is **not** transient and must fail the
  job.
- `writeWithRetry(tally, id, attempt)`: run; on transient error wait `WRITE_RETRY_DELAY_MS = 500 ms` and
  run once more; on a second failure (any kind) count `tally.unwritten++`, log, skip the row.
- After all writes: if `unwritten > 0` add the warning `N redova nije upisano u bazu` right after a
  deadline warning (summary warnings first, so they survive truncation of the log message to ~900 chars /
  5 warnings). The job is `ok` and the UI shows "Delimično"; the next run rewrites those rows.
- `assertWritesAccepted(tally, rowsWritten)`: if `rowsWritten === 0` or `unwritten > rowsWritten`, throw
  `Baza nije prihvatila upise: <warning>` so the job becomes `error`. Otherwise an outage of the database
  would display as a fresh successful sync ("Osveženo pre 1 min") and the empty data as "the source is
  late".
- Before this rule one 429 among ~1,300 mutations failed the whole job (live).

## In-progress guard (one sync at a time, without locks)

- Read up to 20 newest log rows with `kind eq 'sync'` and `status eq 'running'` (eq only). A row younger
  than `RUNNING_GRACE_MS = 5 min` and not more than 5 min in the future is a running job: return
  `ok: false` with an error that **starts with** a shared constant (`Sinhronizacija je već u toku`) and
  write nothing; the frontend recognises the prefix and shows a notice, not an error.
- An older `running` row is abandoned; a future-dated row is invalid; neither blocks.
- If the guard query itself fails, proceed: parallel jobs are idempotent and only cost capacity.
- Backfills skip the guard (they write other rows and are driven day by day).

## Backfill-day semantics

- Validate without network: format (`isValidDay` rejects `2026-02-30`), not in the future (`> todayLocal()`),
  not older than the source's retention (30 days). Invalid input returns `ok: false` **without** a log row.
- `dayUtcRange(day)` → `[local midnight, next local midnight)` in UTC, correct for 23 h and 25 h days
  (DST); `Intl.DateTimeFormat` with the app's time zone, no libraries. Unit-test the DST dates.
- Write only what the day needs (stations + daily rows), not snapshots; do not deactivate missing stations.
- **Keep rule:** a past day whose stored row has **more** hours than the new statistic is not overwritten
  (at the retention edge the source returns a partial day). Today is always written and completed by later
  runs.
- Window start of a regular sync snaps back to local midnight so every touched day except today is
  complete; the real window is at most `hoursBack + 24 h`. Pick `hoursBack` so a weekend gap closes itself
  (72 h: Friday 18:00 → Monday 08:00 = 62 h).
- The frontend computes coverage from the stored daily rows (complete / partial / not loaded / expired
  edge day) and calls the function only for incomplete days, oldest first; stop/resume therefore really
  resumes.

## Logging contract (`SyncRun`-style table)

One row per invocation: `kind`, `status` (`running` → `ok` | `error`), `startedAt`, `finishedAt`, window,
counters, `message` (error text or up to 5 warnings joined with ` | `, truncated to ~900 chars because the
column is `@text({ max: 1000 })`). Rows with a start/finish more than 5 min in the future or an unknown
kind/status are **invalid** on both sides: they never count as "last successful", never block, and the UI
labels them "Neispravan zapis".

## Local loop and tests

- `npx rayfin dev` runs frontend + functions host together; `npx rayfin dev functions apply` runs only the
  host with the typegen watcher. Bundled Vite templates route `/.rayfin/api/<name>` to the local host via
  `@microsoft/rayfin-local-dev`; in production `functionsBaseUrl` stays unset.
- Unit tests: in-memory fake for `ctx.getDataClient()` (Map per entity, `eq` filtering only), fake `fetch`
  with delayed responses to test the deadline, `writeRetryDelayMs` option to shorten the retry pause, a
  429 then success sequence, a 400 that must fail the job, the running guard, the keep rule.
- `npm --prefix rayfin/functions run build` (`tsc --build`) is a CI gate; functions have their own
  `package.json` and lockfile.
