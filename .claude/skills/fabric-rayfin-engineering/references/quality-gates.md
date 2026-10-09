# Quality gates for a Fabric App frontend + functions

Every gate below runs without a Fabric account or secrets, so it can run in a cloud session and in CI.
The only things that need the owner's tenant are deploy, real data and second-user access - list them as
untested when you cannot run them.

## The gate list (run before every commit)

| Gate | Command | Proves |
| --- | --- | --- |
| Types | `npm run typecheck` (`tsc -b`) | frontend + `rayfin/data` compile; function signature changes surface at call sites |
| Lint | `npm run lint` (`eslint .`) | `import type`-only entity imports in `src/**`, no deprecated SDK calls (`@typescript-eslint/no-deprecated`) |
| Unit tests | `npm test` (`vitest run`) | pure logic, fake fluent client, fake `ctx.getDataClient()`, fake `fetch`; no network |
| Functions build | `npm run functions:build` (`npm --prefix rayfin/functions run build`) | the functions package compiles on its own |
| Typegen idempotence | `npm run typegen` then `git diff --exit-code rayfin/functions/src/types.ts rayfin/functions/runtimemetadata.json` | generated files are in sync and untouched by hand |
| Demo build | `npm run build:demo` (`VITE_SERVICE_MODE=demo vite build --outDir dist-demo`) | the bundle builds; feeds e2e and screenshots |
| Fake-env rayfin build | `VITE_RAYFIN_PUBLISHABLE_KEY=pk-fake VITE_RAYFIN_API_URL=http://localhost:5168 npx vite build --outDir dist-check` (skips the `prebuild` that needs `rayfin/.env`) | the production (`rayfin`-mode) bundle builds and its size fits the budget; it is not a deploy |
| E2E | `npm run e2e` after `build:demo` (`node scripts/e2e.mjs dist-demo dist-demo/e2e`) | journeys, params, themes, 390 px, reduced motion, no console errors |
| Screenshots | `npm run screenshots` (`node scripts/screenshots.mjs`) | both themes × phone/desktop, horizontal overflow report, console errors |

CI (GitHub Actions, Node 22): `npm ci` (root and `rayfin/functions`), typecheck, lint, test, functions
build, demo build. Playwright is not in CI unless the browser is installed there; run e2e locally and say
so in the handoff.

## Demo mode: the test double for the whole backend

- `VITE_SERVICE_MODE=demo` selects `DemoDataService`/`DemoAuthService` at bootstrap; deterministic fixtures
  ("Demo stanica …", codes `DEMO-…`), no network, a persistent banner "DEMO PODACI — ovo nisu stvarna
  merenja…". Scenarios via `?demo=empty|late|smog|beograd` (before or after `#`) exercise the empty state,
  a late source, extreme values for contrast, and a dense cluster.
- In `rayfin` mode demo data **never** appears, not even as a fallback on error; the demo code is not in
  the rayfin bundle (`createDataService()` branches on the build-time mode).
- Demo uses `HashRouter` so a static server without SPA fallback can serve it; rayfin uses
  `BrowserRouter` with a single route and `?view=`.

## E2E pattern (`scripts/e2e.mjs`, Playwright + Chromium, no network)

- Serve `dist-demo` from a tiny `node:http` server with SPA fallback and `Cache-Control: no-store`; bind
  to `127.0.0.1:0`.
- Load Playwright from `PLAYWRIGHT_PATH` and Chromium from `CHROME_PATH` (system installs in sandboxes),
  `chromium.launch({ executablePath, args: ['--no-sandbox'] })`.
- Readiness hooks in the app: `[data-ready="true"]` on the root once data is rendered and
  `[data-testid="view-<name>"]` per page; stable `data-testid`s for charts/maps.
- `check(name, ok, detail)` collects results, prints `OK`/`FAIL` per check and `N/M provera prošlo`;
  exit code 1 if any failed. Capture `console` errors and `pageerror` per context (ignore
  `net::ERR_`, font loads) and assert zero at the end.
