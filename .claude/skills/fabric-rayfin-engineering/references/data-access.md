# Data access: the Rayfin GraphQL fluent client in Fabric

Verified with `@microsoft/rayfin-client` / `@microsoft/rayfin-data` 1.36.2 against a live Fabric item
(SQL database in Fabric + Data API Builder) on 2026-10-08. Where a statement comes from the installed
guide (`node_modules/@microsoft/rayfin-guide/assets/docs/data/graphql.md`), it says so; where it comes
from a live failure, it says so too.

## The client

```ts
import { RayfinClient } from '@microsoft/rayfin-client';
import type { AppSchema } from '../../rayfin/data/schema';          // type-only: see "Type imports"
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';

export type AppClient = RayfinClient<AppSchema, AppFunctionsSchema>;
// client.data.<Entity>      – fluent GraphQL client (older examples show client.data.gql.<Entity>)
// client.functions.<name>   – typed invoke()
```

Create one client per app (singleton). Read `baseUrl`/`publishableKey` through the deployed
`rayfin.config.json` / `VITE_*` values the CLI generates; never hardcode them.

## Reading

```ts
const rows = await client.data.Station.select(['id', 'name', 'active'])   // explicit field list
  .where({ active: { eq: true } })
  .orderBy({ name: 'asc' })                                               // direction in lowercase
  .first(1000)                                                            // ALWAYS set the page size
  .execute();
```

