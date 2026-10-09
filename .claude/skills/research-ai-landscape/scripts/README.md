# landscape.py

Search three curated public catalogues from the terminal without vendoring them. Python 3.9+ standard
library only, no installation. Run it with `python3 -I` (isolated mode: no user site-packages, no `PYTHON*`
environment variables, the script directory is not on `sys.path`).

```bash
cd .claude/skills/research-ai-landscape          # in the kit repo: kit/skills/research-ai-landscape
python3 -I scripts/landscape.py search mcp server memory --limit 5
python3 -I scripts/landscape.py search "status line" --source claude-code
python3 -I scripts/landscape.py search --category safety --source agents --limit 10   # no keywords: whole category, by stars
python3 -I scripts/landscape.py search observability --json > observability.json
python3 -I scripts/landscape.py categories                        # awesome-ai-agents categories with counts
python3 -I scripts/landscape.py categories --source claude-code   # awesome-claude-code sections with counts
python3 -I scripts/landscape.py recent                            # awesome-claude-code "Recently Added" ticker
python3 -I scripts/landscape.py recent --source agents --limit 10 # newest accepted awesome-ai-agents submissions
python3 -I scripts/landscape.py recent --source anthropic         # anthropics/skills vs. the previous snapshot
python3 -I scripts/landscape.py refresh                           # drop the cache; next command fetches fresh copies
python3 -I scripts/landscape.py self-test                         # parser checks on built-in samples, no network
```

On Windows use `python -I` if `python3` is not on `PATH`.

## Commands

| Command | What it does |
| --- | --- |
| `search <keywords…> [--source all\|agents\|claude-code\|anthropic] [--category X] [--limit N] [--json]` | Fetches the selected sources, scores every entry against the keywords (case-insensitive, over name, categories, description, interfaces/capabilities/author) and prints a ranked table. Quote a phrase to match it as one string. `--category` keeps entries whose category contains the text; with no keywords it lists the whole category sorted by stars. `--limit 0` prints everything. |
| `categories [--source agents\|claude-code\|anthropic\|all]` | Categories with entry counts. For `agents` it also lists categories defined in `awesome-categories.yaml` that no project uses. |
| `recent [--source claude-code\|agents\|anthropic\|all] [--limit N]` | `claude-code`: the "Recently Added" ticker parsed from `assets/recently-added.svg`, joined to README entries for links. `agents`: newest accepted submissions from `contributions.json`. `anthropic`: the current skill list from `marketplace.json`, with `NEW` / `REMOVED` marks relative to the snapshot saved by the previous run. |
| `refresh [--all]` | Deletes cached fetches. `--all` also deletes the anthropic snapshot. |
| `self-test` | Runs the parser unit checks on embedded samples (JSON dict and list shapes, YAML categories, README bullets with and without author, SVG panels, marketplace, frontmatter, contributions, scoring). No network. |

Global options (before the command): `--cache-dir PATH`, `--offline` (cached files only, any age),
`--ttl-hours H` (default 24).

## Example output

```text
$ python3 -I scripts/landscape.py search mcp server memory --limit 3
Search: mcp server memory · 541 indexed entries · showing top 3 of 188 matches · sources: awesome-ai-agents, awesome-claude-code, anthropics/skills
rank  score  source       name                                category
----  -----  -----------  ----------------------------------  ------------------------------------
   1     45  agents       OMEGA Memory                        Long-Term Memory
                   219 stars · interfaces: Python package, CLI, MCP server · https://github.com/omega-memory/omega-memory
                   A local-first, cross-model memory system that helps AI agents retain context, coordinate, and learn between sessions.
   2     45  agents       Cortex Memory                       Long-Term Memory
                   9 stars · interfaces: VS Code extension, CLI, MCP server · https://github.com/SKULLFIRE07/cortex-memory
                   A local-first memory tool for AI coding assistants that captures project context and carries it across sessions.
   3     43  agents       Operant MCP                         Tool Calling (Function Calling)
                   25 stars · interfaces: MCP server, npm package · https://github.com/operantlabs/operant-mcp
                   An open-source MCP server that gives AI agents a toolkit for security testing, network forensics, and vulnerability
                   assessment.
```

