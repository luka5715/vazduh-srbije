# Verification playbook

## Before and after evidence

Record viewport, report/page, date context and selections for comparable screenshots. Render changes using available supported tools. Identify the render surface; an HTML concept is not a Power BI rendering. Inspect both full-page balance and individual visuals with long labels or high density. For a Fabric Apps/Rayfin frontend, render with the project's own screenshot or e2e tooling at the phone, desktop and laptop-fold viewports; emulate prefers-color-scheme, prefers-reduced-motion and forced-colors; freeze the clock or seed the data so before/after renders share the same state; measure text sizes instead of estimating. Mark Untested what needs the deployed item: the portal iframe (no addressable URL, SSO handoff) versus the standalone App URL.

## Interaction scenarios

- Open landing page with intended default context.
- Select one entity, then multiple entities; confirm affected visuals and totals.
- Change period; verify unit and comparison labels.
- Open/close a filter panel; ensure data selections survive.
- Reset; ensure only the documented context resets.
- Drillthrough and return; check preserved context.
- Use no-data, missing-target and undefined-denominator conditions when data permits.
- Repeat affected actions on mobile when in scope.

## Web frontend (Fabric Apps/Rayfin) scenarios

- Open the standalone App URL and the app inside the portal iframe.
- Resume a backgrounded phone tab after the data has aged (advance the frozen clock past the app's reload threshold, then dispatch visibilitychange hidden → visible).
- Open a deep link with invalid parameters.
- Browser Back after a detail view.
- prefers-reduced-motion on.
- forced-colors/high-contrast.
- 390 px width with no horizontal overflow.
- Expired session on a data read (401/403).

Mark portal-only cases, and the expired-session case when no backend is reachable, Untested when only a local build is available; cite the code path as static evidence.

## Static-file checks

Parse JSON and validate the target schema. Resolve page/visual/bookmark references, registered resources and model bindings. Check rectangles for unintended overlap or off-canvas placement; allow deliberate decorative layering. Confirm text/date/number formats. Do not edit unsupported internal files to make a validation tool happy.

## Consumer/source checks

Separate app visibility, report permission, semantic-model permission, source/gateway identity and row/object restrictions. Diagnose failures at the correct layer. Test with an authorized consumer identity; never request or expose credentials in a report or generated artifact. Do not equate access under an administrator with success for the user.

## Performance checks

Use Power BI Performance Analyzer or the available supported query/host diagnostics. Compare the same data, filters and viewport; distinguish cold versus warm behavior when it matters. Record query, visual and total timings separately when available. Reduce excessive visuals, high-cardinality detail and expensive calculations based on actual findings. Avoid promising a universal sub-second target.

## Report format

| Finding | Severity | Evidence | Correction | Result |
| --- | --- | --- | --- | --- |

Add an Untested list only for checks materially affecting the requested delivery. State exact next validation actions if access to the target host is missing.

## Current official references

- Accessibility: https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-accessibility-creating-reports
- Performance Analyzer: https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-performance-analyzer
- Themes: https://learn.microsoft.com/en-us/power-bi/create-reports/report-themes-create-custom
- PBIR: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report
- Mobile: https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-mobile-layout-view
- Apps: https://learn.microsoft.com/en-us/power-bi/explore-reports/org-app-items

Verify relevant current documentation before stating product limitations, schema properties, role requirements or licensing. Treat design recommendations as recommendations rather than platform requirements.
