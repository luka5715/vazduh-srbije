# Design system and component contracts

The values below are design starting points, not product constraints. Keep them coherent and adjust to actual canvas and client scale. The brand token is a neutral placeholder; replace it from the contract before generating assets.

## Tokens

| Token | Light default | Dark default | Use |
| --- | --- | --- | --- |
| Canvas | #F4F6FA | #0B1220 | Page background |
| Surface | #FFFFFF | #111C2E | Cards and content regions |
| Main text | #172033 | #F1F5F9 | Titles and values |
| Secondary text | #526077 | #A8B8CE | Supporting context |
| Border | #DCE2EC | #314158 | Quiet separation; not sole control affordance |
| Brand | #2563EB | #60A5FA | Primary action and consistent main series |
| Positive | #15803D | #4ADE80 | Favorable business outcomes, with a label |
| Warning | #92400E | #FBBF24 | Attention, with a label |
| Negative | #B91C1C | #F87171 | Unfavorable outcomes, with a label |

Use a host-supported type family and deliberate fallback. Set display, section, body and metadata roles from the design contract; when it is silent, start from metadata 11–12, labels and body 12–14, section titles 16–20, page title 24–32, primary metric 32–44 in the host's authoring units (points in Power BI; for a web frontend see art-direction.md). Reserve the smallest size for secondary metadata, not for links, statuses or chart labels. Verify after actual client or Fit to page scaling. Treat the generator's text classes and 10-unit radius as placeholders. Use a coherent spacing rhythm; derive radii, open sections and surfaces from the selected direction rather than surrounding every group with a rounded border.

## Components

| Component | Required content | Behavior and implementation |
| --- | --- | --- |
| Page header | Title, decision context, period | Stable size; optional report page navigator below title |
| KPI card | Name, value, unit, comparison, period | Native card where suitable; stable precision; explicit missing-state text |
| Trend region | Metric, chronological axis, comparison | Restrained labels; distinguish series by more than color |
| Ranked drivers | Entity label, value, unit | Sorted bars, intentional Top N and stated remainder policy |
| Exception table | Entity, issue/status, impact, relevant detail | Stable columns, meaningful sort, detail navigation; totals by correct grain |
| Filter row | Period and 2–3 frequent dimensions | Synchronized only where meaningful; explicit reset |
| Filter panel | Less frequent controls and close action | Display-only bookmark scoped to panel; preserve selections |
| Detail page | Entity title, current context, relevant records | Drillthrough context and back path |

Use one icon family and stroke style; pair action icons with labels. Do not use emoji as production navigation icons. Keep chart and status color assignments stable across pages.

## Conventional scaffold, not a visual direction

The following 1440×900, 32-margin example is useful for a conventional report or maintaining an existing grid. Do not choose it automatically for a new premium application. Decide the hierarchy and separate KPI count first:

- Header: x32 y32 w1376 h64.
- Filters: x32 y120 w1376 h48.
- Optional four KPI regions: y192 h128; widths 326, x32/382/732/1082.
- Main trend: x32 y344 w865 h300.
- Ranked drivers: x921 y344 w487 h300.
- Exceptions/detail: x32 y668 w1376 h200.

Each region includes its internal title/labels. Reclaim the KPI row when values belong inside the main analytical surface. This is a coarse layout specification, not a report definition or an approved premium design. The rectangles above are the generator's `executive` output with four KPI containers at 1440×900; the generated desktop-layout.json is authoritative for its variant; the chosen art direction governs the finished page. Recalculate and validate bounds after changing the arrangement.

## Preset hierarchy

- `executive`: trend and ranked drivers above a full-width exceptions region.
- `operations`: dominant exception table on the left, trend and ranked drivers stacked on the right.
- `analysis`: full-width trend above a ranked breakdown and detail region.

Adapt the preset to the actual task; do not force every page to repeat the overview. Generated rectangles are containers, not completed visual components. At small canvases reduce density when titles, labels and axes consume too much space.

## Mobile order

Choose mobile order from the first user decision. For operational use, urgent exceptions and the next action may precede overall spend. For executive analysis, lead with the main comparison and its drivers. Defer secondary detail deliberately; avoid stacking the entire desktop dashboard by default. Reauthor slicers and tables for mobile. Verify tap targets, labels, navigation and reset on the actual client; mark unavailable device checks untested.
