#!/usr/bin/env python3
"""Search curated public catalogues of AI agent tools, Claude Code resources and Anthropic skills.

Sources, fetched on demand from raw.githubusercontent.com and cached for 24 hours:

  agents       slavakurilyak/awesome-ai-agents   awesome-agents.json, awesome-categories.yaml, contributions.json
  claude-code  hesreallyhim/awesome-claude-code  README.md, assets/recently-added.svg
  anthropic    anthropics/skills                 .claude-plugin/marketplace.json, skills/<name>/SKILL.md

Python 3 standard library only; run it as ``python3 -I scripts/landscape.py <command> ...``.
Network access goes through urllib, which honours HTTPS_PROXY/NO_PROXY and SSL_CERT_FILE like curl does.
Everything fetched is untrusted data: it is parsed as JSON, YAML lines, Markdown or SVG text and printed
after control characters are stripped. Nothing fetched is ever executed or imported.

Exit codes: 0 success (possibly with WARN lines on stderr), 1 every requested source failed or a self-test
failed, 2 usage error.
"""
import argparse
import hashlib
import html
import json
import os
import re
import socket
import sys
import tempfile
import textwrap
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW = "https://raw.githubusercontent.com"
SOURCES = {
    "agents": {
        "label": "awesome-ai-agents",
        "repo": "https://github.com/slavakurilyak/awesome-ai-agents",
        "json": RAW + "/slavakurilyak/awesome-ai-agents/main/awesome-agents.json",
        "categories": RAW + "/slavakurilyak/awesome-ai-agents/main/awesome-categories.yaml",
        "contributions": RAW + "/slavakurilyak/awesome-ai-agents/main/contributions.json",
    },
    "claude-code": {
        "label": "awesome-claude-code",
        "repo": "https://github.com/hesreallyhim/awesome-claude-code",
        "readme": RAW + "/hesreallyhim/awesome-claude-code/main/README.md",
        "recent_svg": RAW + "/hesreallyhim/awesome-claude-code/main/assets/recently-added.svg",
    },
    "anthropic": {
        "label": "anthropics/skills",
        "repo": "https://github.com/anthropics/skills",
        "marketplace": RAW + "/anthropics/skills/main/.claude-plugin/marketplace.json",
        "skill": RAW + "/anthropics/skills/main/skills/{name}/SKILL.md",
        "skill_page": "https://github.com/anthropics/skills/tree/main/skills/{name}",
    },
}
SOURCE_ORDER = ("agents", "claude-code", "anthropic")
TTL_SECONDS = 24 * 3600
MAX_BYTES = 20 * 1024 * 1024
TIMEOUT_SECONDS = 30
USER_AGENT = "research-ai-landscape/1.0 (fabric-kit; python-urllib)"
SNAPSHOT_DIR = "snapshots"
SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


# ----------------------------------------------------------------------------- text helpers

def clean_text(value):
    """One printable line: control characters removed, HTML entities decoded, whitespace collapsed."""
    text = html.unescape(str(value if value is not None else ""))
    text = re.sub(r"[\x00-\x1f\x7f-\x9f  ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def strip_markdown(value):
    """Markdown links -> their text, HTML tags removed, then clean_text."""
    text = re.sub(r"<[^>]*>", " ", str(value or ""))
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "")
    return clean_text(text)


def safe_url(value):
    text = clean_text(value)
    return text if re.match(r"^https?://[^\s<>\"']+$", text) else ""


def shorten(text, width):
    text = clean_text(text)
    return text if len(text) <= width else text[: max(0, width - 1)].rstrip() + "…"


def make_item(source, name, description, categories, link, **extra):
    return {
        "source": source,
        "name": strip_markdown(name),
        "description": strip_markdown(description),
        "categories": [clean_text(c) for c in categories if clean_text(c)],
        "link": safe_url(link),
        "extra": {k: v for k, v in extra.items() if v not in (None, "", [], {})},
    }


# ----------------------------------------------------------------------------- cache + fetch

def default_cache_dir():
    override = os.environ.get("RESEARCH_AI_LANDSCAPE_CACHE")
    if override:
        return Path(override)
    return Path(tempfile.gettempdir()) / "research-ai-landscape"


