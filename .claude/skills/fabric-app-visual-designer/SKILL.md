---
name: fabric-app-visual-designer
description: Create polished visual systems and implementable layouts for Microsoft Fabric apps and Power BI reports. Use for professional app appearance, report redesign, premium or 'spectacular' dashboard visuals, when a user calls an existing design generic or too basic, color palettes, light or dark themes, typography, KPI cards, chart selection, navigation styling, desktop/mobile layouts, Power BI theme JSON or PBIR formatting, and the web frontend of a Fabric Apps (Rayfin) item. Styles the report or the app's own frontend, not the Fabric portal shell. Not for a single measure or data fix.
---

# Fabric App Visual Designer

Create an authored analytics product with deliberate composition, excellent typography, crafted charts and useful interactions. Make the visual ambition part of the acceptance criteria. Readability and correctness are necessary; they do not by themselves establish excellent design. Use the user's language for labels and explanations.

## Start from the evidence

Inspect existing screenshots, report definitions, theme, brand and actual field bindings. Determine the host and available deliverable route. If starting from a blank brief, state reasonable design assumptions and continue. Preserve metric definitions, filters, permissions and existing model connections during visual changes.

Read [design-system.md](references/design-system.md) for tokens and component contracts. Read [implementation.md](references/implementation.md) before theme import or PBIR changes. Recheck current Microsoft documentation for version-sensitive behavior.

Scale the workflow to the request: for one visual, fix that visual and its affected states; for a full app, establish the shell and one representative page before applying it throughout. Read [component-recipes.md](references/component-recipes.md) for exact component decisions and [asset-workflow.md](references/asset-workflow.md) when generating files. Keep source metrics and bindings separate from presentation defaults.

## Establish art direction before layout

For a new full application, premium redesign or rejected generic result, read [art-direction.md](references/art-direction.md) before generating assets or writing the interface. Copy [design-contract.md](assets/design-contract.md) into the deliverable directory as `design-contract.md` and fill it with the brief's actual decisions; the quality review reads that copy. Use reference evidence or the user's feedback to select composition, typography and component treatment together. For a small formatting fix, retain the established direction and skip concept exploration. For an existing application whose identity the user has approved or shipped, retain it, update only the design-contract rows the change touches, and rely on the quality review's visual gate instead of concept exploration unless the user asks for a new direction. Read [premium-and-motion.md](references/premium-and-motion.md) when the change touches an effect, transition or counter.

Use these as starting hypotheses, not ready-made layouts:

- **Executive clarity:** light surfaces, quiet borders, generous space, one strong accent, selective high-level KPIs.
- **Operational workspace:** clear status labels, compact filter rail, useful exception table, restrained density and actionable detail.
- **Analytical studio:** larger analysis area, compact metrics, controlled color and rich tooltips; choose dark only when context supports it.

Use an existing brand when supplied. For a blank brief, choose a coherent identity appropriate to the domain and explain it briefly. Treat the bundled palette, the scaffold grid and equal rounded cards as placeholders, and never carry forward a composition the user has already rejected. Reuse established product components when continuity is the actual goal. Where the user's references or an approved design use a pattern this skill discourages (equal card grids, ring gauges, glass, gradient or ambient surfaces), keep it as long as the data stays readable and record it in the design contract (see [art-direction.md](references/art-direction.md)).

When the user requests spectacular, premium, modern visuals or rejects a basic result, treat visual distinctiveness as an explicit requirement and read [premium-and-motion.md](references/premium-and-motion.md) before specifying any animation. First compare two structurally different concept studies using the same data; select the stronger direction without requiring another approval. After repeated rejection, restart composition from the brief and identify the assumptions that failed. Adding a comparison line, more cards or animation to the same layout is not a new direction.

## Compose the page

1. Build a reusable page shell: title and purpose, period/context, primary actions, main analysis, detail. Let the host provide app navigation where possible.
2. Establish one dominant message and allocate the canvas around it. Choose the number and treatment of metrics from the decision; no KPI card quota applies. Integrate related values with their analysis when a separate tile adds no meaning. Use open sections, shared analytical surfaces and tables where appropriate; do not put a border around every group.
3. Use an 8-unit spacing rhythm, common alignment lines and consistent surface treatment. Fix visual bounds and deliberately manage responsive formatting; prevent accidental shifts from slicer changes or auto-sized table columns.
4. Define x/y/width/height for each component relative to the report canvas. Include enough inner space for visual titles, legends and axis labels. Treat typography tokens as authored defaults and verify legibility at actual viewing scale; do not assume all Power BI text settings use CSS pixels.
5. Place comparison and trend context beside each KPI. Display unit, period and favorable direction. Keep precision, currency and percentage conventions consistent.
6. Write useful chart titles. Explain observed insights only when the actual data supports them. Reserve sample values for clearly labeled mockups.
7. Make filter context discoverable and reset behavior predictable. Prefer a fixed filter row or overlay panel over layout movement.