- Contexts: desktop 1280×900 dark (`locale: 'sr-Latn-RS'`, `timezoneId: 'Europe/Belgrade'`), phone
  390×844 (`isMobile`, `hasTouch`), a short phone 390×664 for fixed strips above the bottom nav, light
  theme, and `reducedMotion: 'reduce'`.
- Checks that found real bugs: navigation writes the URL param and `aria-current`; command palette
  (Ctrl/⌘K, "/", Esc, focus return); filters in URL and in panel labels; theme toggle persists after
  reload; `document.documentElement.scrollWidth <= clientWidth` on every phone page; bottom navigation does
  not cover the footer; reduced motion → `document.getAnimations()` has nothing running, canvas has a
  static frame, marquee becomes a scroll row; invalid link params show a notice instead of silently
  substituting; touch targets ≥ 44 px (≥ 32 px for map markers); first paint of KPI numbers without
  count-up; a long strip is a single Tab stop.
- Save a screenshot per scenario to the output dir so a reviewer can look without rerunning.

## Screenshot pattern (`scripts/screenshots.mjs`)

- Options: `--views a,b`, `--variants phone-light,phone-dark,desktop-light,desktop-dark`, `--scenario`,
  `--format jpeg|png`, `--out <dir>`, `--no-build` (or `SKIP_BUILD=1`, `SCREENSHOTS_DIST`).
- Set the theme before load with `page.addInitScript` writing the app's `localStorage` theme key; wait for
  `data-ready`, the page's `data-testid` chart paths, `document.fonts.ready`, then a short settle.
- Log `horizontalOverflow` (scrollWidth > clientWidth) per shot; fail on app console errors; extend the
  viewport to the document height before `fullPage` so sticky/fixed bars stay where users see them.
- The documentation set: overview in all four variants, other pages dark × phone/desktop; JPEG quality 88;
  PNG for pixel checks.

## Live verification (owner's tenant)

Screenshots of the **deployed** app with real data found what demo could not: the `gte` filter rejection,
the date sniffing (0/30 days with no error), 33 stations in one city (cluster needed), a headline that
claimed too much. Ask the owner for live screenshots after each deploy and compare numbers with the
source site. Record findings in the handoff, with the date.

## Honest copy and truthful states

- Durations: average of measured successful runs from the job log, roughly rounded ("obično oko 12 s ·
  limit 240 s"); without measurements "ispod minuta" - never a promise.
- Freshness: age counted from the **end** of the measured interval; "Uživo" only inside a defined window;
  otherwise a neutral "Poslednji sat …".
- Distinguish zero, "nema merenja" and "nije učitano"; a partial job is "Delimično", a database outage is
  an error, a late source is "izvor kasni", an invalid log row is "Neispravan zapis".
- Raw error text goes under a collapsible "Detalji"; the title tells the user what to do (sign in again,
  retry in a minute, tell the owner).
- No claims about public access, scheduling or completeness the configuration does not support.

## Mobile and accessibility minimums that were enforced

- 390 px: no horizontal scroll, bottom navigation respects `env(safe-area-inset-bottom)`, fixed strips
  stack above it, 44 px tap targets, 12 px minimum HTML text (11 px for defined exceptions), 11 px SVG tick
  labels.
- `prefers-reduced-motion: reduce`: a global CSS block disables animations/transitions; components render
  one static frame, counters jump to the final value, View Transitions are skipped; the page is complete
  without motion.
- Native `<dialog>` for palette and help (focus trap, Esc, focus return); keyboard order for map markers
  and clusters; `aria-current`, `aria-label`s with real values.
- `backdrop-filter` only on shell bars and overlays; write the unprefixed property only (Lightning CSS adds
  `-webkit-`; a manual pair merged into something Chromium ignored).

## Reporting

Report per gate: Pass / Fail / Untested with the evidence (command, exit code, counts, screenshot paths).
Do not fold them into one score. Name what still needs the live tenant.
