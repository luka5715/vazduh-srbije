---
name: fabric-app-quality-review
description: Review and improve Microsoft Fabric apps and Power BI reports before delivery. Use for professional-quality audits, UX and visual checks, visual fitness against the agreed design brief, app navigation, mobile layout, theme/PBIR validation, metric accuracy, filtering, performance, accessibility, consumer permissions, and fixing a modern app that looks polished but behaves incorrectly. Distinguish verified results from checks unavailable without the target host or model. Not for inventing a new concept or visual system from scratch; hand that to fabric-app-architect or fabric-app-visual-designer and review the result.
---

# Fabric App Quality Review

Assess whether the app is clear, truthful, usable, stable and implementable. Inspect the real artifact before judging quality. A good screenshot alone is insufficient evidence of functioning interactions or correct measures.

Report visual fitness for the brief separately from functional correctness. For a new modern/premium application, a user-rejected design or a brief with explicit visual requirements, read [visual-quality-gate.md](references/visual-quality-gate.md). A working, readable interface can still fail the requested visual standard. Do not declare the design finished because click tests and geometry checks passed.

Read [review-matrix.md](references/review-matrix.md) and [verification-playbook.md](references/verification-playbook.md). Respond in the user's language. Lead with the most consequential finding and fix authorized reversible issues rather than leaving a generic checklist.

## Establish review scope

Identify the host, artifact type, user audiences, devices, actual model, important metric definitions and existing design contract. Inspect the supplied report, screenshots, PBIR, theme and source metadata as available. Treat screenshots as visual evidence only. Do not invent access to Desktop, Fabric, the model, a mobile client or a benchmark tool.

Record each check as Pass, Fail, Untested or Not applicable, with evidence. State the verification surface: static files, mockup, Desktop render, service render, consumer session, or mobile client. Keep numerical design scores optional; never use an arbitrary overall score as proof of correctness.

Read [acceptance-cases.md](references/acceptance-cases.md) to choose a compact set of relevant scenarios. Use [review-report.md](assets/review-report.md) when a written review artifact is requested. Do not make a minor visual fix depend on a full tenant security or performance audit.

## Review in this order

1. **Data meaning and access:** bindings exist; totals and comparison logic fit the metric; units/periods are consistent; consumer can reach the intended content and source. Hidden navigation and app audiences do not replace model/source security.
2. **Task completion:** landing page answers the main question; navigation reaches the next analysis; drillthrough/back work; slicers, cross-filtering and reset preserve/change the intended context.
3. **Truthful states:** zero, missing, no-data, missing targets and undefined ratios are distinct; refresh metadata has a real source; write-back uses a verified integration and shows actual outcomes.
4. **Visual quality:** contrast, clipping, alignment, stable sizing, consistent color and number formats, chart accuracy and readable hierarchy at viewing scale. When a visual brief or design contract exists, also compare the rendered composition with it using [visual-quality-gate.md](references/visual-quality-gate.md) and treat an unmet explicit visual requirement as a substantive finding.
5. **Mobile and accessibility:** purpose and priority metrics remain clear; filters and detail are usable; meaningful alt text and logical tab order exist; color is not the sole signal.
6. **Performance and host compatibility:** inspect measured visual/query timings when tools are available; target the actual app and report version; validate custom-visual dependencies and applicable exports.

Distinguish Power BI report/app checks from a Fabric Apps/Rayfin frontend. For the latter, review web/API behavior and item/data authorization in the actual stack; a report theme check has no bearing on backend correctness. If the host is unclear, resolve the affected surface before diagnosing a product limitation.

For a UI-only redesign do not silently rewrite measures or change business definitions. Report a suspected analytical issue, gather evidence and fix only when the requested scope supports it. Avoid broad security changes; validate and explain the exact missing permission before suggesting a change.

## Diagnose precisely

For each finding record the page/visual or file, reproduction conditions, observed result, intended result, severity, evidence, proposed correction and verification. Use these severities:

- Blocker: data exposure, unavailable core journey, invalid definition, or materially misleading results.
- Major: broken common interaction, unreadable primary information, incorrect filter context, or severe measured performance regression.
- Major for a visual-design brief: a materially unmet agreed visual criterion, supported by a visible example; this does not imply a data or functional defect.
- Minor: local consistency, spacing, label or secondary usability problem.

Use the smallest safe correction. Preserve IDs, model references, filter context and unrelated formatting. When changing bookmarks, verify Data/Display/page scope rather than resetting every bookmark. When fixing table movement, inspect actual column autosizing, container bounds and visual formatting instead of attributing it to DAX without evidence.

## Verify fixes

Validate theme/PBIR against the relevant current schema; also inspect bindings and render in the target host when possible. Test only scenarios relevant to the change, then stop after they pass unless new issues appear. Recheck filtered, cleared, no-data and representative multi-selection states for affected components. Use representative actual consumer identity for access checks when authorized and available; administrative success does not establish consumer access.

For assets produced by `fabric-app-visual-designer`, run `python3 scripts/check_design_assets.py --assets-dir <asset-directory> --report <new-report-path.json>` with this script resolved relative to the skill folder. It uses only Python 3.9+ standard library and never calls the network. Exit 0 means checks passed for its static scope; exit 1 means a failed check; invalid CLI usage returns 2. Read the report, including its explicit Untested rows. `check_design_assets.py` and the generator are Not applicable to a web frontend.

The script checks JSON, companion-format structure, finite rectangle geometry, names, bounds, unexplained overlap, mobile mapping, token contrast and basic theme/token consistency. It recalculates contrast instead of trusting stored pass flags. It does not validate Microsoft's theme/PBIR schemas, inspect actual labels, query the model, open Power BI, measure latency or establish access/security. Use it only on the documented companion asset format; review arbitrary existing themes/PBIR through the appropriate schema and host instead. Read [static-preflight.md](references/static-preflight.md) for the exact contract.

When Python or a companion skill is unavailable, perform the equivalent checks with available tools and state what actually ran. No fixed installation path or agent-specific connector is required.

Do not claim performance improved without measurements under comparable conditions. Do not claim security passed from app navigation alone. Mark unavailable host, device, schema, data or access checks Untested and explain their practical impact concisely.

## Deliver the review

Lead with separate visual and functional conclusions when both are in scope. Functional: ready for the verified scope, needs revision, or blocked by named Blocker findings. Visual: meets brief, needs revision, or untested. Give concrete evidence for each; do not promise subjective appeal. Include only substantive findings, corrections and remaining checks. For implementation tasks, deliver the corrected artifact or exact actionable settings. Do not publish or share because a review was requested; respect existing user authorization.
