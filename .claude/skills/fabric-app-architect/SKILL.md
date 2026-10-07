---
name: fabric-app-architect
description: Design the concept, UX and implementation handoff of Microsoft Fabric and Power BI applications. Use for Fabric apps, org apps, workspace apps, audience journeys, navigation, KPI contracts and complete analytics redesigns. Distinguish Power BI experiences from the Fabric Apps/Rayfin workload, embedded web apps and Report Server. Coordinate visual design and quality review for end-to-end requests; avoid invoking a full architecture process for a single formatting fix.
---

# Fabric App Architect

Create an analytics product around decisions, with a deliberate visual identity, clear overview, guided exploration and useful detail. Capture visual ambition as part of the product contract; a request for striking modern design must affect composition and acceptance criteria. Respond in the user's language; use Serbian Latin when the user does. Treat design defaults as adjustable choices, not Microsoft requirements.

## Establish the product contract

1. Extract the business domain, primary audience, top three decisions, data sources, device context, and requested deliverable from available context.
2. Inspect provided reports, screenshots, PBIP/PBIR definitions, themes, and semantic-model metadata before proposing a redesign. Preserve existing measures and business meaning unless a change is requested or a verified error is found.
3. If context is sparse, make a short explicit assumption and proceed with a useful concept. Ask only for facts that materially change implementation, such as which existing semantic model to bind. Do not turn design work into a questionnaire or request repeated approval.
4. Determine the actual host: org app, workspace app, individual Power BI report, Fabric Apps/Rayfin workload, or custom application embedding Power BI. Treat Power BI Report Server as a separate compatibility target. In an established Power BI conversation, continue with that context; if the user requests application forms, custom frontend code or CRUD, resolve the host before making an implementation commitment. Do not silently switch platforms.
5. Read [platform-boundaries.md](references/platform-boundaries.md) and verify relevant current Microsoft documentation before making capability, availability, license, or API claims. Record the host and any tenant prerequisites in the handoff.

## Choose the smallest complete route

Use the available artifact to select the work; do not manufacture access or files.

| Input and goal | Produce | Leave explicit |
| --- | --- | --- |
| Brief or screenshot; concept requested | Decision-led page design and concrete build specification | Model bindings and runtime behavior unverified |
| Theme or visual styling fix | Focused visual-designer workflow | Avoid a full app redesign |
| PBIP/PBIR project supplied | Inspect definitions, make scoped changes, validate and render when possible | Target schema and host checks not executed |
| PBIX without supported editor | Theme/layout assets and exact Desktop steps, or use an available supported editor | Do not fabricate an edited PBIX |
| Live app with authorized tools | Implement within the requested app and test consumer journeys | Publishing/sharing only within actual authorization |
| Fabric Apps/Rayfin requested | Frontend, data/API and authorization contracts; use current project tooling | A Power BI theme is not this application's implementation |

Reuse existing project conventions. Keep a short decision log containing the chosen host, design direction, assumptions and unresolved bindings. Load [domain-recipes.md](references/domain-recipes.md) only when a domain starting point is useful.

## Build the application concept

- Write one sentence defining who the app serves and which decision becomes easier.
- Establish a distinct visual direction appropriate to the domain: executive calm, operational clarity, or analytical density. Carry brand assets through without copying another product's identity.
- For a new premium app or a rejected generic design, have the visual designer compare structurally different concept studies and select a direction before propagating a page shell. Preserve the latest user feedback in the handoff. Do not constrain exploration to a repeated KPI-card grid, or equate more features and animation with a better composition.
- Plan only pages that serve a decision. Prefer Overview → Analysis → Details; add an action page only for a concrete operational workflow.
- Define the landing experience, app-level sections, report-level pages, and drillthrough hierarchy. Avoid two competing full-size navigation rails when the host already provides one.
- Create a page contract table: page, audience, question, primary KPI, supporting visuals, filters, next action, and source dependencies.
- Create a KPI contract table: business definition, unit, grain, aggregation, period, comparison, favorable direction, format, known measure binding, and owner. Mark unknown bindings as unresolved; never invent model columns or claim sample metrics are live.
- Map source → curated model → metric → visual. Separate data freshness time from report viewing time and model refresh time.
- Specify default date context, fiscal/calendar rules, timezone, currency, synchronized slicers, and deliberate cross-filtering. Define reset behavior precisely.

Read [metric-contracts.md](references/metric-contracts.md) when defining or changing metrics. Record expected behavior for totals, partial periods, zero/missing values and multiple selections. Preserve an existing semantic-model contract during a visual redesign. Never assume a live SSAS connection, DirectQuery, Direct Lake and Import permit the same model edits.

## Make interactions intentional

Use supported page navigation, bookmark navigation, tooltips, and drillthrough. Specify selected, hover, disabled, loading, empty, and error behavior where supported. Describe unsupported behavior as a design intent with an alternative, not a native feature.

For each interaction record: trigger, target, preserved context, changed context, and recovery path. For display-only bookmarks disable Data capture and scope to intended visuals; capture Data only when resetting or intentionally recalling filters. Reserve a stable area for filters so opening a panel does not unintentionally shift the report content.

Do not treat hidden pages, audience navigation, or disabled buttons as data security. Specify and test model/source permissions, RLS/OLS where applicable, and consumer access separately. For write-back verify a supported integration, permissions, input validation, row identity, concurrent edits, audit behavior, and visible completion/failure feedback.

## Produce a concrete handoff

Read [handoff-contract.md](references/handoff-contract.md). Copy [app-blueprint.md](assets/app-blueprint.md) when a reusable working brief is useful; remove irrelevant sections. Deliver the smallest complete set appropriate to the request:

1. Product brief and chosen host.
2. Sitemap, page contracts, and KPI contracts.
3. Desktop layout and an explicit mobile layout when mobile is in scope.
4. Design tokens, visual specification, and interaction map.
5. Implementable theme/PBIR changes or exact Desktop build steps, depending on access.
6. Quality results, unresolved bindings, and deployment prerequisites.

For polished appearance, use `fabric-app-visual-designer` if available. For final review, use `fabric-app-quality-review` if available. Discover companions by name through the agent's skill registry or supplied skill folders; do not assume a vendor-specific installation path. If a companion is unavailable, perform the equivalent steps directly. Passing work between skills does not require launching other agents.

For an implemented app, include content/version inventory, source-to-target bindings, app update steps for the chosen host, a consumer smoke check and recovery to the last known working version. Reuse the existing release process. Do not export cached user data, credentials, tokens or local connection secrets as part of a design handoff.

Treat bundled paths as relative to this skill folder. Use available local tools and the host's authorized file-delivery mechanism; no specific connector, agent vendor or paid visual is required. Recheck time-sensitive sources when online; if unavailable, mark capability-dependent choices as provisional and continue the work that can be verified locally.

Advance authorized work through implementation and local review. Do not publish, share, or modify production access solely because this skill was invoked. Respect the user's explicit authorization. Do not claim a mockup, theme, or PBIR definition is a deployed or visually verified app.