def describe_error(err):
    if isinstance(err, urllib.error.HTTPError):
        return "HTTP %s" % err.code
    if isinstance(err, urllib.error.URLError):
        return "network error: %s" % clean_text(err.reason)
    if isinstance(err, (socket.timeout, TimeoutError)):
        return "timeout after %ss" % TIMEOUT_SECONDS
    return "%s: %s" % (type(err).__name__, clean_text(err))


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("response larger than %d MB" % (MAX_BYTES // (1024 * 1024)))
    return data.decode("utf-8", errors="replace")


class Fetcher:
    """Fetch-with-cache. Every problem becomes a warning; callers get None and carry on."""

    def __init__(self, cache_dir, ttl=TTL_SECONDS, offline=False):
        self.cache_dir = Path(cache_dir)
        self.ttl = ttl
        self.offline = offline
        self.warnings = []
        self._lock = threading.Lock()

    def warn(self, message):
        with self._lock:
            self.warnings.append(message)

    def path_for(self, url):
        suffix = os.path.splitext(url.split("?")[0])[1] or ".txt"
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
        return self.cache_dir / (digest + suffix)

    def get(self, url, what):
        path = self.path_for(url)
        age = None
        if path.exists():
            age = time.time() - path.stat().st_mtime
        if age is not None and (age < self.ttl or self.offline):
            return path.read_text(encoding="utf-8", errors="replace")
        if self.offline:
            self.warn("%s: not in cache and --offline was given (%s)" % (what, url))
            return None
        try:
            text = download(url)
        except Exception as err:  # noqa: BLE001 - every failure is reported, none is fatal
            if age is not None:
                self.warn("%s: %s - using stale cache from %.1f h ago" % (what, describe_error(err), age / 3600))
                return path.read_text(encoding="utf-8", errors="replace")
            self.warn("%s: %s (%s)" % (what, describe_error(err), url))
            return None
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".part-%d" % os.getpid())
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, path)
        except OSError as err:
            self.warn("cache write failed (%s): %s" % (path, describe_error(err)))
        return text

    def clear(self, include_snapshots=False):
        removed = 0
        if not self.cache_dir.exists():
            return removed
        for entry in self.cache_dir.iterdir():
            if entry.is_file():
                entry.unlink()
                removed += 1
            elif entry.name == SNAPSHOT_DIR and include_snapshots:
                for snap in entry.iterdir():
                    if snap.is_file():
                        snap.unlink()
                        removed += 1
        return removed


# ----------------------------------------------------------------------------- parsers (pure functions)

def _as_str_list(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(v) for v in value if isinstance(v, (str, int, float))]
    return []


def parse_agents_json(text):
    """awesome-agents.json: {"agents": [...], "categories": [...]} today; a bare list is accepted too."""
    data = json.loads(text)
    if isinstance(data, dict):
        agents = data.get("agents") or data.get("projects") or []
        categories_meta = data.get("categories") or []
    elif isinstance(data, list):
        agents, categories_meta = data, []
    else:
        raise ValueError("unexpected JSON shape: %s" % type(data).__name__)
    items = []
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        name = clean_text(agent.get("project"))
        if not name:
            continue
        sources = [s for s in (agent.get("sources") or []) if isinstance(s, dict)]
        repo = None
        for source in sources:
            url = str(source.get("source_url") or "")
            kind = str(source.get("source") or "").lower()
            if kind in ("github", "gitlab", "codeberg") or re.match(r"https?://(github\.com|gitlab\.com|codeberg\.org)/", url):
                repo = source
                break
        if repo is None and sources:
            repo = sources[0]
        repo = repo or {}
        items.append(make_item(
            "agents",
            name,
            agent.get("project_description"),
            _as_str_list(agent.get("categories")),
            repo.get("source_url"),
            id=clean_text(agent.get("id")),
            stars=repo.get("stars") if isinstance(repo.get("stars"), int) else None,
            status=clean_text(repo.get("repository_status")),
            owner=clean_text(repo.get("repository_owner")),
            interfaces=[clean_text(v) for v in _as_str_list(agent.get("interfaces"))],
            capabilities=[clean_text(v) for v in _as_str_list(agent.get("capabilities"))],
            public_repository=bool(agent.get("has_public_repository")),
        ))
    return items, categories_meta


CATEGORY_LINE_RE = re.compile(r'^\s*-\s*category:\s*"?(.*?)"?\s*$')
CATEGORY_DESC_RE = re.compile(r'^\s*category_description:\s*"?(.*?)"?\s*$')


def parse_categories_yaml(text):
    """awesome-categories.yaml is a flat list of {category, category_description, emoji}; no YAML lib needed."""
    result = []
    for line in text.splitlines():
        match = CATEGORY_LINE_RE.match(line)
        if match:
            result.append([clean_text(match.group(1)), ""])
            continue
        match = CATEGORY_DESC_RE.match(line)
        if match and result:
            result[-1][1] = strip_markdown(match.group(1))
    return [tuple(r) for r in result if r[0]]


def parse_contributions_json(text):
    """contributions.json: {"projects": [{"project_id", "submitted_by": [{"login", "at", "status", ...}]}]}."""
    data = json.loads(text)
    projects = data.get("projects") if isinstance(data, dict) else data
    rows = []
    for project in projects or []:
        if not isinstance(project, dict):
            continue
        for record in project.get("submitted_by") or []:
            if not isinstance(record, dict):
                continue
            rows.append({
                "project_id": clean_text(project.get("project_id")),
                "at": clean_text(record.get("at")),
                "login": clean_text(record.get("login")),
                "status": clean_text(record.get("status")),
                "evidence_url": safe_url(record.get("evidence_url")),
                "acceptance_url": safe_url(record.get("acceptance_url")),
            })
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows


