# Premium visual direction and motion

Use this contract when the user explicitly asks for a striking modern application or says the previous design is too basic. Keep the business purpose and host contract intact.

## Author the composition

- Choose a recognizable direction and implement it: an analytical studio with a dominant chart, editorial typography, a small number of supporting metrics and carefully composed detail. Do not treat a light/dark palette swap as a redesign.
- Give the primary decision the largest visual area. Use a deliberate asymmetric grid rather than repeating equal KPI tiles. Integrate the main value, unit, comparison and trend into one coherent analytical surface.
- Use one brand accent with stable semantic category colors. Create depth through restrained surface contrast, subtle shadows and optional static gradients; keep text and quantitative marks crisp. Keep overlays opaque and legible.
- Craft charts: readable axes, meaningful comparison, directly labeled important values, consistent series identity, purposeful hover details and enough room for labels. Do not fabricate fluctuations, unsupported insights or decorative gauges.
- Give rankings and detail views comparable care: clear entity identity, aligned values, contextual micro-trends and an explicit path to deeper analysis. Provide an actual interaction rather than a decorative action button.
- Use the asset generator as a structural starting point. Its conservative output is not evidence that a premium brief has been fulfilled. Author the final layout and inspect the rendered result.

## Define motion as behavior

For an authorized web prototype or frontend, define trigger, affected elements, duration, interruption behavior and reduced-motion fallback. These are design defaults, not Microsoft feature guarantees:

| Interaction | Suggested treatment | Typical duration |
| --- | --- | --- |
| Hover/pressed state | Small surface or elevation change; no essential hover-only content | 120–180 ms |
| Navigation | Move the active indicator and transition the new content without layout jumps | 220–320 ms |
| Detail panel | Slide and gently fade an opaque panel; restore focus on close | 280–400 ms |
| Filtered metrics/charts | Interpolate values and chart geometry to the new state | 400–600 ms |

Render initial data immediately. Avoid looping decoration, count-up-from-zero intros and animation that delays access to data. Keep the final values accurate. For chart transitions with different point counts, resample to a common geometry and preserve the final observations. Cancel stale transitions when filters change quickly. Respect reduced motion with immediate stable states. Announce final results, not every animation frame.

## Preserve implementation honesty

Before committing animation to a Power BI report, org/workspace app or Fabric workload, inspect the actual host and verify relevant current documentation. Label each effect as verified in the target host, web-prototype-only, or requiring further implementation validation. Do not promise arbitrary CSS, JavaScript, smooth chart interpolation or sliding overlays from a theme JSON or bookmark alone. Keep unsupported effects as prototype intent and provide a supported static or navigation alternative. Do not silently switch the user's target platform.

## Inspect before calling it finished

Render the landing and detail states at the actual target size. Check typography, label collisions, hierarchy and dense/empty states. On mobile, recompose the page and simplify dense tables; do not just shrink desktop. Verify one filter change, one detail open/close, focus recovery, reset and reduced motion when implemented. Confirm that the requested visual improvement is visible in the composition and components, not merely asserted in prose. Report the inspected surface accurately.