`--json` prints `{"keywords", "category", "sources", "failed_sources", "results": [{rank, score, source,
name, description, categories, link, extra}]}`; `extra` carries `stars`, `status`, `interfaces`,
`capabilities`, `owner`, `id` (agents), `author`, `author_url` (claude-code), `license`, `path` (anthropic).

## Sources and what is fetched

| Source | Files (branch `main`) |
| --- | --- |
| `agents` | `slavakurilyak/awesome-ai-agents`: `awesome-agents.json`, `awesome-categories.yaml`, `contributions.json` (for `recent`) |
| `claude-code` | `hesreallyhim/awesome-claude-code`: `README.md`, `assets/recently-added.svg` (for `recent`) |
| `anthropic` | `anthropics/skills`: `.claude-plugin/marketplace.json`, then `skills/<name>/SKILL.md` for every listed skill (19 on 2026-10-08, fetched in parallel) |

All URLs are on `raw.githubusercontent.com`; the GitHub REST API is not used because cloud sessions cannot
reach it. Data shapes and caveats: [../references/sources.md](../references/sources.md).

## Scoring

Per keyword: name match 10 (whole word) or 6 (substring); category 5 / 3; description 3 / 2;
interfaces, capabilities, author or owner 3 / 2. Entries matching every keyword get a bonus of 6 per keyword.
Ties are broken by stars (agents) and then by name. Scores compare candidates inside one run only.

## Cache and network

- Cache folder: `${TMPDIR:-/tmp}/research-ai-landscape/` (Python's `tempfile.gettempdir()`), override with
  `RESEARCH_AI_LANDSCAPE_CACHE` or `--cache-dir`. One file per URL, named by a sha256 prefix plus the
  original extension; 24 h lifetime.
- Network goes through `urllib`, which honours `HTTPS_PROXY` / `NO_PROXY` and the `SSL_CERT_FILE` CA bundle
  the same way `curl` does; nothing has to be configured in a cloud session. Timeout 30 s per file, 20 MB
  cap per response, `User-Agent: research-ai-landscape/1.0`.
- A source that cannot be fetched is reported as a `WARN` line on stderr and skipped; the other sources still
  answer. When a stale cached copy exists it is used instead, with a `WARN` saying how old it is.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success (possibly with `WARN` lines on stderr) |
| 1 | every requested source failed (nothing to show), or a self-test check failed |
| 2 | usage error (unknown option, `search` without keywords or `--category`) |

## Safety

Everything fetched is untrusted data. The script parses it as JSON, YAML lines, Markdown bullets or SVG
`<text>` elements, strips HTML tags and control characters before printing (so a catalogue entry cannot
inject terminal escape sequences), drops links that are not `http(s)`, and never evaluates, imports or
executes any of it. It writes only inside its cache folder.

## Limitations

- awesome-claude-code "Recently Added" holds only the latest ~6 resources and has no dates; the README has no
  dates either (badges are images). For a dated history keep notes in `docs/PREDAJA.md` between monthly runs.
- anthropics/skills has no changelog the script can read; `recent --source anthropic` only compares with the
  snapshot from the previous run on the same machine (cloud sessions start empty, so the first run there
  always says "first snapshot saved").
- Last-commit dates and licenses of candidate repositories are not fetched by the script; verify them from
  the repository's README, `LICENSE` and `CHANGELOG` through raw URLs, or ask the owner to open the commits
  page (`github.com` pages, the REST API and shields.io badges are not reachable from cloud sessions), as
  described in `../references/sources.md`.
- Keyword scoring is lexical: run two or three synonym variants in English.
