# Motion and implementation honesty for premium briefs

Use this contract when the user explicitly asks for a striking modern application or says the previous design is too basic. Keep the business purpose and host contract intact.

## Define motion as behavior

For an authorized web prototype or frontend, define trigger, affected elements, duration, interruption behavior and reduced-motion fallback. These are design defaults, not Microsoft feature guarantees:

| Interaction | Suggested treatment | Typical duration |
| --- | --- | --- |
| Hover/pressed state | Small surface or elevation change; no essential hover-only content | 120–180 ms |
| Navigation | Move the active indicator and transition the new content without layout jumps | 220–320 ms |
| Detail panel | Slide and gently fade an opaque panel; restore focus on close | 280–400 ms |
| Filtered metrics/charts | Interpolate values and chart geometry to the new state | 400–600 ms |

Render the correct initial values immediately; do not count up from zero on first paint, and keep value interpolation on filter change under about 600 ms. Looping or ambient effects are acceptable only when the brief asks for them or they encode data, they stay outside the data layer, pause when not visible, show one static frame under prefers-reduced-motion, and leave every overlaid label at the required contrast at the effect's maximum intensity; inspect that state and record it. Reach that state with a seeded or scenario dataset that drives the effect to its maximum; when none exists, record the check as Untested with the state that would be needed. Keep final values accurate; for chart transitions with different point counts, resample to a common geometry and preserve the final observations; cancel stale transitions when filters change quickly; announce final results, not every frame.

## Preserve implementation honesty

Before committing animation to a Power BI report, org/workspace app or Fabric workload, inspect the actual host and verify relevant current documentation. Label each effect as verified in the target host, web-prototype-only, or requiring further implementation validation. Do not promise arbitrary CSS, JavaScript, smooth chart interpolation or sliding overlays from a theme JSON or bookmark alone. Keep unsupported effects as prototype intent and provide a supported static or navigation alternative. Do not silently switch the user's target platform. For a Fabric Apps/Rayfin frontend the host surfaces to verify are the Fabric portal iframe (`?fabricEmbedded=true`) and the standalone App URL, plus reduced-motion and visibility behavior on the phone the user uses; everything else is the app's own web code.
