---
name: fabric-rayfin-engineering
description: Engineer Microsoft Fabric Apps (Fabric Apps preview) built on the Rayfin SDK and CLI (@microsoft/rayfin-*, version-locked to the project's node_modules). Use for any coding, data-access, user-data-functions, deploy or troubleshooting task in a Rayfin project - entities and decorators in rayfin/data, the GraphQL fluent client (select/where/orderBy/first/executePaginated), Data API Builder filter limits, date text coming back as Date, functions in rayfin/functions (host.json, typegen, 250 s host limit, caller identity, write retries, in-progress guards, day-by-day backfill), rayfin up / staticapp deploy / db apply, item permissions and anonymous access, trial capacity, demo mode, Playwright e2e and screenshot gates, and reading the installed Rayfin guide docs. Not for visual design or product concept work; hand those to fabric-app-visual-designer and fabric-app-architect.
---

# Fabric Rayfin Engineering

Build and change Fabric Apps on the Rayfin SDK so that they work in the real Fabric tenant, not only in
types and local builds. The SDK's TypeScript types allow more than the Fabric backend accepts; every rule
below was paid for with a live failure. Respond in the user's language (Serbian Latin when the project
does); keep code comments in the project's language.

## When to use

- Reading or writing data through `client.data.<Entity>` or `ctx.getDataClient()`.
- Writing or changing user data functions in `rayfin/functions`, their generated `types.ts`, `host.json`,
  deadlines, retries, logging.
- Deploying (`npx rayfin up` and its subcommands), diagnosing a failed deploy, planning rollback.
- Permissions, sharing, anonymous access, Fabric SSO, capacity questions.
- Setting up or extending the quality gates: tests, demo build, Playwright e2e, screenshots.

Load the installed Rayfin docs first when the task touches an API you have not used in this project:
MCP tools `search_docs`, `get_doc`, `list_docs`, `discover_packages` (server `rayfin`), or
`npx -y @microsoft/rayfin-cli docs ...` from the project root; the guide also lives in
`node_modules/@microsoft/rayfin-guide/assets/docs/`. The docs are version-locked to the installed
packages - prefer them over memory.

## Non-negotiable rules

1. **Text columns accept only `eq`, `neq`, `contains`, `startsWith`, `endsWith`, `isNull`.** Fabric's Data
   API Builder rejects `gte`/`lte` on text with
   ``GraphQL errors: The specified input object field `gte` does not exist.`` even though the SDK types
   compile; `in` was never verified to work, so treat it as unavailable. A range over a text date is
   `orderBy desc` + early stop; existence checks are `eq` only.
2. **The SDK turns text that looks like a date into `Date`.** Any `YYYY-MM-DD` (or ISO datetime) string in
   a response becomes a `Date`, and `"true"`/`"false"` become booleans, whenever the `cli-minor-fixes`
   flag is off - always in the browser. Normalize such columns back to text immediately after each page
   is read (`dayKey`), before comparing, filtering or keying.
3. **`.execute()` returns one page (100 rows) and never says there is more.** Always `.first(n)`; any list
   that can exceed a page goes through `.first(n).executePaginated()` + `.after(endCursor)` with identical
   `select`/`where`/`orderBy` across pages and a page-count guard. 5,000-row pages work in Fabric.
4. Filter by the foreign-key column (`station_id`), not the navigation (`station.id`); sort direction in
   lowercase; `.select([...])` with explicit fields; every `@text()` has `max` (MSSQL `NVARCHAR(MAX)`
   breaks the GraphQL schema); entities are imported into the frontend and into functions as
   `import type` only.
5. **Functions:** `rayfin/functions/host.json` is tracked in git; the host aborts an invocation at 250 s
   and the client clamps `timeoutMs` to 250 s, so a function keeps its own shorter deadline and does one
   unit of work (one day) per call; `types.ts` and `runtimemetadata.json` are generated and the generator
   is idempotent (a CI gate); `shared/` modules have no Node.js imports; database writes run with the
   **caller's** identity (`ctx.getDataClient()`), never the app identity.
