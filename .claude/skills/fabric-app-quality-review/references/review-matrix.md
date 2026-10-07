# Review matrix

Select the rows relevant to the artifact and change. Use Pass / Fail / Untested / Not applicable plus concrete evidence.

| Area | Check | Evidence |
| --- | --- | --- |
| Product | Main audience and decision are clear | Page contract and visible landing page |
| Visual brief | Requested visual ambition is met separately from technical correctness | Filled design contract or inferred criteria; verdict Meets brief / Needs revision / Untested, not Pass/Fail |
| Host | App-level and report-level navigation cooperate | Render inside intended app |
| Model | All fields/measures exist and use intended grain | Model metadata and query results |
| Metrics | Units, denominator, period, target, favorable direction and totals agree | Definitions plus filtered examples |
| Navigation | Home, selected page, detail and back are coherent | Click path in target host |
| Filters | Scope, synchronization and default/reset behavior match the contract | Single, multi-select and reset trials |
| Bookmarks | Display controls preserve data context unless intended otherwise | Bookmark settings plus before/after selections |
| States | Missing and zero are distinct; target absence/undefined ratio are intelligible | Actual edge-state data and render |
| Charts | Encoding, sorting, axes and comparisons are truthful | Render plus underlying values |
| Layout | No clipping/overlap; key text remains readable at viewing scale | Full-page and focused screenshots |
| Stability | Slicer changes do not unintentionally move tables or controls | Before/after render with identical viewport |
| Brand | Typography, palette, spacing, icons and status semantics agree | Tokens versus representative pages |
| Accessibility | Contrast, labels/markers, alt text and tab order are suitable | Contrast calculation and keyboard/reader checks |
| Mobile | Priority content, navigation, touch and detail are usable | Mobile layout plus actual-client verification |
| Performance | Query and visual latency fit the agreed target | Comparable measured timings; no invented budget |
| Access | Representative consumer reaches report, model and source | Authorized consumer test including RLS/OLS where applicable |
| Write-back | Intended row, input validation, permission, concurrency and outcome work | Authorized nonproduction trial when supported |
| Definition | Theme/PBIR structure, references and resources are valid | Target schema check plus host open/apply |
| Delivery | Deliverable type and verification scope are reported accurately | Artifact exists and result matches claims |

A static-only review cannot pass rows requiring runtime or consumer evidence. A missing test environment is Untested, not automatically a failure.
