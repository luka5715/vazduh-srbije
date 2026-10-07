# Platform boundaries and current-source checks

Baseline checked: 2026-10-07. Recheck the relevant source at use time; tenant settings, client versions, supported items, and licensing can differ.

| Host | Design control | Implementation implication |
| --- | --- | --- |
| Fabric org app | App branding, landing content, sections and navigation within the host's options | Design the host shell and included items separately; verify eligible item types and permissions. |
| Power BI workspace app | Packaged report experience and audience navigation | Verify update/distribution behavior for this app type; do not transplant org-app instructions. |
| Power BI report | Canvas, visuals, buttons, slicers and report interactions | A report theme does not replace the Fabric shell. |
| Fabric Apps workload (Rayfin) | Application frontend and backend through its development stack | Separate from an org app and a Power BI report; verify current SDK, capacity, region, tenant enablement, hosting access and item/data permissions. |
| Custom embedded app | Custom web UI around an embedded report | Requires its own application, identity and embedding architecture; choose only when requested or justified. |
| Power BI Report Server | Report features supported by the target server and Desktop release | Verify compatibility; do not assume Fabric cloud functions are available. |

## Sources to verify

- Fabric Apps workload: https://learn.microsoft.com/en-us/fabric/apps/overview
  At this check the workload is documented as preview. Select it for an actual application development request, not merely because the user calls a report an app. Follow the current project tooling for frontend, data/API and authorization work. Verify runtime prerequisites rather than embedding guessed SDK commands in the handoff.
- Org apps: https://learn.microsoft.com/en-us/power-bi/explore-reports/org-app-items
  Org apps package content as Fabric items. At baseline they support app customization and audiences, and multiple apps in a workspace. Verify the supported content list, access propagation, audience behavior on mobile, sidebar/focus behavior and workspace roles. Access through another grant can survive app removal.
- Themes: https://learn.microsoft.com/en-us/power-bi/create-reports/report-themes-create-custom
  Theme JSON styles reports, not the entire host. Validate against the public schema for the target version and verify the import in Desktop.
- PBIR: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report
  PBIR provides separate, schema-described report files that support external authoring. Preserve the existing model reference and registered resources. Distinguish supported definition files from legacy/internal files; do not modify unsupported formats.
- Mobile: https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-mobile-layout-view
  Design and verify a mobile layout explicitly; desktop scaling is not equivalent to a considered phone experience.
- Interactions: https://learn.microsoft.com/en-us/power-bi/create-reports/button-navigators and https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-bookmarks
  Verify available navigator and bookmark settings before authoring.
- Write-back: https://learn.microsoft.com/en-us/power-bi/create-reports/translytical-task-flow-tutorial
  A supported pattern combines a Power BI input/button with a Fabric user data function and a writable data source. Check current prerequisites and function access. Do not infer arbitrary CRUD from a visual design.
- Accessibility: https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-accessibility-creating-reports
  Configure meaningful alt text and tab order; supplement color with labels/markers.
- Microsoft report-authoring tooling: https://learn.microsoft.com/en-us/power-bi/developer/agentic/power-bi-report-skill-overview
  Check available first-party authoring tools before manually constructing definitions. Documentation does not imply the tool is installed or connected in this session.

Do not promise arbitrary CSS, automatic responsive breakpoints, sticky web components, animated transitions or unrestricted custom HTML inside the native Fabric shell. Map each proposed behavior to a verified host capability or identify the required extension.

Distinguish the shell from hosted content: a custom frontend inside a Fabric Apps workload can use web techniques supported by its stack; this does not give a Power BI report arbitrary CSS. Org app availability does not prove Fabric Apps workload availability. Record a source URL, check date and target host for material version-sensitive claims; do not copy preview/GA, license thresholds or supported-item lists forward without rechecking. Inside the portal iframe a Fabric Apps frontend has no addressable URL; URL-carried state needs the app-state bridge where the tenant has it.
