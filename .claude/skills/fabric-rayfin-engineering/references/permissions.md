# Permissions, sharing and audience

Guide: `app-backend/index.md` (item permissions), `data/permissions.md` and `data/overview.md` (entity
roles, anonymous access), `functions/index.md` (identities). Live: an internal Fabric App shared inside
one tenant, 2026-10-08.

## Item permissions (who can open and who can deploy)

| Permission | Allows | Who gets it |
| --- | --- | --- |
| **Run and interact** (Read and execute) | open the app, call GraphQL and functions | default for all workspace members; grant to anyone else explicitly |
| **Edit** (Write) | `rayfin up`, schema apply, settings, child services | needs **contributor** or **admin** workspace role |
| **Reshare** | grant others access | needs **admin** workspace role |

Workspace roles do **not** supersede item-level permissions: a viewer role alone is not enough; share the
item. Verify consumer access with a real second account - administrative success proves nothing.

## Audience

- Default: accounts of the **same Entra tenant** with Run and interact. Sign-in is Fabric SSO only
  (`fabric.enabled: true`, `password.enabled: false`); in the portal iframe the session is handed off, on
  the standalone App URL a click opens the broker popup.
- **Guests (B2B) and anonymous/public access** are tenant-admin decisions: the admin switch
  "Enable anonymous data access for Fabric Apps" (under Fabric apps (preview)) must be on, entities need
  `@anonymous('read')`, and the static bundle needs `staticHosting.assetAccess: public` (changed only by a
  full `rayfin up`). Until then "javni pristup" is **not** a promise the app can make.
- Functions **cannot** be invoked anonymously: their database access uses the caller's Rayfin token. A
  public read-only app can show stored data but cannot let anonymous visitors trigger a sync.

## Entity-level rules (`rayfin/data`)

```ts
@entity()
@authenticated(['read', 'create', 'update'])         // no delete for anyone, no anonymous
export class DailyStat { ... }

@entity()
@anonymous('read')                                   // public read ...
@authenticated(['create', 'update'], {               // ... writes only for an operator claim
  policy: (claims) => claims.role.eq('operator'),
})
export class Station { ... }
```

- Built-in roles only: `anonymous`, `authenticated`. Prefer the `@anonymous()`/`@authenticated()` shorthands
  over `@role(...)`.
- `policy: (claims, item) => ...` compiles to a DAB OData check at `db apply`; `claims.sub`, `claims.email`,
  `claims.role`; `.eq()`, `.and()`, `.or()`; `include`/`exclude` restrict fields per role and action.
- Before relying on a claim in Fabric, **verify in the real tenant** which claims the Rayfin token carries
  and that a direct mutation by a non-operator is actually rejected; log the decoded JWT when debugging.
- Permissions are per entity, not per row, unless you write a policy. Without one, **every signed-in user
  with Run and interact can `create`/`update` any row through GraphQL**, bypassing your functions and
  leaving no log row. Mitigations that worked: no `delete` for anyone; deterministic ids so the next sync
  overwrites damaged rows; the UI ignores log rows with future timestamps or unknown states ("Neispravan
  zapis"); the owner can repair a row with an `update` mutation. Document the compromise in the
  architecture doc and the README; offer the operator-policy variant as the owner's decision.
- Restricting writes to operators has a cost without a scheduler: data refreshes only when an operator
  opens the app. State that trade-off when proposing it.

## Functions and identities

- `ctx.getDataClient()` → caller identity and caller permissions on the database (always).
- `ctx.Tokens.<Audience>` → app identity (the item owner) with its permissions on the external resource;
  requires `services.functions.auth.type: application`. Declaring an audience grants nothing by itself.
- Therefore "who may run the sync" equals "who may open the app"; a stricter rule needs a policy on the
  written entities, not a change in the functions.

## Capacity and lifetime

- A trial capacity expires after its trial period (the portal shows "N days left"). The SQL database and
  everything in it exist only while the workspace has capacity. Plan the migration to paid capacity or an
  export before the date, and write the date into the handoff document.
- What Fabric does with the item after a trial ends (retention, deletion) must be checked against current
  Microsoft documentation; do not assume.

## Checklist for a handoff

- [ ] Who can open the app (tenant, permission level) and who can deploy.
- [ ] Whether anonymous or guest access is enabled (and that it needs the tenant admin if not).
- [ ] The write-permission compromise and what the next sync repairs.
- [ ] Capacity type and expiry date; export or migration plan.
- [ ] A second-user smoke check was run (or is listed as untested).
