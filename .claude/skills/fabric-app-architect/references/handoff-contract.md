# App handoff contract

Use these tables as working structures; fill only the relevant fields. Keep confirmed facts separate from assumptions.

## App brief

- Audience and three recurring decisions.
- Host, semantic model/data sources, refresh expectations and devices.
- Deliverable type: concept, Desktop instructions, theme, PBIR changes, or deployed app.
- Primary visual direction, brand requirements, language and locale.
- Visual ambition, reference evidence, concept studies compared and latest explicit user feedback.
- Visual acceptance criteria (the quality review records each as Meets brief / Needs revision / Untested, never Pass/Fail) and intentionally deferred mobile content; distinguish these from technical completion. References the user supplied or a design they approved take precedence over default patterns; record them as the direction to keep.

## Page contract

| Page | User question | KPI and comparison | Visuals | Filters | Next action | Data dependency |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | Is performance on track? | Main metric vs target/prior period | Trend, ranked drivers, exceptions | Period, organizational scope | Investigate a driver | Confirm actual model |
| Analysis | What explains the change? | Change and contribution | Breakdown, trend, diagnostic detail | Same period plus segment | Drill to affected entity | Confirm grain and dimensions |
| Details | What specifically needs attention? | Entity-specific status | Searchable/filterable table or matrix | Preserved context | Return or supported action | Confirm entity key |

Replace generic examples with domain-specific pages. Do not add pages just to populate a template.

## Interaction contract

| Trigger | Mechanism | Target | Preserve | Change | Recovery |
| --- | --- | --- | --- | --- | --- |
| Choose period | Slicer | Relevant visuals/pages | Organizational scope | Time window | Explicit default-period reset |
| Open filters | Display bookmark | Filter panel | All data selections | Panel visibility | Close panel |
| Inspect entity | Drillthrough | Detail page | Required dimension context | Entity focus | Back button |

## Metric contract

For every metric include an actual model binding if known, definition, unit, aggregation, date basis, denominator and favorable direction. Distinguish percentage points from percentage change. Explain missing targets and undefined denominators. Never use a fabricated refresh timestamp or live-data claim.

## Implementation status

State which deliverables exist, what was tested in the target host, and what remains unverified. Report the functional result (ready for the verified scope, needs revision, or blocked) separately from the visual verdict (meets brief, needs revision, or untested). A layout specification and a theme are useful deliverables even without tenant access, but must be identified accurately.
