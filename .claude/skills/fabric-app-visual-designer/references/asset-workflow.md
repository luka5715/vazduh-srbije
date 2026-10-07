# Portable asset workflow

Resolve paths from the skill folder. The scripts work with Python 3.9+ on platforms that provide it; on Windows use `python` or `py -3` if `python3` is unavailable. Use paths supplied by the user or the current task. Do not assume a workspace root.

```bash
python3 scripts/generate_design_assets.py --output-dir ./app-assets --mode dark --preset operations --width 1280 --height 720 --kpis 3 --brand '#22C55E'
```

| File | Purpose | Import boundary |
| --- | --- | --- |
| powerbi-theme.json | Base palette and text defaults | Import as a report theme; schema/host validation still required |
| design-tokens.json | Role colors, spacing and recalculable contrast checks | Design specification, not a Power BI theme |
| desktop-layout.json | Named desktop component rectangles | Map through Desktop or validated PBIR |
| mobile-layout.json | Explicit order and mobile container sizes | Conceptual units; build with the supported mobile layout editor |

Use the generator only for a scaffold after selecting the composition. Choose `executive`, `operations` or `analysis` and zero to five separate KPI containers. The default is zero; the primary value can share an analytical surface. Existing calls with three to five KPIs still work. Supported bounds are 960–3840 wide and 640–2160 high. These are script limits, not Power BI product limits. Geometric fit says nothing about visual distinction or readability.

The original brand is preserved as `brand`. `brandText` and `brandChart` are separate contrast-adjusted variants; `onBrand` is black or white chosen by measured contrast. The generator never promises that all series are distinguishable or that a complete page is accessible.

Use the companion quality skill's `scripts/check_design_assets.py --assets-dir <app-assets>` when available. Inspect its warnings and fix applicable failures. It recalculates checks from the input rather than trusting cached pass flags. Without the companion, inspect the same JSON, rectangles and contrast directly. Validate Microsoft's theme schema separately and render actual visuals.

Do not add `$schema` pointing to a guessed or nonexistent file. For official schema validation, resolve the Microsoft theme schema for the target release and record its version/source in verification evidence. JSON parsing is a separate and weaker check.
