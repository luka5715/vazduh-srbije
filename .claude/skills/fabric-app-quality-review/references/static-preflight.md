# Static preflight scope

The script expects all four files from the companion visual designer: `powerbi-theme.json`, `design-tokens.json`, `desktop-layout.json`, `mobile-layout.json`. It only understands companion specification version `1.0`. Run it against generated or intentionally adapted companion assets, not arbitrary Power BI files.

```bash
python3 scripts/check_design_assets.py --assets-dir ./app-assets --report ./static-review.json
```

The optional report must be a new file. The script is read-only with respect to source assets. It prints a JSON evidence report and exits nonzero for a failed check. An unreadable/missing file, duplicate JSON key, non-finite number, malformed structure, invalid rectangle or bad contrast is a failure, not an untested result.

## Layout contract

Each layout has `artifactType: layout-specification-not-pbir`, `specVersion: 1.0`, a positive `canvas.width/height`, and nonempty `regions`. Each region has a unique string `name` and finite numeric `x`, `y`, `width`, `height`. Positions are nonnegative; size is positive. Desktop `mobileOrder` must match mobile region order. Every mobile name must resolve to a desktop component; intentionally omitting desktop-only components is allowed.

For necessary intentional layering, use `allowedOverlaps` entries such as `{"regions": ["background", "header"], "reason": "Header is placed over the background"}`. Declare only actual intended pairs; do not suppress every collision. The checker cannot decide whether deliberate layering looks good.

## Token and theme contract

Tokens use `artifactType: fabric-design-tokens`, `specVersion: 1.0` and `#RRGGBB` colors. Text, secondary text and defined status labels are checked against their surfaces at 4.5:1; chart colors at 3:1. These are design roles, not a determination that every rendered element meets WCAG. Border colors are decorative by default. Theme palette, surface and main text must match tokens.

## Separate evidence still required

Check actual font sizes, visual boundaries, focus/selected states, chart labels and keyboard order in the host. Validate native theme/PBIR files against Microsoft's target schemas. Check real measure bindings, totals, refresh metadata, filtering and consumer access. Judge visual fitness for the brief through [visual-quality-gate.md](visual-quality-gate.md); the report lists it, with schema, host rendering, model/permissions and full accessibility/performance, as an Untested row every run. `Pass for static scope` must not be shortened to “the app passed QA.”
