# Process

How this was built, in the order it happened, with the decisions and the things
that went wrong. If you want to rebuild it from nothing, or extend it, this is
the document to read.

---

## 0. The brief

> A sleek, themed, responsive, searchable browser interface for an AI skills
> collection. Tags for organisation and search. Credit the origin. Skill contents
> populate the DOM body. A skills rating system. Match the architecture standards
> at agentskills.io. Document the process.

Seven seed repositories. Four decisions were taken to the user before any code
was written, because each one forecloses a different design:

| Question | Chosen | Why it mattered |
|---|---|---|
| Payload | index + full text; upstream clones gitignored | Vendoring everything meant a 100 MB+ repo (Meng To's assets alone); metadata-only meant no offline reading. |
| Theme | dark slate + brass | Sets the token palette, which everything downstream inherits. |
| Rating | manual stars **and** a computed score | Two different questions — "is this well built" vs "is this useful to me" — and conflating them makes both useless. |
| Extras | all four: dedupe, install kit, stats, hosted copy | Each is a separate module; knowing up front avoided retrofitting. |

## 1. Read the standard first

Fetched `agentskills.io/home` and `/specification` before touching any repo. This
directly shaped three things:

- **The data model.** A skill is a directory with `SKILL.md` plus optional
  `scripts/`, `references/`, `assets/`. That is the record, not "a markdown file".
- **The frontmatter schema.** `name` (≤64, lowercase-hyphenated, must match the
  parent directory), `description` (≤1024), and optional `license`,
  `compatibility`, `metadata`, `allowed-tools`. Every one of these became a
  scored check.
- **Progressive disclosure.** Metadata at discovery, body on activation,
  resources on demand. The interface mirrors that exactly: the index carries
  name/description/tags, the body loads when a card is opened, bundled files are
  listed but not fetched.

That last point is why the score penalises very long bodies: the spec recommends
under 500 lines because the whole body enters context on activation.

## 2. Survey before designing

Cloned all seven repos shallow, then counted before deciding anything:

```
mattpocock    37      emilkowalski  12      google       132
slavingia     10      huggingface   26      mengto       132
addyosmani    25                            ── 374 files, 369 unique
```

Three facts changed the plan:

1. **374 `SKILL.md` files, 3.0 MB of text.** Small enough to inline everything
   into one HTML file — which is why the no-server bundle exists at all. Had it
   been 30 MB, the architecture would have had to be server-first.
2. **Every repo nests differently.** `skills/`, `agent-skills/`, `hf-mcp/skills/`,
   `plugins/…/skills/`. Hence the `roots` array in `sources.json` rather than a
   hardcoded walk.
3. **Google ships 5 skills twice** (once under `skills/`, once under `plugins/`).
   Hence content-hash deduplication, with the extra locations recorded in
   `also_at` rather than silently dropped.

Also noted and left alone: `MengTo/Skills` is ~100 MB, almost all bundled media.
Another argument for keeping `sources/` out of git.

## 3. Design the tag vocabulary

The upstream repos have almost no usable metadata — a handful of Google skills
carry `metadata.category`, nobody else carries anything. Tags had to be derived.

Two properties were non-negotiable:

- **Faceted.** A flat tag cloud collapses "what area", "what action" and "what
  technology" into one list where `design`, `refactor` and `react` are peers.
  Six facets — domain, capability, stack, format, agent, trait — let a filter
  mean "(animation OR design) AND react" instead of a pile of ORs.
- **Deterministic.** Same clone in, same tags out, so `data/index.json` diffs are
  reviewable. That ruled out an LLM pass over 369 files and led to a weighted
  regex table with an explicit threshold.

Two calibration passes were needed, both caught by looking at the output rather
than trusting the design:

- **The path leak.** Every Meng To skill lives under `agent-skills/`, so the
  pattern `\bagent\b` on `domain:ml-ai` fired on all 132 of them. Fix: match the
  path *below* the configured source root, so repo folder names never contribute.
- **The threshold was too tight.** At weight 3 for descriptions, a skill whose
  description said "Build … in Three.js" scored 4 and missed `stack:threejs`.
  Raising the description weight to 5 and dropping the threshold to 5 reduced the
  rule to something explainable: *name, path or description fires the tag; body
  text alone needs a heading plus repeated prose.*

After the second pass: 87 tags, 4.6 topical tags per skill, 5 skills with no
topical tag (all genuinely generic — `wait-what`, `ask-matt`). Full vocabulary in
[`TAGS.md`](TAGS.md), generated from the rule table so it cannot drift.

## 4. Design the score

Two ratings, deliberately:

- **Forge score (computed, 0–100).** Objective, reproducible, argues from the
  spec. Answers *is this well built?*
- **Stars (yours, 1–5, plus status and notes).** Answers *is this useful to me?*

Conflating them would be the obvious mistake. A 30-line skill with no code blocks
scores in the C band and can still be the one you reach for daily; the notes field
exists precisely to record that.

Weights and every individual check are in
[`ARCHITECTURE.md`](ARCHITECTURE.md#the-forge-score). They are opinions, written
down in one function so they can be changed in one place.

Sanity check on the first run: median 78, distribution 9/197/101/52/10 across
S/A/B/C/D. Google clusters at the top — not favouritism, but because their skills
consistently state anti-triggers ("Don't use for X, use Y instead"), which is the
single most valuable and rarest thing a description can do.

## 5. Build the pipeline

Four scripts, one boundary each:

| Script | Does |
|---|---|
| `sync.py` | clone/fast-forward each repo into `sources/<id>` |
| `taxonomy.py` | the tag vocabulary and derivation rules — data, not logic |
| `build.py` | parse → dedupe → tag → score → cluster → emit `data/` |
| `gen_docs.py` | regenerate `TAGS.md` and `CREDITS.md` from the code and the build |
| `bundle.py` | inline `web/` + `data/` into `dist/*.html` |

`build.py` chains the last two, so `python3 tools/build.py` refreshes everything.

Deliberate choices worth keeping if you rewrite this:

- **JSON on disk, not a database.** 369 records. A database is a dependency
  bought with nothing.
- **Sorted keys, stable order.** A rebuild that changes nothing produces an empty
  diff, which makes the rebuild-after-upstream-changed workflow reviewable.
- **Generated docs.** `TAGS.md` and `CREDITS.md` are outputs. Hand-maintained
  versions of either would be wrong within two upstream updates.
- **Credit is structural, not decorative.** Author, repo, license, source path
  and the pinned commit ride on every record, so a card cannot render without its
  attribution.

## 6. Build the interface

Zero dependencies, zero build step, one `app.js`. A catalogue tool that needs
`npm install` before it opens is a catalogue tool that rots on the shelf.

Layout: filter rail, result grid, detail drawer. Standard, and standard is right
here — the novelty budget goes into the tag facets and the score, not into making
someone learn a new way to browse a list.

The theme is defined once as custom properties on `:root` and re-bound under
`[data-theme="light"]`; nothing below that block hardcodes a colour, so the light
theme was free.

Three things were found by screenshotting a headless render rather than by
reading the code:

1. **Every progress bar was invisible.** `<span class="fill">` inside a
   non-flex parent stays `display:inline`, and inline elements ignore `height`.
   The tracks rendered, the fills did not. Fixed with `display:block`.
2. **Sorting by score buried six of seven repos.** Google holds 127 of the 369
   skills and writes the best descriptions, so the entire first screen was Google.
   Added a `balanced` sort — score-ordered within each repo, then round-robined
   across repos — and made it the default. All seven repos now appear above the
   fold.
3. **The theme button wrapped onto its own row on a phone.** Wrapped the button
   cluster in a flex container so it wraps as a unit.

Verification was a Playwright script driving the real bundle: search, operator
search, facet click, clear-all, open drawer, keyboard rating, kit add, all five
modals, both themes, and a 400 px viewport checked for horizontal overflow.
Console errors: none.

## 7. Publish

`bundle.py` emits three self-contained files from the same `web/` sources: the
full bundle (3.5 MB, every skill body), a lite one (0.5 MB, catalogue only), and
a body-only variant for hosts that supply their own `<head>` — that last one is
what gets published as a hosted Artifact page.

Publishing surfaced one more constraint worth recording: the hosted viewer blocks
a page from starting its own download, so `<a download>` for `install-kit.sh` and
the ratings export did nothing there. The page now asks for the host's `downloads`
capability at click time and falls back to the plain anchor when it is absent, so
the same `app.js` works from disk, from a local server and hosted. That allowlist
has no `.sh`, hence the `hostedName` argument that offers `install-kit.txt`
instead when running hosted.

---

## Rebuilding from scratch

```bash
git clone <this repo> && cd skills-war-chest
pip install pyyaml
python3 tools/sync.py       # ~2 min, ~110 MB into sources/
python3 tools/build.py      # ~15 s
open dist/skills-war-chest.html
```

## Iterating

**Add a repository.** Append to `sources.json` (`id`, `repo`, `url`, `author`,
`author_url`, `license`, `blurb`, `roots`, `accent`), then `sync.py` and
`build.py`. Check the new skills' tags — a repo in an unfamiliar domain usually
needs a rule or two added to `taxonomy.py`.

**Add or fix a tag.** Edit `RULES` in `taxonomy.py`, rebuild, read the
`data/index.json` diff. A rule that moves hundreds of skills is too broad: anchor
it with `\b`, or add it to `NAME_PATH_ONLY` so it only fires from a name or path.

**Change the score.** Edit `forge_score` in `build.py` and the matching entry in
`score_weights`. The drawer's breakdown chart is generated from `score_weights`,
so a new component appears with no interface change.

**Tune duplicate detection.** The threshold is the `0.42` in `build.py`'s pair
loop and in `data/duplicates.json`. Lower finds more and means less.

**Share your ratings.** Export from the ★ menu, commit the JSON, import on the
other machine. Ratings key off the stable `<origin>--<directory>` id, so they
survive rebuilds and upstream updates.

## Known limitations

- **Tagging is lexical.** A skill that never names its own domain gets thin tags.
  Five skills have no topical tag at all. An LLM pass would fix this at the cost
  of determinism; if you add one, write its output to a separate file that
  `build.py` merges, so the deterministic layer stays diffable.
- **The score rewards a house style.** Explicit triggers, anti-triggers and
  bundled resources are Google's conventions as much as they are the spec's.
  Short, sharp, human-voiced skills score lower than they deserve.
- **`HEAD` links, pinned display.** `github_url` points at `HEAD`, so a link can
  drift if a skill is moved upstream. `meta.json` records the commit actually
  indexed, which is what the drawer and `CREDITS.md` display.
- **Ratings are per-browser.** `localStorage` is not synced. Export/import is the
  bridge, on purpose — no account, no server, nothing leaves the machine.
- **Duplicate clustering only reads name and description.** Two skills with
  identical bodies and different descriptions will not cluster.