Give every component a stable key, visual type, rectangle, exact or unresolved binding, title, format and interaction scope. Separate report-canvas coordinates from native mobile layout units and web CSS units. Do not assume that a visually similar HTML preview or a geometric layout check proves the Power BI implementation is correct.

## Choose truthful visuals

Use lines for time trends, sorted bars for ranking, a matrix/table for exact detail, a scatterplot for relationships, a waterfall for additive contribution, and small multiples for repeated comparisons. Use a donut only for a simple small-category composition where exact comparison is secondary. Use maps only when geography is central to the decision. Avoid 3D charts, decorative gauges, crowded pies, dual-axis ambiguity and rainbow categories unless the user's references or an approved design use them and the data stays readable (see [art-direction.md](references/art-direction.md)).

Start magnitude bar axes at zero; disclose any justified alternative. Match time windows and units. For conditional color use business meaning: a lower cost can be favorable while a lower margin can be unfavorable. Do not infer favorable direction from the sign alone.

Prefer native visuals. Use a custom visual only for a requirement native visuals cannot meet; check tenant support, licensing, export, accessibility and performance. Treat SVG/DAX visuals as supplementary when they reduce accessibility or data interaction.

## Design states and mobile deliberately

Specify hover/selected/disabled states only where the control supports them. Add no-data and invalid-comparison messages; distinguish zero from missing. For write-back, include supported validation/loading/outcome feedback and a verified backend route.

Create a separate mobile layout ordered by the first decision the phone user makes, not by the desktop order (see [design-system.md](references/design-system.md), Mobile order): keep purpose, period and essential controls on the first screen, defer or collapse secondary detail deliberately, use readable labels and generous touch targets, simplify wide tables, and verify navigation/filter behavior on the intended client. Do not claim native CSS breakpoint reflow.

Measure text contrast (target 4.5:1 for normal text, 3:1 for large text), add meaningful labels beyond color, plan tab order and alt text, and remove decorative objects from keyboard order.

Check the contrast of essential non-text boundaries and selected/focus indicators against their adjacent colors; use 3:1 as the working target. Decorative borders need not carry that burden. Use color variants for small brand labels when the original brand color lacks contrast. Keep the original brand identity and make the adaptation explicit. Also inspect high-contrast mode and keyboard/focus behavior when the target client is available.

## Create reusable assets

Only after choosing the layout, optionally run `python3 scripts/generate_design_assets.py --output-dir <deliverable-directory> --mode light --preset analysis --width 1440 --height 900 --kpis 0` from this skill directory. Choose `executive`, `operations` or `analysis`, light/dark, 0–5 separate KPI containers, and optionally `--brand '<brand from the design contract>'` to match the design. Zero omits the KPI row; integrate the primary value with the analytical region. Python 3.9+ is the only runtime requirement. Use an unused output directory; `--force` deliberately replaces the four generated files.

The script generates a conservative Power BI theme, design tokens, and desktop/mobile layout specifications. Both layout files are implementation specifications, not PBIR or importable Power BI mobile layouts. The theme covers base palette and text defaults; apply spacing, card shapes and per-visual settings through Desktop or validated PBIR. The script's contrast variants cover defined token roles; inspect adjacent series, selected states and actual chart rendering separately.

The bundled `assets/base-light-theme.json` and `assets/base-dark-theme.json` equal the generator's default output and exist for agents that cannot run Python; they are palettes and text defaults, not a design. Adapt them to the brand and domain. Validate JSON structure and relevant current Microsoft theme schema, then import in Desktop when possible. Save user-facing assets through the applicable artifact workflow; do not write into this skill directory during ordinary use.

For a Fabric Apps/Rayfin web frontend the reusable asset is the project's own token layer (CSS custom properties or the component library's theme), type roles and chart color semantics; deliver changes as edits to those files and verify contrast on the rendered page. Generate a Power BI theme or layout JSON only when a Power BI report is also in scope.

If the agent cannot run Python, create the same specification using the documented defaults and label unexecuted checks. Resolve companion skills by name through the available skill system; no ChatGPT-specific folder, connector or API is required.

## Deliver and verify

Deliver the selected direction, exact layout/component specification, token palette, theme or concrete report edits, interaction settings and mobile plan. Render and inspect the landing page, detail and mobile priority view; compare them with the filled design contract when one exists, otherwise with the brief and the latest feedback, and with the references. Review composition, chart craft, typographic scale, identity and mobile prioritization separately from functionality. Fix a failed visual criterion before calling the premium brief complete. Use `fabric-app-quality-review` when available. Render in Power BI when possible; otherwise state the inspected surface. Do not call an unrendered definition visually verified or claim the app was published.
