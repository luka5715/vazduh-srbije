# Focused acceptance cases

Select cases that exercise the changed behavior. Record before/after context and evidence, not just a ticked box. Do not fabricate test data in a live model to complete this list.

| Change | Cases | Expected evidence |
| --- | --- | --- |
| Palette/type/layout | Light/dark if provided; long title; negative/large value; Fit to page | Contrast calculation and actual render; no clipped primary content |
| Filter panel/bookmark | Single selection → open/close → multi-selection → reset | Data preserved by visibility controls; reset matches stated scope |
| Measure/comparison | Representative detail, total, multi-select, partial period, blank/zero | Expected calculation tied to business definition |
| Navigation/drillthrough | Valid entity, no selection, return, relevant filter context | Supported route and intelligible disabled/missing-context state |
| Table stability | Same viewport, shorter/longer labels, changing filter sets | Stable container/columns and deliberate wrapping |
| Consumer access | Actual affected user/role across app/report/model/source | Exact failing layer, approved minimal correction and retest |
| Mobile | Landing, filters, detail, back, touch targets | Target client evidence; screenshot alone cannot prove interactions |
| Write-back | Valid input, rejected input, unauthorized identity, double submit, stale row | Correct row, server enforcement, concurrency, audit and honest outcome |
| Release | Intended environment/model binding, app content version, rollback target | Consumer smoke test and reproducible release/recovery steps |

## Evidence grades

Use `static`, `mockup`, `Desktop`, `service`, `consumer`, `mobile` or an explicit frontend/API environment. A success at one surface does not automatically pass another. Preserve reproducible steps for substantive defects. Fix the cause, then rerun the affected scenario; broad repeated testing needs a concrete reason.
