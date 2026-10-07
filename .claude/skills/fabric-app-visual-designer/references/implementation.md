# Implementation routes

## Theme route

Use the bundled palette and text defaults as a conservative starting point. Validate additional theme keys and visual properties against the target release's schema. A theme does not set an entire app shell, create navigation, implement RLS, position visuals or construct a complete report. Existing per-visual formatting can override a theme. Import the theme and inspect representative visuals before applying broad changes.

Official source: https://learn.microsoft.com/en-us/power-bi/create-reports/report-themes-create-custom

## PBIP/PBIR route

Inspect the existing structure and `$schema` declarations before editing. Preserve model binding, actual field/measure references, resource registration, IDs and business filters unless the requested change requires otherwise. Use current supported authoring tools when available. Validate schema and semantic references; parsing JSON alone is insufficient. Do not construct guessed visual property bags or rewrite unsupported legacy/internal files. Save pending Desktop changes before external changes; inspect and apply through the host's supported workflow.

Official sources: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report and https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-external-editing

## Desktop-only route

If report editing tools are unavailable, provide exact build instructions and usable theme/layout assets. Include visual type, actual model fields if known, rectangle, title, formatting, interactions, bookmark settings and mobile treatment. Never claim that these instructions are an already-created PBIX.

## Host review

Inspect the report inside its intended app, not only the Desktop canvas. App navigation consumes space and differs across hosts. Verify audience and source permissions as a consumer. Do not hide filters or action chrome needed to understand or recover context merely to achieve a cleaner screenshot.

Official app source: https://learn.microsoft.com/en-us/power-bi/explore-reports/org-app-items

## Mobile and accessibility

Create a separate mobile layout and test it. Configure tab order and meaningful alt text. Avoid static alt-text claims that become false under filtering; use dynamic context where supported.

Official sources: https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-mobile-layout-view and https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-accessibility-creating-reports