ENTRY_RE = re.compile(
    r"^- \[(?P<name>[^\]]+)\]\((?P<url>[^)\s]+)\)"
    r"(?:\s+by\s+\[(?P<author>[^\]]*)\]\((?P<author_url>[^)\s]*)\))?"
    r"\s*[-–—]\s*(?P<desc>.*)$"
)


def parse_claude_code_readme(text):
    """Bullets `- [Name](url) by [author](url) - description` under ## / ### headings; TOC bullets skipped."""
    items = []
    section = None
    subsection = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("# "):
            section, subsection = None, None
            continue
        if line.startswith("## "):
            section, subsection = strip_markdown(line[3:]), None
            continue
        if line.startswith("### "):
            subsection = strip_markdown(line[4:])
            continue
        match = ENTRY_RE.match(line)
        if not match or match.group("url").startswith("#") or section is None:
            continue
        category = section if not subsection else "%s > %s" % (section, subsection)
        items.append(make_item(
            "claude-code",
            strip_markdown(match.group("name")),
            strip_markdown(match.group("desc")),
            [category],
            match.group("url"),
            author=strip_markdown(match.group("author") or ""),
            author_url=safe_url(match.group("author_url") or ""),
        ))
    return items


PANEL_SPLIT_RE = re.compile(r'<g\s+transform="translate\(\s*-?[\d.]+\s*,\s*0\s*\)"\s*>')
TEXT_RE = re.compile(r"<text\b([^>]*)>(.*?)</text>", re.S)


def parse_recently_added_svg(text):
    """assets/recently-added.svg is an animated ticker: one <g translate(x, 0)> panel per resource with
    <text> children: bold name, pill category (text-anchor=middle), 'by author', description lines."""
    entries = []
    seen = set()
    for chunk in PANEL_SPLIT_RE.split(text)[1:]:
        texts = [(attrs, strip_markdown(content)) for attrs, content in TEXT_RE.findall(chunk)]
        texts = [(a, c) for a, c in texts if c]
        if not texts:
            continue
        name = next((c for a, c in texts if 'font-weight="700"' in a or "font-weight=\"bold\"" in a), texts[0][1])
        category = next((c for a, c in texts if 'text-anchor="middle"' in a), "")
        author = next((c[3:].strip() for a, c in texts if c.lower().startswith("by ")), "")
        used = {name, category}
        description = " ".join(c for a, c in texts if c not in used and not c.lower().startswith("by "))
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        entries.append({"name": name, "category": category, "author": author, "description": clean_text(description)})
    return entries


def parse_marketplace(text):
    """.claude-plugin/marketplace.json: plugins[].skills[] are paths like ./skills/<name>."""
    data = json.loads(text)
    plugins = data.get("plugins") if isinstance(data, dict) else None
    result = []
    seen = set()
    for plugin in plugins or []:
        if not isinstance(plugin, dict):
            continue
        plugin_name = clean_text(plugin.get("name")) or "plugin"
        plugin_desc = clean_text(plugin.get("description"))
        for path in plugin.get("skills") or []:
            name = str(path).strip().rstrip("/").split("/")[-1]
            if SKILL_NAME_RE.match(name) and name not in seen:
                seen.add(name)
                result.append((name, plugin_name, plugin_desc))
    return result


FRONTMATTER_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$")