- `.execute()` returns **one page**. Default page size is 100. `.first(n)` raises it, but `.execute()`
  still returns only that page and gives **no signal** that more rows exist (guide, "Paginate Large
  Lists"). A list longer than the page is silently truncated. Use `.execute()` only for lists you know are
  bounded (lookup tables, one row per station with a hard upper bound you set in `.first`).
- `.first(n)` is bounded by DAB's maximum page size, 100,000 (guide). 5,000-row pages were used in Fabric
  for a 13,000-row table without problems (live). `.first(-1)` asks for an unbounded page but DAB still
  caps it.
- `count()` is not implemented; `totalCount` is present on `PagedResult` but DAB does not fill it
  (guide, "Limitations"). Select ids and use `length`.
- Required `@text()` fields come back as `''` when empty; optional text keeps `null` (guide).
- Nested selection works two levels deep only (`'notebook.name'`, not deeper).

### Pagination (anything that can exceed a page)

```ts
let cursor: string | undefined;
do {
  let query = client.data.DailyStat.select(FIELDS).orderBy({ day: 'desc' }).first(5000);
  if (cursor) query = query.after(cursor);
  const page = await query.executePaginated();      // { items, hasNextPage, endCursor }
  all.push(...page.items);
  cursor = page.hasNextPage ? page.endCursor : undefined;
} while (cursor);
```

Keep `select`, `where` and `orderBy` identical across pages - a stable sort is required for the cursor
(guide). Guard against a cursor that does not advance (`next !== cursor`) and cap the number of pages
(500) so a backend bug cannot loop forever. Paging with `before` is unsupported (DAB).

## Filtering: what Fabric's DAB accepts

**Live failure.** Over a **text** column (`@text`, including a `YYYY-MM-DD` day stored as text) the SDK
types offer `gte`, `lte`, `gt`, `lt`, `in`, but the Fabric backend rejects them:

```text
GraphQL errors: The specified input object field `gte` does not exist.
```

Accepted on text: `eq`, `neq`, `contains`, `startsWith`, `endsWith`, `isNull`. `in` over ids was never
verified in the project (the sync deliberately avoids it); treat it as unavailable until a live test says
otherwise. Numbers and dates accept comparison operators in MSSQL, but the guide
records that date comparisons (`gt`, `lt`, `gte`, `lte`) do not work on Postgres (DAB issue #3094), and
the project needed the text day for calendar-day grouping anyway.

Consequences:

- **Range over a text date**: `orderBy({ day: 'desc' })` + `.first(n)` + stop reading as soon as the last
  row of a page is below `fromDay`, then filter `row.day >= fromDay` in memory and sort ascending.
  Reading newest-first means a 30-day window costs 1-3 pages regardless of table age.
- **Existence checks before writes**: one `eq` query per entity (all stations, all snapshots in a single
  page) and one `eq` query per day for day-partitioned tables (`where({ day: { eq: day } }).first(5000)`),
  never `in: [...]` over ids.
- **Foreign keys**: filter on the generated FK column `{property}_id` (`where({ station_id: { eq: id } })`),
  not on the navigation (`station.id`). FK columns follow the `{property}_id` convention; custom names are
  not supported (known-limitations.md).
- A rejected filter surfaces as a thrown error on read. Show a human title ("Greška pri čitanju baze")
  and put the raw GraphQL message under a collapsible "Detalji"; never as the main text.

## Dates come back as `Date` even from text columns

**Live failure.** A `@text({ max: 10 })` column holding `2026-10-07` arrived in the browser as a `Date`
(UTC midnight). Comparisons like `day < fromDay` became `false`, the client-side filter dropped every row,
and keys in `Map<day, ...>` never matched: "Istorija u bazi · 0/30 dana", "Još nema dnevne statistike",
no chart - and **no error anywhere**.

Mechanism, from `@microsoft/rayfin-data/dist/utils/serialization.js` (1.36.2):

- `deserializeDabResponse(data, entity)` checks `isMinorFixesOn()`, which reads
  `process.env.RAYFIN_FEATURE_FLAGS` for the token `cli-minor-fixes`.
- With the flag **off** it runs `walkLegacyValueSniffing(data)`: for every object property, a string
  `"true"`/`"false"` becomes a boolean; a string matching `^\d{4}-\d{2}-\d{2}$` or
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$` (and parseable by `Date.parse`) becomes
  `new Date(value)`; nested objects and arrays are walked recursively.
- Browsers have no `process`, so the flag is **always off** there. In Node (functions) it is off unless the
  host sets `RAYFIN_FEATURE_FLAGS=cli-minor-fixes`; do not rely on that either.
- With the flag on, the SDK walks by entity descriptor instead (only real `@date` fields are converted).

Rule: any text column whose values look like dates or booleans must be normalized **right after each page
is read**, before early stop, filtering or keying:

```ts
function dayKey(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}
```

`toISOString()` is exact because the SDK built the `Date` from a date-only string (UTC midnight). Unit-test
this path with a fake client that returns `new Date(day)` for the column (see `patterns/data-service.md`).
Real `@date` fields may arrive as `Date` or ISO string depending on the path; normalize with
`new Date(x)` in the record mapper. Decimals may arrive as strings; wrap in `Number(...)`.

## Writing

- `create(fields)` returns the created entity; `update({ id }, patch)` patches by filter; `delete({ id })`.
  Relationship fields accept `{ id }` (guide).
- The SDK `upsert` is `findById` + `create`/`update` = two requests per row. For bulk writes pre-read
  existing ids with `eq` queries and issue exactly one mutation per row. If `create` fails because a
  parallel job inserted the same deterministic id, fall back to `update` and report the original error if
  that fails too.
- Deterministic ids (UUID v5 over a natural key, `node:crypto` server-side) make writes idempotent and let
  the frontend compute FK ids without a query. Random ids only for append-only logs.
- Throttle writes (8 parallel) and retry transient failures once; see `functions.md`.

## Entities (`rayfin/data`)

- Every `@text()` needs `max` on MSSQL; `@text()` without it produces `NVARCHAR(MAX)` and the GraphQL
  schema fails to build ("Internal server error" after an otherwise successful deploy - guide,
  known-limitations.md).
- Prefer `@authenticated([...])` / `@anonymous('read')` over `@role(...)`; policies compile at
  `db apply` (see `permissions.md`).
- Store small JSON blobs in sized text columns when a single read of "one row per entity" replaces
  N×M rows (snapshot pattern); parse tolerantly on the client.
- Schema moves forward only: adding columns/entities is supported; rename, type change and drop are
  blocked by the CLI, and `--force` can lose data. Never edit the SQL database in the portal.

## Type imports

- Frontend (`src/**`): entities are TC39-decorated classes that `@vitejs/plugin-react-swc` cannot parse;
  import them as `import type` only. Enforce with ESLint `@typescript-eslint/no-restricted-imports`
  (`allowTypeImports: true`) on `../rayfin/data/*` patterns.
- Functions: `import type { Entity } from '../../data/Entity.js'` (type-only, `.js` extension for ESM
  Node16; a value import would pull the decorator runtime into the bundle - guide, writing-functions.md).
- `types.ts` (generated) must not import Node built-ins because the frontend compiler resolves it.

## Checklist before shipping a query

- [ ] `.first(n)` present; paginated if the list can grow past `n`.
- [ ] Only `eq`-family operators on text columns; ranges via sort + early stop.
- [ ] Text date/boolean columns normalized after read (`dayKey`).
- [ ] FK filter uses `{property}_id`.
- [ ] Unit test with a fake client that rejects `gte`, pages by `first`/`after`, and sniffs dates.
- [ ] Error path shows a human title and keeps the raw message in a disclosure.
