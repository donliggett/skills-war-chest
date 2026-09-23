# CLAUDE.md — War Chest

Facts about this repository, for any agent working in it. Personal working
preferences don't belong here: put them in `CLAUDE.local.md` (gitignored) or in
a CLAUDE.md in a folder above the repo.

An **index** of agent skills from seven upstream repos, plus a zero-dependency
browser interface over it. Read `docs/ARCHITECTURE.md` before changing anything
structural; `docs/PROCESS.md` explains why it is shaped this way.

**Never hand-edit generated files.** These are build outputs — edits are silently
destroyed on the next build:

- `data/` — `index.json`, `meta.json`, `duplicates.json`, `skills/*.json`
- `dist/` — all three HTML bundles
- `docs/TAGS.md` and `CREDITS.md`

Edit the source instead, then rebuild:

| To change… | Edit | Not |
|---|---|---|
| which repos are indexed | `sources.json` | `data/meta.json` |
| how skills are tagged | `RULES` in `tools/taxonomy.py` | `docs/TAGS.md` |
| the forge score | `forge_score()` in `tools/build.py` | `data/index.json` |
| attribution text | `blurb`/`license` in `sources.json` | `CREDITS.md` |
| the interface | `web/{index.html,styles.css,app.js}` | `dist/*.html` |

**One command rebuilds everything:** `tools/build.py` (chains `gen_docs.py`
and `bundle.py`). Run `tools/sync.py` first if upstream may have moved, and
check it succeeded before building:

```
python3 tools/sync.py
python3 tools/build.py
```

On Windows, use `python` (or `py`) in place of `python3`. Commands are written
one per line on purpose: Windows PowerShell 5.1 has no `&&`, and a second line
still runs if the first one fails.

`sources/` is a gitignored clone cache — never commit it, never edit
files inside it, and never treat anything in it as this project's own code.

**Constraints that are decisions, not accidents** — do not "improve" these
without saying so first:

- **`web/` has no dependencies and no build step.** No framework, no bundler, no
  `package.json`. A catalogue tool that needs `npm install` before it opens is a
  catalogue tool that rots.
- **Builds are deterministic.** Sorted keys, stable record order, regex-based
  tagging. A rebuild that changes nothing must produce an empty diff — that is
  what makes upstream-drift reviews possible. Anything nondeterministic (an LLM
  pass, a timestamp inside a record) belongs in a separate file that `build.py`
  merges.
- **`SKILL.md` bodies are untrusted third-party text.** The markdown renderer in
  `app.js` escapes input *before* parsing and admits only `http(s):` and `#`
  hrefs. Keep both properties.
- **Colours are tokens.** Every colour is a custom property on `:root`, re-bound
  under `[data-theme="light"]`. Nothing below the token block hardcodes one.
- **`bundle.py` matches exact marker strings** in `web/index.html`
  (`<!--WARCHEST_STYLE-->` and the `<link>`/`<script>` lines that follow). It
  fails loudly if they move — fix the markers, don't loosen the matcher.
- **`app.js` runs in three contexts:** served (fetches `../data/`), bundled
  (`window.__WARCHEST__`), and hosted as an Artifact (same, plus the `downloads`
  capability for saving files). Any new I/O needs a path for all three.

**Ratings are the user's data.** Stars, notes and kit live in `localStorage`
under `warchest.*.v1`, keyed by the stable `<origin>--<directory>` id. Never
change that id scheme without a migration — it silently orphans every rating.