def parse_frontmatter(text):
    """YAML frontmatter between the first two `---` lines; scalar values plus `>`/`|` blocks and
    indented continuation lines are joined into one string. Good enough for name/description/license."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    fields = {}
    key = None
    buffer = []

    def flush():
        if key is not None:
            value = " ".join(part for part in buffer if part).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            fields[key] = clean_text(value)

    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = FRONTMATTER_KEY_RE.match(line)
        if match and not line[:1].isspace():
            flush()
            key = match.group(1)
            value = match.group(2).strip()
            buffer = [] if value in (">", ">-", ">+", "|", "|-", "|+") else [value]
        elif key is not None:
            buffer.append(line.strip())
    flush()
    return fields


# ----------------------------------------------------------------------------- loaders

def load_agents(fetcher):
    text = fetcher.get(SOURCES["agents"]["json"], "awesome-ai-agents JSON")
    if text is None:
        return None, []
    try:
        items, _ = parse_agents_json(text)
    except ValueError as err:
        fetcher.warn("awesome-ai-agents JSON: cannot parse (%s)" % describe_error(err))
        return None, []
    defined = []
    yaml_text = fetcher.get(SOURCES["agents"]["categories"], "awesome-ai-agents categories YAML")
    if yaml_text is not None:
        defined = parse_categories_yaml(yaml_text)
    return items, defined


def load_claude_code(fetcher):
    text = fetcher.get(SOURCES["claude-code"]["readme"], "awesome-claude-code README")
    if text is None:
        return None
    items = parse_claude_code_readme(text)
    if not items:
        fetcher.warn("awesome-claude-code README: no entries recognised - the list format may have changed")
    return items


def load_anthropic(fetcher):
    text = fetcher.get(SOURCES["anthropic"]["marketplace"], "anthropics/skills marketplace.json")
    if text is None:
        return None
    try:
        skills = parse_marketplace(text)
    except ValueError as err:
        fetcher.warn("anthropics/skills marketplace.json: cannot parse (%s)" % describe_error(err))
        return None
    if not skills:
        fetcher.warn("anthropics/skills marketplace.json: no skills listed - the file format may have changed")
        return []

    def fetch_skill(entry):
        name = entry[0]
        return entry, fetcher.get(SOURCES["anthropic"]["skill"].format(name=name), "anthropics/skills %s/SKILL.md" % name)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch_skill, skills))
    items = []
    for (name, plugin, plugin_desc), body in results:
        fields = parse_frontmatter(body) if body else {}
        items.append(make_item(
            "anthropic",
            fields.get("name") or name,
            fields.get("description") or plugin_desc,
            [plugin],
            SOURCES["anthropic"]["skill_page"].format(name=name),
            license=fields.get("license", ""),
            path="skills/%s/SKILL.md" % name,
            frontmatter_read=bool(body),
        ))
    return items


def load_items(fetcher, sources):
    """Returns (items, failed_sources, agents_defined_categories)."""
    items = []
    failed = []
    defined = []
    for source in sources:
        if source == "agents":
            loaded, defined = load_agents(fetcher)
        elif source == "claude-code":
            loaded = load_claude_code(fetcher)
        else:
            loaded = load_anthropic(fetcher)
        if loaded is None:
            failed.append(source)
        else:
            items.extend(loaded)
    return items, failed, defined


# ----------------------------------------------------------------------------- search

def word_hit(keyword, text):
    return re.search(r"(?<![a-z0-9])" + re.escape(keyword) + r"(?![a-z0-9])", text) is not None


def score_item(item, keywords):
    name = item["name"].lower()
    description = item["description"].lower()
    categories = " | ".join(item["categories"]).lower()
    extra = item["extra"]
    aux = " ".join(_as_str_list(extra.get("interfaces")) + _as_str_list(extra.get("capabilities"))
                   + [str(extra.get("author", "")), str(extra.get("owner", ""))]).lower()
    total = 0
    matched = 0
    for keyword in keywords:
        k = keyword.lower().strip()
        if not k:
            continue
        hit = False
        if k in name:
            total += 10 if word_hit(k, name) else 6
            hit = True
        if k in categories:
            total += 5 if word_hit(k, categories) else 3
            hit = True
        if k in description:
            total += 3 if word_hit(k, description) else 2
            hit = True
        if k in aux:
            total += 3 if word_hit(k, aux) else 2
            hit = True
        if hit:
            matched += 1
    if matched == 0:
        return 0
    if matched == len(keywords) and len(keywords) > 1:
        total += 6 * len(keywords)
    return total


def category_matches(item, wanted):
    wanted = wanted.lower()
    return any(wanted in c.lower() for c in item["categories"])


def sort_key(row):
    stars = row["item"]["extra"].get("stars")
    return (-row["score"], -(stars or 0), row["item"]["name"].lower())


def search(items, keywords, category=None, limit=15):
    rows = []
    for item in items:
        if category and not category_matches(item, category):
            continue
        score = score_item(item, keywords) if keywords else 0
        if keywords and score == 0:
            continue
        rows.append({"score": score, "item": item})
    rows.sort(key=sort_key)
    return rows[:limit] if limit and limit > 0 else rows


# ----------------------------------------------------------------------------- output

def item_meta(item):
    extra = item["extra"]
    parts = []
    if extra.get("stars") is not None:
        parts.append("{:,} stars".format(extra["stars"]))
    if extra.get("status") and extra["status"] != "active":
        parts.append("repository %s" % extra["status"])
    if extra.get("interfaces"):
        parts.append("interfaces: " + ", ".join(extra["interfaces"][:4]))
    if extra.get("author"):
        parts.append("by " + extra["author"])
    if extra.get("license"):
        parts.append("license: " + shorten(extra["license"], 40))
    if extra.get("frontmatter_read") is False:
        parts.append("SKILL.md not fetched - description taken from marketplace.json")
    return " · ".join(parts)


def print_rows(rows, sources_label):
    if not rows:
        print("No matches in %s." % sources_label)
        return
    print("%4s  %5s  %-11s  %-34s  %s" % ("rank", "score", "source", "name", "category"))
    print("%4s  %5s  %-11s  %-34s  %s" % ("-" * 4, "-" * 5, "-" * 11, "-" * 34, "-" * 36))
    for rank, row in enumerate(rows, 1):
        item = row["item"]
        print("%4d  %5d  %-11s  %-34s  %s" % (
            rank, row["score"], item["source"], shorten(item["name"], 34), shorten(" | ".join(item["categories"]), 60)))
        meta = item_meta(item)
        line2 = " · ".join(p for p in (meta, item["link"] or "(no link)") if p)
        print(" " * 19 + shorten(line2, 140))
        for wrapped in textwrap.wrap(shorten(item["description"], 300), 118) or ["(no description)"]:
            print(" " * 19 + wrapped)
    print()


def rows_to_json(rows):
    out = []
    for rank, row in enumerate(rows, 1):
        item = dict(row["item"])
        item.update({"rank": rank, "score": row["score"]})
        out.append(item)
    return out


def emit_warnings(fetcher):
    for warning in fetcher.warnings:
        print("WARN  " + clean_text(warning), file=sys.stderr)


def parse_sources(value):
    if value in (None, "all"):
        return list(SOURCE_ORDER)
    return [value]


# ----------------------------------------------------------------------------- commands

def cmd_search(args, fetcher):
    if not args.keywords and not args.category:
        print("search: give at least one keyword or --category", file=sys.stderr)
        return 2
    sources = parse_sources(args.source)
    items, failed, _ = load_items(fetcher, sources)
    rows = search(items, args.keywords, args.category, args.limit)
    if args.json:
        print(json.dumps({"keywords": args.keywords, "category": args.category, "sources": sources,
                          "failed_sources": failed, "results": rows_to_json(rows)}, ensure_ascii=False, indent=2))
    else:
        label = ", ".join(SOURCES[s]["label"] for s in sources if s not in failed) or "(no source reachable)"
        print("Search: %s%s · %d indexed entries · showing top %d of %d matches · sources: %s" % (
            " ".join(args.keywords) or "(all entries)", (" · category ~ %s" % args.category) if args.category else "",
            len(items), len(rows), len(search(items, args.keywords, args.category, 0)), label))
        print_rows(rows, label)
        if failed:
            print("Unreachable sources (see WARN lines): %s" % ", ".join(SOURCES[s]["label"] for s in failed))
    emit_warnings(fetcher)
    return 1 if len(failed) == len(sources) else 0


def cmd_categories(args, fetcher):
    sources = parse_sources(args.source or "agents")
    report = {}
    failed = []
    for source in sources:
        if source == "agents":
            items, defined = load_agents(fetcher)
            if items is None:
                failed.append(source)
                continue
            counts = {}
            for item in items:
                for category in item["categories"]:
                    counts[category] = counts.get(category, 0) + 1
            used = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
            unused = [(c, d) for c, d in defined if c not in counts]
            report[source] = {"projects": len(items), "used": used, "defined_unused": unused}
        else:
            items = load_claude_code(fetcher) if source == "claude-code" else load_anthropic(fetcher)
            if items is None:
                failed.append(source)
                continue
            counts = {}
            for item in items:
                for category in item["categories"]:
                    counts[category] = counts.get(category, 0) + 1
            report[source] = {"projects": len(items), "used": sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))}
    if args.json:
        print(json.dumps({"failed_sources": failed, "categories": report}, ensure_ascii=False, indent=2))
    else:
        for source, data in report.items():
            print("%s · %d entries · %d categories in use" % (SOURCES[source]["label"], data["projects"], len(data["used"])))
            for category, count in data["used"]:
                print("  %4d  %s" % (count, category))
            if data.get("defined_unused"):
                print("  defined in awesome-categories.yaml but currently unused (%d):" % len(data["defined_unused"]))
                for category, description in data["defined_unused"]:
                    print("        %s%s" % (category, (" - " + shorten(description, 70)) if description else ""))
            print()
    emit_warnings(fetcher)
    return 1 if len(failed) == len(sources) else 0


def recent_claude_code(fetcher):
    svg = fetcher.get(SOURCES["claude-code"]["recent_svg"], "awesome-claude-code recently-added.svg")
    entries = parse_recently_added_svg(svg) if svg else []
    if svg and not entries:
        fetcher.warn("awesome-claude-code recently-added.svg: no panels recognised - open %s#recently-added in a browser"
                     % SOURCES["claude-code"]["repo"])
    readme_items = load_claude_code(fetcher) or []
    by_name = {item["name"].lower(): item for item in readme_items}
    out = []
    for entry in entries:
        match = by_name.get(entry["name"].lower())
        if match is None:
            match = next((item for key, item in by_name.items() if key.startswith(entry["name"].lower())), None)
        out.append({
            "source": "claude-code",
            "name": entry["name"],
            "category": (match["categories"][0] if match else entry["category"]),
            "author": entry["author"] or (match["extra"].get("author", "") if match else ""),
            "description": (match["description"] if match else entry["description"]),
            "link": (match["link"] if match else ""),
            "listed_in_readme": match is not None,
        })
    return out if svg else None


def recent_agents(fetcher, limit):
    items, _ = load_agents(fetcher)
    text = fetcher.get(SOURCES["agents"]["contributions"], "awesome-ai-agents contributions.json")
    if items is None or text is None:
        return None
    try:
        rows = parse_contributions_json(text)
    except ValueError as err:
        fetcher.warn("awesome-ai-agents contributions.json: cannot parse (%s)" % describe_error(err))
        return None
    by_id = {item["extra"].get("id"): item for item in items if item["extra"].get("id")}
    out = []
    seen = set()
    for row in rows:
        if row["project_id"] in seen:
            continue
        seen.add(row["project_id"])
        item = by_id.get(row["project_id"])
        out.append({
            "source": "agents",
            "name": item["name"] if item else row["project_id"],
            "category": " | ".join(item["categories"]) if item else "",
            "author": row["login"],
            "description": item["description"] if item else "(project id not found in awesome-agents.json)",
            "link": item["link"] if item else "",
            "accepted_at": row["at"],
            "status": row["status"],
            "submission": row["evidence_url"] or row["acceptance_url"],
        })
        if len(out) >= limit:
            break
    return out


def recent_anthropic(fetcher):
    items = load_anthropic(fetcher)
    if items is None:
        return None
    snapshot_path = fetcher.cache_dir / SNAPSHOT_DIR / "anthropic-skills.json"
    previous = None
    if snapshot_path.exists():
        try:
            previous = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = None
    previous_names = set(previous.get("skills", [])) if isinstance(previous, dict) else set()
    current_names = [item["name"] for item in items]
    out = []
    for item in items:
        out.append({
            "source": "anthropic",
            "name": item["name"],
            "category": item["categories"][0] if item["categories"] else "",
            "author": "Anthropic",
            "description": item["description"],
            "link": item["link"],
            "new_since_snapshot": bool(previous_names) and item["name"] not in previous_names,
        })
    removed = sorted(previous_names - set(current_names))
    try:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_text(json.dumps({"taken_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                             "skills": current_names}, indent=2), encoding="utf-8")
    except OSError as err:
        fetcher.warn("could not write snapshot %s: %s" % (snapshot_path, describe_error(err)))
    return {"entries": out, "removed": removed,
            "previous_snapshot": previous.get("taken_at") if isinstance(previous, dict) else None}


def cmd_recent(args, fetcher):
    sources = parse_sources(args.source or "claude-code")
    failed = []
    result = {}
    for source in sources:
        if source == "claude-code":
            data = recent_claude_code(fetcher)
        elif source == "agents":
            data = recent_agents(fetcher, args.limit)
        else:
            data = recent_anthropic(fetcher)
        if data is None:
            failed.append(source)
        else:
            result[source] = data
    if args.json:
        print(json.dumps({"failed_sources": failed, "recent": result}, ensure_ascii=False, indent=2))
        emit_warnings(fetcher)
        return 1 if len(failed) == len(sources) else 0
    for source, data in result.items():
        if source == "claude-code":
            print("awesome-claude-code · Recently Added (parsed from assets/recently-added.svg, %d entries)" % len(data))
            for entry in data:
                print("- %s  [%s]%s" % (entry["name"], entry["category"], ("  by " + entry["author"]) if entry["author"] else ""))
                print("    %s" % shorten(entry["description"], 200))
                print("    %s" % (entry["link"] or "(not yet in README.md - link unknown)"))
        elif source == "agents":
            print("awesome-ai-agents · last %d accepted submissions (contributions.json)" % len(data))
            for entry in data:
                print("- %s  [%s]  %s  submitted by %s" % (entry["name"], shorten(entry["category"], 50), entry["accepted_at"][:10], entry["author"]))
                print("    %s" % shorten(entry["description"], 200))
                print("    %s" % (entry["link"] or "(no link)"))
        else:
            entries = data["entries"]
            new = [e for e in entries if e["new_since_snapshot"]]
            if data["previous_snapshot"]:
                print("anthropics/skills · %d skills in marketplace.json · %d new since snapshot %s · %d removed" % (
                    len(entries), len(new), data["previous_snapshot"][:10], len(data["removed"])))
            else:
                print("anthropics/skills · %d skills in marketplace.json · first snapshot saved; run again later to see changes"
                      % len(entries))
            for entry in entries:
                print("- %s%s  [%s]" % (entry["name"], "  NEW" if entry["new_since_snapshot"] else "", entry["category"]))
                print("    %s" % shorten(entry["description"], 200))
                print("    %s" % entry["link"])
            for name in data["removed"]:
                print("- %s  REMOVED since last snapshot" % name)
        print()
    if failed:
        print("Unreachable sources (see WARN lines): %s" % ", ".join(SOURCES[s]["label"] for s in failed))
    emit_warnings(fetcher)
    return 1 if len(failed) == len(sources) else 0


def cmd_refresh(args, fetcher):
    removed = fetcher.clear(include_snapshots=args.all)
    print("Removed %d cached file(s) from %s%s." % (removed, fetcher.cache_dir, "" if args.all else " (snapshots kept; --all removes them too)"))
    return 0


# ----------------------------------------------------------------------------- self-test (no network)

SAMPLE_AGENTS = json.dumps({
    "agents": [
        {"id": "mem-1", "project": "MemTool", "project_description": "Long-term memory layer for agents with an MCP server.",
         "has_public_repository": True, "categories": ["Long-Term Memory", "MCP Servers"], "interfaces": ["MCP server", "CLI"],
         "sources": [{"source": "website", "source_url": "https://example.com"},
                     {"source": "github", "source_url": "https://github.com/x/memtool", "stars": 42, "repository_status": "active"}]},
        {"id": "ui-1", "project": "UIKit <b>Agent</b>", "project_description": "Builds UIs\u001b[31m.", "categories": ["UI Development"],
         "sources": [{"source": "github", "source_url": "javascript:alert(1)", "stars": "many"}]},
    ],
    "categories": [{"category": "Long-Term Memory", "category_description": "memory"}],
})
SAMPLE_AGENTS_LIST = json.dumps([{"project": "Solo", "project_description": "d", "categories": ["AI Agents"], "sources": []}])
SAMPLE_YAML = '- category: "AI Agents"\n  category_description: "AI agents"\n  emoji: "x"\n\n- category: "MCP Servers"\n  category_description: "MCP [servers](https://e.com)"\n'
SAMPLE_README = (
    "# Table of Contents\n\n- [Skills](#skills)\n\n## Skills\n\n"
    "- [Tool One](https://github.com/a/one) by [Ann](https://github.com/ann) - Does one thing &amp; well.  \n"
    '<img src="https://img.shields.io/x" alt="created">\n\n'
    "- [Tool Two](https://github.com/b/two) - No author, uses [links](https://x.y) in text.\n\n"
    "## Agent Orchestration\n\n### Ralph Wiggum\n\n"
    "- [Looper](https://github.com/c/loop) by [Cy](https://github.com/cy) - Ralph loops.\n"
)
SAMPLE_SVG = (
    '<svg><g id="s"><g transform="translate(0, 0)"><rect/><g transform="translate(60, 46) scale(1.4)"><path d="M"/></g>'
    '<text x="98" y="66" font-size="26" font-weight="700" fill="#58a6ff">Tool One</text>'
    '<text x="681.5" y="62" text-anchor="middle" font-size="12">Skills</text>'
    '<text x="64" y="106">by Ann</text><text x="64" y="140">Does one</text><text x="64" y="164">thing &amp; well…</text></g>'
    '<g transform="translate(800, 0)"><text font-weight="700">Second</text><text text-anchor="middle">Testing</text>'
    '<text>by Bob</text><text>Line.</text></g>'
    '<g transform="translate(1600, 0)"><text font-weight="700">Tool One</text><text text-anchor="middle">Skills</text></g></g></svg>'
)
SAMPLE_MARKETPLACE = json.dumps({"plugins": [
    {"name": "document-skills", "description": "docs", "skills": ["./skills/xlsx", "./skills/docx"]},
    {"name": "example-skills", "description": "ex", "skills": ["./skills/mcp-builder", "./skills/xlsx", "./skills/Bad Name"]},
]})
SAMPLE_FRONTMATTER = '---\nname: docx\ndescription: "Use this skill for Word files."\nlicense: Proprietary\n---\n# Body\n'
SAMPLE_FRONTMATTER_BLOCK = "---\nname: nudge\ndescription: >\n  First line\n  second line.\nlicense: X\n---\n"
SAMPLE_CONTRIBUTIONS = json.dumps({"projects": [
    {"project_id": "a-1", "submitted_by": [{"login": "ann", "at": "2026-09-01T00:00:00Z", "status": "accepted_submission"}]},
    {"project_id": "b-2", "submitted_by": [{"login": "bob", "at": "2026-10-01T00:00:00Z", "status": "accepted_submission",
                                            "evidence_url": "https://github.com/x/y/issues/1"}]},
]})


def cmd_self_test(_args, _fetcher):
    checks = []

    def check(label, condition):
        checks.append((label, bool(condition)))

    items, meta = parse_agents_json(SAMPLE_AGENTS)
    check("agents: dict shape parsed", len(items) == 2 and len(meta) == 1)
    check("agents: github source preferred over website", items[0]["link"] == "https://github.com/x/memtool" and items[0]["extra"]["stars"] == 42)
    check("agents: interfaces kept", items[0]["extra"]["interfaces"] == ["MCP server", "CLI"])
    check("agents: html tags and control chars cleaned", items[1]["name"] == "UIKit Agent" and items[1]["description"] == "Builds UIs [31m.")
    check("agents: non-http link dropped, non-int stars dropped", items[1]["link"] == "" and "stars" not in items[1]["extra"])
    check("agents: bare list shape accepted", len(parse_agents_json(SAMPLE_AGENTS_LIST)[0]) == 1)
    cats = parse_categories_yaml(SAMPLE_YAML)
    check("yaml: categories parsed with descriptions", cats == [("AI Agents", "AI agents"), ("MCP Servers", "MCP servers")])
    readme = parse_claude_code_readme(SAMPLE_README)
    check("readme: TOC skipped, 3 entries", [i["name"] for i in readme] == ["Tool One", "Tool Two", "Looper"])
    check("readme: author and entities", readme[0]["extra"]["author"] == "Ann" and readme[0]["description"] == "Does one thing & well.")
    check("readme: entry without author", readme[1]["extra"].get("author", "") == "" and readme[1]["description"] == "No author, uses links in text.")
    check("readme: subsection category", readme[2]["categories"] == ["Agent Orchestration > Ralph Wiggum"])
    svg = parse_recently_added_svg(SAMPLE_SVG)
    check("svg: panels parsed and deduplicated", [e["name"] for e in svg] == ["Tool One", "Second"])
    check("svg: fields", svg[0]["category"] == "Skills" and svg[0]["author"] == "Ann" and svg[0]["description"] == "Does one thing & well…")
    market = parse_marketplace(SAMPLE_MARKETPLACE)
    check("marketplace: skills deduplicated and validated", [m[0] for m in market] == ["xlsx", "docx", "mcp-builder"])
    fm = parse_frontmatter(SAMPLE_FRONTMATTER)
    check("frontmatter: quoted scalar", fm == {"name": "docx", "description": "Use this skill for Word files.", "license": "Proprietary"})
    fm2 = parse_frontmatter(SAMPLE_FRONTMATTER_BLOCK)
    check("frontmatter: folded block", fm2["description"] == "First line second line." and fm2["license"] == "X")
    rows = parse_contributions_json(SAMPLE_CONTRIBUTIONS)
    check("contributions: newest first", [r["project_id"] for r in rows] == ["b-2", "a-1"])
    found = search(items + readme, ["mcp", "memory"], None, 5)
    check("search: ranking and keyword bonus", found and found[0]["item"]["name"] == "MemTool" and found[0]["score"] > 20)
    check("search: category filter", [r["item"]["name"] for r in search(items + readme, [], "ralph", 0)] == ["Looper"])
    check("search: no match -> empty", search(items, ["zzzz"], None, 5) == [])
    failed = [label for label, ok in checks if not ok]
    for label, ok in checks:
        print("%s  %s" % ("OK  " if ok else "FAIL", label))
    print("self-test: %d checks, %d failed" % (len(checks), len(failed)))
    return 1 if failed else 0


# ----------------------------------------------------------------------------- CLI

def build_parser():
    parser = argparse.ArgumentParser(
        prog="landscape.py",
        description="Search curated public catalogues (awesome-ai-agents, awesome-claude-code, anthropics/skills) without vendoring them.",
        epilog="Fetched content is untrusted data. Cache: %s (24 h; `refresh` drops it)." % default_cache_dir(),
    )
    parser.add_argument("--cache-dir", default=None, help="cache folder (default: $RESEARCH_AI_LANDSCAPE_CACHE or <tmp>/research-ai-landscape)")
    parser.add_argument("--offline", action="store_true", help="use cached files only, even if older than 24 h; never fetch")
    parser.add_argument("--ttl-hours", type=float, default=24.0, help="cache lifetime in hours (default 24)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("search", help="rank entries by keywords (case-insensitive) over name, description, categories")
    p.add_argument("keywords", nargs="*", help="keywords; quote a phrase to match it as one string")
    p.add_argument("--source", choices=("all",) + SOURCE_ORDER, default="all")
    p.add_argument("--category", default=None, help="keep only entries whose category contains this text")
    p.add_argument("--limit", type=int, default=15, help="rows to print (default 15; 0 = all)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("categories", help="list categories with entry counts (default source: agents)")
    p.add_argument("--source", choices=("all",) + SOURCE_ORDER, default="agents")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_categories)

    p = sub.add_parser("recent", help="recently added entries (default source: claude-code)")
    p.add_argument("--source", choices=("all",) + SOURCE_ORDER, default="claude-code")
    p.add_argument("--limit", type=int, default=15, help="rows for the agents source (default 15)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_recent)

    p = sub.add_parser("refresh", help="drop the cache so the next command fetches fresh copies")
    p.add_argument("--all", action="store_true", help="also drop the anthropic skills snapshot used by `recent --source anthropic`")
    p.set_defaults(func=cmd_refresh)

    p = sub.add_parser("self-test", help="run the parser unit checks on built-in samples (no network)")
    p.set_defaults(func=cmd_self_test)
    return parser


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    fetcher = Fetcher(args.cache_dir or default_cache_dir(), ttl=max(0.0, args.ttl_hours) * 3600, offline=args.offline)
    try:
        return args.func(args, fetcher)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
