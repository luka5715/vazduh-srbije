# Component implementation recipes

Use actual field bindings or an explicit unresolved placeholder. Keep exact visual property names out of specifications until verified in the target Desktop version or schema.

| Component | Content and hierarchy | Power BI implementation decisions | Edge states |
| --- | --- | --- | --- |
| KPI | Label, value/unit, comparison label, period | Native card; numeric measure; supported number/format-string settings; dedicated comparison measure if it exists | Missing value vs zero; missing target; undefined growth |
| Trend | Question title, time axis, primary series, comparison | Line chart; chronological sorting; verified calendar granularity; label/line-style distinction | No rows, incomplete period, missing dates |
| Ranked drivers | Entity, value, share or change | Bar chart; zero baseline; explicit sort and Top N; define treatment of ties and remainder | One entity; no selection; long labels |
| Exceptions | Entity, issue, impact, owner/status | Table/matrix; stable column widths; explicit sort; drillthrough key; restrained conditional formatting | No exceptions; unavailable data; high row count |
| Filter row | Period plus frequent dimensions | Supported slicers; explicit sync scope; visible selection context | All, one, many, no matching records |
| Filter drawer | Advanced filters and close | Selection pane plus display bookmark; Data capture off for visibility changes; selected-visual scope | Open/close must retain user selections |
| Detail | Entity identity, context and records | Drillthrough fields; explicit Keep all filters decision; supported back action | No entity, multiple entities, removed data |
| Navigation | Short label and selected state | Page/bookmark navigator appropriate to task; visible keyboard focus where supported | Hidden pages are not authorization |

## Build specification

For each component record: `key`, `page`, `visual type`, `binding`, `x/y/width/height`, `title`, `units/format`, `sort`, `filter interactions`, `tooltip`, `alt text`, `mobile treatment`. Record when a property is defaulted versus verified in the current host.

Use native visual titles when they remain readable and accessible; if a separate heading is needed, include it deliberately in keyboard order. Avoid dozens of decorative shapes that complicate maintenance and rendering. Keep decorative backgrounds outside the data and interaction layers.

## Visual craft checks

Inspect long Serbian/localized labels, negative amounts, large values, multiline headers and selected slicer text. Specify rounding and localized separators without changing the numeric value. Check Fit to page at the expected laptop size as well as the authoring canvas. Reserve tooltip detail for supplementary content; critical context must remain visible without hover.

For a web frontend in Fabric Apps/Rayfin, translate the same hierarchy into its supported component system and responsive behavior. Do not transfer Power BI bookmark instructions into a custom frontend, or claim the frontend's CSS styles the Fabric portal.
