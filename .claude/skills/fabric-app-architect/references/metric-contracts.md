# Metric contracts and model boundaries

Complete this contract before inventing visuals or rewriting DAX. Use real metadata when available; write `unresolved` for an unknown binding rather than manufacturing a table or measure name.

| Field | Required decision |
| --- | --- |
| Identity | Stable metric key, business name, owner, exact model measure or approved expression |
| Meaning | Business definition, included/excluded records, date relationship |
| Grain | Entity and time grain; duplicate-handling policy |
| Aggregation | Additive, semi-additive or non-additive; intended grand/subtotal calculation |
| Period | Calendar/fiscal rules, timezone, completed/partial period policy |
| Comparison | Prior period, prior year or target; like-for-like cutoff |
| Denominator | Eligible population and behavior for zero or missing denominator |
| Unit | Currency, conversion source/date, quantity or rate; decimal/scale format |
| Direction | Higher/lower/in-range favorable, with business reason |
| States | Zero, missing, no rows, unavailable target and unsupported selection |
| Evidence | Representative entity, filtered selection and total with expected result |

## Common traps

- Recompute ratios at the total grain; do not sum percentages or average unweighted ratios without a business rule.
- Treat a balance or headcount snapshot differently from transactions across time. Do not sum a month-end balance over months.
- Define what an open event means at the selected date; a current status is not automatically historical status.
- Compare incomplete periods using an agreed cutoff; do not silently compare partial current month with full previous month.
- Keep percentage change distinct from percentage-point movement. Specify handling for negative/zero baseline.
- Do not use the current clock as a data freshness timestamp. Identify ingestion, model refresh and latest business date separately.
- Preserve blank where it carries meaning; replacing every blank with zero can misstate unavailable information.
- Keep numeric measures numeric; use supported format strings for presentation unless text output is deliberately needed.

## Model and access boundaries

Record whether the report uses a local model, a service semantic model or an SSAS live connection. Identify where a requested measure exists and where it can actually be changed. Confirm support before adding local tables or converting a connection. A report-only styling task does not authorize restructuring the semantic model.

Separate the consumer journey into app, report, semantic model, gateway/source identity and row/object permissions. Check only relevant layers with authorized access. An administrator's successful query and a correct EffectiveUserName alone do not establish consumer report access.

## Focused verification examples

Use at least one representative detail and total for a changed aggregation; use matching period cutoffs for changed comparisons. Exercise blank/zero only when it affects the changed metric. For UI-only work, verify bindings were preserved and report suspected semantic errors without changing the business definition.
