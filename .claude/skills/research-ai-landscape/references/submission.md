# Submitting the owner's project to the lists

Both lists are curated by a single maintainer, reviewed in a best-effort way, and **never promise a listing,
placement or traffic**. The session prepares the text and checks eligibility; the owner submits
(awesome-claude-code requires a human to fill in the web form). Nothing from the project's private side goes
into a submission: no tenant ids, workspace names, hosting URLs, secrets, or screenshots with internal data -
the public repository is the only thing the lists look at. Re-read each list's `CONTRIBUTING.md` before
submitting; the rules below were current on 2026-10-08.

## awesome-ai-agents (slavakurilyak)

Source of truth: <https://github.com/slavakurilyak/awesome-ai-agents/blob/main/CONTRIBUTING.md>.

**Eligibility**

- A public repository on GitHub, GitLab.com or Codeberg. A website, organisation profile, client library or
  integration alone does not qualify; hosted products without their own repository are not listed.
- At least one substantive, non-automated commit on the default branch within the six months before review.
  Profile updates, stars and bot-only dependency or metadata changes do not count.
- No license requirement and no minimum star count; a zero-star launch gets the same fit-and-evidence review.
- Fit: observable agent behaviour and a working way to interact with it. A Fabric App qualifies only when it
  is framed as an agent-related project (for example a Claude Code skills kit, an MCP server, a tool-calling
  agent); a plain data application is out of scope.

**Issue form** (the preferred path):
`https://github.com/slavakurilyak/awesome-ai-agents/issues/new?template=project-submission.yml`, title
prefix `Project submission: `, label `project submission`.

| Field | Required | What to prepare |
| --- | --- | --- |
| Project name | yes | the repository or product name, exactly as it should be listed |
| What does it do? | yes | 2–4 sentences of observable behaviour and who it helps; no marketing claims |
| Public source repository | yes | direct `https://github.com/<owner>/<repo>` URL |
| Recent substantive commit | yes | direct commit link on the default branch, ≤ 6 months old, not a bot or dependency change |
| Evidence and how to try it | yes | README sections, docs, demo, screenshots in the repo, install and run commands |
| Suggested category | no | an existing category, e.g. `AI Agents`, `MCP Servers`, `Development Frameworks`, `Tool Calling (Function Calling)` |
| Founder submission / Current project maintainer | no | tick honestly; claims without public evidence are labelled "self-reported" |
| Public evidence for current maintainers | no | `MAINTAINERS.md`, an authors section, a maintainer statement |

**Direct pull request** (optional, usually after the issue): edit `awesome-agents.json` only (never the
YAML), adding one object with `id` (`<slug>-<8 hex>`), `project`, `project_description`,
`has_public_repository: true`, `categories` (existing names from `awesome-categories.yaml`) and
`sources: [{"source": "github", "source_url": "…", "repository_status": "active", "repository_checked_at":
"<set by forge verifier>", "stars_last_updated": null}]`. Their Go commands (`go run ./cmd/contributions
assign-ids`, `verify-forge-repositories --project`, `validate-data --project`, `contributions
record-direct-pr`, `contributions validate`, `generate-readme`) need a Go toolchain and GitHub API access -
run them on the owner's machine, not in a cloud session. Every listing needs a `submitted_by` record in
`contributions.json`; the maintainer records it from the PR author.

Their optional skill `skills/awesome-ai-agents-curation/SKILL.md` describes the founder workflow (gather
facts, check duplicates against the catalogue and `awesome-categories.yaml`, produce a ready-to-paste issue)
and the maintainer triage. Reading it is useful; copying it into our repository is not needed.

**Draft to fill in**

```text
Project name: <name>
What does it do? <2–4 sentences: what the agent or tool observably does, for whom, through which interfaces (CLI, MCP, skill)>
Public source repository: https://github.com/<owner>/<repo>
Recent substantive commit: https://github.com/<owner>/<repo>/commit/<sha>
Evidence and how to try it: <README#section, docs, demo; install and run commands>
Suggested category: <existing category>
Founder submission: <yes/no>   Current maintainer: <yes/no>   Public evidence: <link or "none">
```

## awesome-claude-code (hesreallyhim)

Source of truth: <https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md>.

**Eligibility and rules**

- (i) at least 14 days since the first commit on the default branch **and** signs of active development
  (commits after the first day), **or** (ii) at least 100 stars. Resources that fail this are closed
  automatically by the form bot.
- One resource per recommendation. Recommendations are made by a human through the web issue form only -
  **no pull requests, not via the `gh` CLI** - or the account may be temporarily restricted from the
  repository.
- The resource should be specific to Claude Code (a guideline, not a hard rule). Closed source, sign-up or
  payment requirements are barriers to review.
- Description style: a description, not a sales pitch; do not address the reader; one line; no emojis;
  10–500 characters. The bot reports the license it detects, so a properly named `LICENSE` file must sit in
  the repository root.
- The list is selective. The maintainer's advice: build, get users, then submit (or let the project be
  noticed); "getting on the list" must not be the promotion plan.

**Issue form**: `https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml`,
title `[Resource]: <name>`; labels `resource-submission`, `validation-pending` are set by the form.

| Field | What to prepare |
| --- | --- |
| Display Name | the name as it should appear in the list |
| Category | one of: Start Here · Documentation, Knowledge & Learning (or `> Obsidian`, `> Data Visualization`) · Open Source Software · Research & Scientific Inquiry · Providers, Runtime & Integration Infrastructure · Remote Control, Notifications & Voice I/O · Alternative Clients · Status Lines · Design & UI/UX · Writing & Prose Quality · Creative Media · Infrastructure & DevOps · Security · Agent Orchestration (or `> Ralph Wiggum`, `> Dynamic Workflows`) · Skills · Memory & Context Persistence · Observability & Monitoring (or `> Session Monitors`, `> Usage & Cost`, `> Observability`) · Configuration · Testing · Linting · Multi-Purpose · Lists & Collections |
| Link | `https://github.com/<owner>/<repo>` (GitHub preferred, must start with `https://`) |
| Author Name / Author Link | name, alias or GitHub username; profile or website URL |
| Description | 1–3 descriptive sentences, 10–500 characters |
| Checklist | the owner confirms: visited the repo, distinct from every existing entry, links work and are public, specific to Claude Code, read `CONTRIBUTING.md`; the last "do not check" box stays unchecked |

**Draft to fill in**

```text
Display Name: <name>
Category: <category from the list above>
Link: https://github.com/<owner>/<repo>
Author Name: <owner name or handle>        Author Link: https://github.com/<owner>
Description: <what it does, 1–3 sentences, no "you", no emojis>
```

If accepted, the project README may carry the badge:
`[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)`.

A kit such as `fabric-kit` (skills plus `AGENTS.md` rules for Claude Code) fits the `Skills` category once
its public repository is at least 14 days old with ongoing commits.

## Before submitting (both lists)

- Search both catalogues for duplicates: `python3 -I scripts/landscape.py search <our name> <our keywords>`.
- The public repository has a README (what it does, why, how to try it), a `LICENSE` in the root, a recent
  substantive commit, and no secrets or tenant data anywhere in its history.
- The kit's honesty rule applies: describe what the project verifiably does today, not the roadmap.
- Record the submission (date, issue URL, outcome) in the project's `docs/PREDAJA.md`; do not resubmit the
  same resource while an issue is open, and do not read a closed issue as a verdict on the project.
