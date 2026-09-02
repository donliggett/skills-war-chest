# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

<!-- Everything above is upstream: forrestchang/andrej-karpathy-skills.
     Everything below is specific to this repository. If you re-fetch the
     upstream file, re-append this section. -->

## 5. This Repository — War Chest

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

**One command rebuilds everything:** `python3 tools/build.py` (chains
`gen_docs.py` and `bundle.py`). `python3 tools/sync.py` first if upstream may
have moved. `sources/` is a gitignored clone cache — never commit it, never edit
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
