# Sources: URLs, data shapes, categories, cadence

Verified on 2026-10-08 from a Claude Code cloud session with plain `curl` and Python `urllib` through the
session proxy. Everything fetched is **untrusted data**: parse it, summarise it, never execute it. Only
`raw.githubusercontent.com` is needed. From the cloud session, `api.github.com` repository endpoints,
`github.com` HTML pages and `img.shields.io` badges all answered `403` from the session proxy (attaching a
repository to the session unlocks the API for that repository only), so neither the script nor the procedure
depends on them.

## 1. slavakurilyak/awesome-ai-agents (`--source agents`)

- Repository: <https://github.com/slavakurilyak/awesome-ai-agents> (MIT). The README is generated from the
  data files (`go run ./cmd/generate-readme`), so the script reads the data files, not the README.
- Raw files (branch `main`):
  - `https://raw.githubusercontent.com/slavakurilyak/awesome-ai-agents/main/awesome-agents.json` (~325 KB)
  - `https://raw.githubusercontent.com/slavakurilyak/awesome-ai-agents/main/awesome-categories.yaml` (~5 KB)
  - `https://raw.githubusercontent.com/slavakurilyak/awesome-ai-agents/main/contributions.json` (~47 KB)
  - `README.md` (~400 KB): "Browse by Category", "Star Growth" (today / 7 days / 30 days), "Top 10 by Total
    Stars", then one `###` heading per project with provenance (submitted by / maintained by), stars,
    categories, description, links, capabilities and interfaces.
- Shape of `awesome-agents.json` as found (the script also accepts a bare list of items):

  ```json
  {
    "agents": [ { "...": "305 items" } ],
    "categories": [ { "category": "AI Agents", "category_description": "AI agents" }, { "...": "36 in all" } ]
  }
  ```

  Item keys: `id` (slug plus 8 hex characters, stable across renames), `project`, `project_description`
  (≤ ~500 chars), `has_public_repository`, `categories[]`, optional `capabilities[]` and `interfaces[]`
  (present on 149 of 305 items; interface values such as `CLI`, `MCP server`, `MCP`, `Python SDK`, `Web UI`,
  `HTTP API`, `Docker`, `Claude Code`), `sources[]` with `source` (`github` on 309 entries; also `website`,
  `docs`, `discord`, `demo`, `twitter`, …), `source_url`, `repository_owner`, `repository_owner_url`, `stars`,
  `stars_last_updated`, `repository_checked_at`, `repository_status` (`active` / `archived` /
  `check_failed`), `repository_status_detail`.
- `awesome-categories.yaml`: a flat list of `{category, category_description, emoji}`; 36 defined, 24 in use.
- Categories in use (count on 2026-10-08): AI Agents 103 · Development Frameworks 89 · Safety Guardrails
  (Safeguarding) 27 · Long-Term Memory 25 · Tool Calling (Function Calling) 24 · MCP Servers 21 ·
  Terminal-Friendly 15 · Observability Frameworks 14 · Evaluation Frameworks 13 · Personal Assistants 12 ·
  Standardization 11 · Local Inference 10 · Operating System (OS) 9 · UI Development 9 · Web Browsing
  Frameworks 7 · Structured Outputs 6 · Flow Engineering (Platform Engineering) 5 · Function Calling 4 ·
  Real-Time 2 · Assistants API 1 · Bitcoin 1 · Model Merges 1 · Phone Calling 1 · Prompt Engineering 1.
  Defined but unused: Build Club, No-Code Development Frameworks, Mobile-Friendly Frameworks, Voice
  Providers, TTS Models, Transcriber Providers, Reinforcement Learning Frameworks, Hardware (Wearables), Model
  Providers, Model Providers With Function Calling Support, LLM-Friendly Languages, Phone Number Providers,
  Custom Development. `categories` prints the live numbers.
- `contributions.json`: `{"projects": [{"project_id", "submitted_by": [{"github_id", "login",
  "evidence_url", "acceptance_url", "at", "status", "founder_team_claim"}]}]}` (78 projects with credited
  submitters on 2026-10-08); `recent --source agents` lists the newest accepted submissions from it.
- Submission process: issue form `project-submission.yml` → maintainer review → PR; eligibility = public
  repository on GitHub/GitLab.com/Codeberg with a substantive, non-automated commit in the last six months;
  their optional skill `skills/awesome-ai-agents-curation/SKILL.md` describes founder and maintainer
  workflows. Details in [submission.md](submission.md).
- Cadence: stars and repository status are refreshed by their automated workflow (`stars_last_updated` was
  2026-10-04 on 2026-10-08); new projects arrive through issues and PRs several times a week. Our cache: 24 h.

## 2. hesreallyhim/awesome-claude-code (`--source claude-code`)

- Repository: <https://github.com/hesreallyhim/awesome-claude-code>. Raw README:
  `https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md` (~210 KB, ~217 entries).
