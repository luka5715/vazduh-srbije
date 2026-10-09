# Deploying a Rayfin app to Microsoft Fabric

Guide: `node_modules/@microsoft/rayfin-guide/assets/docs/app-backend/deploy.md`, `hosting/index.md`,
`cli/environment-variables.md`. Live experience: first deploy and redeploys of a Fabric App on a trial
capacity, 2026-10-08.

## Prerequisites

- Tenant admin has enabled **Fabric Apps (preview)** (admin portal → Tenant settings); propagation takes
  minutes. Without it `rayfin up` cannot create the item.
- A workspace with Fabric capacity (trial or paid); **Edit** on the item (contributor/admin) to deploy.
- Node.js 20+ (CI on 22). No Docker: the default provider is Fabric.
- OS keychain for the token cache. Linux, dev containers and Codespaces without a keychain:
  `npx rayfin login --encryption-fallback-enabled` (plaintext cache, development only; `npx rayfin logout`
  afterwards).

## Login only where a browser exists

`npx rayfin login` opens an interactive Entra sign-in (MSAL loopback). A cloud agent session has no
Fabric account and its network blocks `api.fabric.microsoft.com`, so **deploys happen on the owner's
machine** (or Codespaces). Pushing to GitHub does not change the live app - say this explicitly in every
handoff. CI can deploy only with a service principal (`npx rayfin login --service-principal --client-id
... --client-secret ... --tenant ...` or a pre-acquired `RAYFIN_TOKEN`), which needs tenant secrets;
keep CI to the no-secret gates unless the owner sets that up.

## The sequence

```bash
npm ci && npm --prefix rayfin/functions ci
npx rayfin login                      # or: npx rayfin login status
npx rayfin up -n --workspace "<workspace name>"   # dry run
npx rayfin up --workspace "<workspace name>"      # real deploy
```

1. **Dry run (`-n`)** validates local inputs (frontend path, build root, `host.json`), authenticates,
   resolves the workspace (read-only Fabric calls) and prints the plan. Check two things: the workspace
   name is the intended one, and the plan says the **existing item is reused**. If it would create a
   second item with the same name, stop - wrong workspace or an account without rights to the item; a
   second item has an empty database.
2. **Real deploy**: (1) create or reuse the item, (2) fetch the publishable key, (3) sync runtime settings
   from `rayfin.yml` (auth, services, `assetAccess`, functions auth mode), (4) apply the SQL schema
   generated from decorators, (5) build and upload static content (`buildCommand` → `folder` → ZIP ≤ 100
   MB) and functions, (6) write `rayfin/.deployments.json` and merge `RAYFIN_PUBLIC_*` into `rayfin/.env`
   (both git-ignored). It prints the **hosting URL**, the **portal link** and the **deployment id**:
   record them.
3. **After deploy**: open from the portal (session handed off in the iframe) and from the App URL (sign-in
   button); **Ctrl+F5** - browsers keep the previous bundle and the old code looks like a failed deploy;
   check the app's own job log; let a second user with "Run and interact" open it.
4. **Record**: a row in the README deploy log (date, tag, outcome, measured numbers) and
   `git tag -a deploy-YYYY-MM-DD -m "..." && git push origin deploy-YYYY-MM-DD`. The portal cannot tell
   which commit is live; the tag can.

### Item reuse on later deploys

- From the same machine `rayfin up` reads `rayfin/.deployments.json` and updates the item without asking.
- From a new machine the file is missing, so the CLI asks whether to reuse the same-named item: answer
  **yes** (`--yes` approves automatically, but it also approves capacity assignment - use it only when both
  are acceptable). "No" or a wrong workspace creates a second item with an empty database.
- `--item-name` only changes the display name; never point at an item created from another template (the
  schemas conflict).
- Measured values in the README (duration, rows) belong to a specific version; re-measure after a deploy
  that changes the workload.

## Partial deploys

| Command | Updates | Does not |
| --- | --- | --- |
| `npx rayfin up` | everything: settings, schema, static content, functions | — |
| `npx rayfin up db apply` | schema only (`--force` allows destructive changes - can lose data) | static, functions |
| `npx rayfin up staticapp deploy [--skip-build]` | static content only; needs an existing remote endpoint ("No remote endpoint configured" → run a full `up` first) | `assetAccess`, auth settings, functions auth mode |
| `npx rayfin up functions deploy [--skip-build]` | functions only | project-settings validation |
| `npx rayfin up status [--json]` | reports the active deployment and management endpoint health | app routes |
| `npx rayfin up --exclude-services staticHosting` | everything but the static bundle | — |

