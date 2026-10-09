---
name: fabric-kit-maintainer
description: Carry lessons from a finished Fabric Apps / Rayfin project back into the owner's reusable fabric-kit repository and reinstall it. Use when the owner says things like "upiši lekcije u kit", "nadogradi kit", "retro", "prenesi iskustvo iz projekta u kit", "ažuriraj fabric-kit", "bump the kit version", or asks what the kit should learn from this project. Extracts generic lessons (not project trivia) from docs/PREDAJA.md and the git log, adds dated entries to the kit's LEKCIJE.md, updates skill references, bumps VERSION with SemVer, writes the CHANGELOG, runs the kit tests, commits in the kit repo, then reinstalls into the current project. Not for writing the project's own handoff document (that is docs/PREDAJA.md itself).
---

# Fabric Kit Maintainer

Chat context dies with the session; only files in repositories survive. This skill moves what a project
taught us into the kit (`fabric-kit`), so the next project starts with it. Work in the owner's language
(Serbian Latin); kit `docs/*.md`, `README.md` and `CHANGELOG.md` are Serbian, `SKILL.md` files and their
`references/` are English.

## Inputs

- The current project: `docs/PREDAJA.md` (section "Naučene lekcije" and "Odluke vlasnika"), `AGENTS.md`
  (project part), `README.md` troubleshooting table, `git log --oneline`, and any `docs/kit/` notes.
- Suggestions from the monthly landscape review (skill `research-ai-landscape`) that the owner accepted,
  with their evidence links.
- The kit repository: the owner's `fabric-kit` clone. If it is not on disk, clone it to a temporary folder
  (`git clone <kit url> /tmp/fabric-kit`), or ask for the URL/path. The project's `.claude/fabric-kit.json`
  carries `source` and the installed `version`.

## Procedure

1. **Collect candidates.** Read `docs/PREDAJA.md` and `git log`. For each candidate lesson write one line:
   symptom → cause → rule → where it was verified (file, date, tenant behaviour). Keep only lessons that
   hold for **any** Fabric App or Rayfin project: SDK and CLI behaviour, Fabric limits, permission facts,
   deploy procedure, testing method, UX rules proven in review. Drop project trivia (thresholds of one
   domain, a station count, a workspace name, a specific design decision).
2. **Check for duplicates.** Search the kit's `kit/docs/LEKCIJE.md` and the skill references for the same
   lesson. If it exists, sharpen the entry (add the new evidence and date) instead of adding a copy.
3. **Write the lesson.** Add a dated entry to `kit/docs/LEKCIJE.md` in the existing format (number, date,
   title, Simptom, Uzrok, Pravilo, Provereno). Then update the place that must change behaviour:
   - SDK/data/functions/deploy/permissions/gates → the matching file in
     `kit/skills/fabric-rayfin-engineering/references/` (and `SKILL.md` if it is a non-negotiable rule);
   - design or review rule → the relevant `fabric-app-*` skill reference;
   - working-method change → `kit/docs/METOD-RADA.md`;
   - a rule every session must see → `kit/AGENTS.kit.md` (keep it short; details go to the skill).
   Quote exact error texts and UI strings; keep the English/Serbian split described above.
4. **Version and changelog.** SemVer in `VERSION`: **patch** for lessons and docs, **minor** for a new skill
   or a new rule in `AGENTS.kit.md`/`SKILL.md`, **major** for installer or structure changes. Add a
   `CHANGELOG.md` entry with today's date that names the source project (its public repo name, never a
   tenant id, workspace name or URL).
5. **Test the kit.** `bash tests/test-install.sh` (installer idempotence, markers, skills, CLAUDE.md import),
   `bash tests/test-skills.sh` (every `SKILL.md`: frontmatter, name = folder, description ≤ 1024 chars, links;
   `landscape.py` self-test) and `bash tests/check-links.sh` (every relative link resolves). All must pass;
   `bash -n install.sh` for syntax.
6. **Commit in the kit repo.** Message in the form `Kit 1.1.0: lekcije iz projekta <ime projekta> (<N> lekcija)`;
   push if the owner has asked for pushes.
7. **Reinstall into the current project.** `bash /path/to/fabric-kit/install.sh .` (or `install.ps1`),
   check `.claude/fabric-kit.json` shows the new version, review the diff (`git status`), and commit in the
   project: `fabric-kit 1.1.0: nadogradnja skillova i lekcija`.
8. **Report** what moved into the kit, what stayed project-specific, the new version, and the test results.

## Never put into the kit

Secrets and tokens, tenant or workspace ids and names, item ids, hosting URLs, publishable keys, user
emails, deploy logs, measured numbers that only describe one tenant, domain thresholds, approved design
directions of one app, or copies of project source files. The kit holds **rules, procedures and patterns**;
the project holds its facts in `docs/PREDAJA.md`.

## Quality bar for a lesson entry

- A reader who was not there can reproduce the symptom and apply the rule.
- The exact error text or UI string is quoted where one exists.
- "Provereno" names the surface (unit test, demo e2e, live Fabric tenant) and the date.
- The rule says what to do, not only what went wrong.