6. **Writes:** deterministic ids (UUID v5) so every write is idempotent; existence pre-checked with `eq`
   queries, then exactly one `create`/`update` per row (the SDK `upsert` costs two requests); a transient
   failure (429, 5xx, network) is retried once, a second failure is counted and reported as a warning,
   and a job in which nothing (or the majority) was written is an **error**, never "refreshed".
7. **Deploy** only from a machine with a browser (`npx rayfin login` opens MSAL); pushing to GitHub does
   not change the live app; `npx rayfin up -n` before `npx rayfin up`; the dry run must say the existing
   item is reused; Ctrl+F5 afterwards; a deploy-log row and a `deploy-YYYY-MM-DD` tag per deploy.
8. **Permissions:** viewers are same-tenant accounts with "Run and interact" on the item; guests and
   anonymous access need the tenant admin; functions cannot be invoked anonymously; entity-level
   permissions mean every signed-in user can write through GraphQL - say so in the docs or add a policy.
9. **Honesty in the UI and in reports:** never demo data in `rayfin` mode, not even as a fallback on
   error; durations and freshness come from measured runs; raw errors go under a "Details" disclosure;
   distinguish zero, "no measurements" and "not loaded"; verified vs untested stays explicit.

## References

Read the one that matches the task; each is self-contained.

- [data-access.md](references/data-access.md) - fluent client, DAB filter limits with exact error text,
  pagination, the date-sniffing mechanism and the `dayKey` fix, foreign keys, page sizes, type imports.
- [functions.md](references/functions.md) - `host.json`, limits and own deadline, caller identity,
  typegen idempotence, `shared/`, write retry and the "all unwritten = error" rule, in-progress guard,
  backfill-day semantics.
- [deploy.md](references/deploy.md) - login, dry run, item reuse, partial deploys, `assetAccess`,
  `fetch failed` diagnosis (proxy, `NODE_USE_ENV_PROXY`, `NODE_EXTRA_CA_CERTS`), cache, deploy log and tags,
  rollback.
- [permissions.md](references/permissions.md) - Run and interact / Edit / Reshare, tenant-only audience,
  guests and anonymous access, `@anonymous('read')`, functions and anonymity, trial capacity.
- [quality-gates.md](references/quality-gates.md) - typecheck, lint, vitest, demo build, fake-env rayfin
  build, Playwright e2e pattern, screenshots in both themes at 390/1280, reduced motion, honest copy.
- `patterns/` - short code excerpts adapted from a shipped project, with English comments:
  [data-service.md](references/patterns/data-service.md) (`fetchAllPages`, `pastFromDay`, `dayKey`),
  [errors.md](references/patterns/errors.md) (`httpStatusOf`, user-facing error text),
  [function-writes.md](references/patterns/function-writes.md) (`writeWithRetry`, `writeRows`,
  `assertWritesAccepted`, running-job guard).

## Working method

- Before changing a query, check the column type in `rayfin/data`: text columns get the eq-only rules,
  dates become `Date`, decimals may arrive as strings (`Number(...)` in the record mapper).
- Simulate the backend in unit tests: a fake fluent client that throws on `gte`, pages by `first`/`after`
  and optionally sniffs dates; a fake `ctx.getDataClient()` in memory; a fake `fetch`. Tests must not
  touch the network.
- A change in a function signature means `npm run typegen` and a frontend type error at every call site;
  a change in `rayfin/data` means `npx rayfin up db apply` (additive only; renames and type changes are
  blocked, `--force` can lose data).
- When something "works locally but not in Fabric", suspect in this order: text filter operator, date
  sniffing, single page truncation, caller identity/permission, host timeout, cached bundle.
- Finish by stating what was verified (command output, test names, screenshots) and what still needs the
  owner's live tenant (deploy, real data, second-user access).