`assetAccess: protected | public` under `staticHosting` and `services.functions.auth.type: application`
are **runtime settings**: they change only through a full `rayfin up`.

## Rollback

```bash
git checkout deploy-2026-10-08
npm ci && npm --prefix rayfin/functions ci
npx rayfin up staticapp deploy      # frontend of that version
npx rayfin up functions deploy      # functions of that version
git checkout main
```

The schema moves forward only: never run a full `up` or `db apply` from an old tag (the CLI blocks
destructive changes; `--force` deletes data). Older code keeps working on a newer schema as long as the
changes were additive. `rayfin/.deployments.json` and `rayfin/.env` are per machine - roll back from the
machine that deployed, or keep copies.

## "Deployment failed: fetch failed"

If this appears **before** any step runs, it is the network, not the code: `undici` (Node's `fetch`)
could not reach `api.fabric.microsoft.com`.

- Corporate proxy or VPN: Node's built-in `fetch` (undici) ignores `HTTP(S)_PROXY`. Node 24+ honours
  `NODE_USE_ENV_PROXY=1`; check `node --help` for the variable on your version (Node 22.22 does not list
  it). Without it, run the deploy from a network where the Fabric API is reachable directly.
- Private CA / TLS interception: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. Never disable TLS verification.
- Check connectivity separately from the CLI (`curl -I https://api.fabric.microsoft.com/v1` and
  `npx rayfin login status`); a cloud sandbox that blocks the host will fail the same way.
- `RAYFIN_FABRIC_API_URL` can point the CLI at a credential proxy (bearer tokens are forwarded there -
  trusted hosts only).

## Other failure signatures

| Symptom | Cause / fix |
| --- | --- |
| 401 / 403 from `rayfin up` | session expired: `npx rayfin login`, retry |
| `Failed to acquire authentication token` on Linux/Codespaces | no keychain: `--encryption-fallback-enabled` |
| GraphQL "Internal server error" after a successful deploy | `@text()` without `max` → `NVARCHAR(MAX)`; add `max`, `db apply --force` (review the listed operations) |
| `Dialect is required when Data module is enabled` (400) | add `dialect: mssql` under `services.data` |
| Static deploy > 100 MB | drop source maps and large assets |
| `Missing required Rayfin client environment variable: VITE_RAYFIN_PUBLISHABLE_KEY` at build | `.env.local` not generated: `npx rayfin up` or `npx rayfin env --framework vite`; the demo build needs no key |
| Old UI after deploy | cached bundle: Ctrl+F5 |
| Reload of a sub-route returns 404 | static hosting has no SPA fallback: keep one route and select pages with `?view=`; a copy of `index.html` in `dist/<route>/` is the workaround |
| Popup blocked at sign-in | `ensureSignedInWithFabric` must run from a click handler; in the portal iframe the session is handed off automatically |

## Static hosting facts worth remembering

- `staticHosting`: `folder`, `buildCommand`, `indexDocument`, optional `path`/`root`, `assetAccess`.
  The CLI refreshes `.env.local` (`VITE_RAYFIN_API_URL`, `VITE_RAYFIN_PUBLISHABLE_KEY`, `VITE_FABRIC_*`)
  before the build; the deployed bundle reads `rayfin.config.json` written next to it, so promoted bundles
  do not bake in a stage.
- The hosting origin is added to `allowedRedirectUris` automatically (needed for the postMessage handoff).
- Only Fabric SSO works after deploy; keep `password.enabled: false`.
- The app inside the Fabric portal runs in a cross-origin iframe without its own URL: shareable
  deep links work only on the standalone App URL (or with `@microsoft/rayfin-app-state-fabric`).

## Capacity

Trial capacities expire (the portal shows remaining days). The database lives only while the workspace
has capacity: before expiry move to a paid capacity or export the long-term tables (SQL editor in the
portal or the connection string). Follow usage in *Microsoft Fabric Capacity Metrics*; GraphQL
requests, SQL compute/storage, function execution and OneLake reads are what costs CU.