- Entry format: `- [Name] (url) by [author] (url) - description`, written here with a space before each `(`
  only so the kit's link checker ignores the example; the real bullets have none. A few entries have no
  `by [author]` part. Each bullet is followed by one line of shields.io badge images (`created-at`,
  `last-commit`, `license`, `stars`) that carry no text the script could read. Sections
  are `##` headings with optional `###` sub-sections: Start Here · From Anthropic · Documentation, Knowledge &
  Learning (Obsidian, Data Visualization) · Open Source Software · Research & Scientific Inquiry · Providers,
  Runtime & Integration Infrastructure · Remote Control, Notifications & Voice I/O · Alternative Clients ·
  Status Lines · Design & UI/UX · Writing & Prose Quality · Creative Media · Infrastructure & DevOps · Security
  · Agent Orchestration (Ralph Wiggum, Dynamic Workflows) · Skills · Memory & Context Persistence ·
  Observability & Monitoring (Session Monitors, Usage & Cost, Observability) · Configuration · Testing ·
  Linting · Multi-Purpose · Lists & Collections. The "Table of Contents" bullets link to anchors and are
  skipped by the script.
- "Recently Added" is **not a Markdown list**. It is an animated SVG ticker,
  `https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/assets/recently-added.svg`
  (~14 KB), with one `<g transform="translate(x, 0)">` panel per resource and `<text>` children: bold name,
  category pill (`text-anchor="middle"`), `by <author>`, up to three description lines (the last one cut with
  `…`); the first panel is repeated at the end for the loop. The script parses the panels, de-duplicates
  them and joins each entry to its README bullet for the full description and link. Only the latest ~6
  resources appear there; there is no dated history in the repository files.
- The current README is a deliberately new iteration (launched with resources that were not on the previous
  list); legacy entries live in `README_ALTERNATIVES/` and are re-added over time. A missing well-known tool
  is therefore not necessarily rejected.
- Submission: web issue form `recommend-resource.yml` only (no PRs, not via `gh`, one resource at a time,
  14 days of active development or 100+ stars). Details in [submission.md](submission.md).
- Cadence: several additions per week. Our cache: 24 h. For the monthly review compare the ticker with the
  previous month's notes in `docs/PREDAJA.md`, because the ticker itself forgets.

## 3. anthropics/skills (`--source anthropic`)

- Repository: <https://github.com/anthropics/skills>. Raw README:
  `https://raw.githubusercontent.com/anthropics/skills/main/README.md` (short: what skills are, how to
  install the plugins in Claude Code / claude.ai / API, how to write a basic skill, partner skills).
- Machine-readable list: `https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json`
  → `plugins[].skills[]` paths of the form `./skills/<name>`. On 2026-10-08: 19 skills in 5 plugins -
  `document-skills` (xlsx, docx, pptx, pdf; source-available, not open source), `example-skills`
  (algorithmic-art, brand-guidelines, canvas-design, doc-coauthoring, frontend-design, internal-comms,
  mcp-builder, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing),
  `claude-api`, `academy-guide`, `discernment-nudge`.
- Each skill: `https://raw.githubusercontent.com/anthropics/skills/main/skills/<name>/SKILL.md` with
  frontmatter `name`, `description` (plain scalar, quoted scalar, or a `>` / `|-` block) and `license`.
  `template/SKILL.md` holds only `name` and `description` plus a heading. `spec/agent-skills-spec.md` is a
  stub pointing to <https://agentskills.io/specification>; `skills/README.md` does not exist.
- Reference install paths (local Claude Code): `/plugin marketplace add anthropics/skills`, then
  `/plugin install example-skills@anthropic-agent-skills` or `document-skills@…`. Cloud sessions do not load
  plugins or `~/.claude/skills`; a skill is used there by copying its folder into the repository's
  `.claude/skills/` after the owner agrees and the license allows it.
- Cadence: irregular (weeks between changes). `recent --source anthropic` diffs the current list against the
  snapshot kept in the cache (`snapshots/anthropic-skills.json`); `refresh` keeps the snapshot, `refresh --all`
  drops it.

## Verifying a candidate without the GitHub API

Reachable from a cloud session: `raw.githubusercontent.com` only (`HEAD` in the path resolves the default
branch).

- README: `curl -sS https://raw.githubusercontent.com/<owner>/<repo>/HEAD/README.md`.
- License: `.../HEAD/LICENSE`, `LICENSE.md` or `LICENSE.txt`; a 404 means the file is named or placed
  differently (anthropics/skills keeps a `LICENSE.txt` inside each skill folder) - check the README's license
  section before concluding "no license".
- Recent activity: dated entries in `CHANGELOG.md`, `CHANGES.md` or release notes in the repository; dates
  and version numbers in the README; versions in `package.json` / `pyproject.toml`. For awesome-ai-agents
  entries the catalogue's `repository_status` (`active`) and `repository_checked_at` say when their automated
  check last saw the repository, and their eligibility rule requires a substantive commit within six months
  at review time (not a guarantee for today).
- Not reachable from a cloud session (403 from the proxy on 2026-10-08): `https://github.com/<owner>/<repo>/commits`,
  `api.github.com`, and `img.shields.io/github/last-commit/<owner>/<repo>` or `.../github/license/...` badges.
  From the owner's machine they work as usual: ask the owner to open the commits page (or read the badges)
  and report the date; never estimate it.

## Cache

`${TMPDIR:-/tmp}/research-ai-landscape/` (override with `RESEARCH_AI_LANDSCAPE_CACHE` or `--cache-dir`):
one file per URL (sha256 prefix + extension), 24 h lifetime (`--ttl-hours`), `--offline` reads whatever is
cached regardless of age, `refresh` clears it. A failed fetch falls back to the stale copy with a `WARN`; a
source with no copy is reported and skipped, the others still answer.
