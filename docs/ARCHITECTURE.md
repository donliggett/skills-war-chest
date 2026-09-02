# Architecture

Four stages, each a plain file boundary. Any stage can be replaced without
touching the others.

```
sources.json ──▶ tools/sync.py ──▶ sources/<id>/          (gitignored clones)
                                        │
                 tools/taxonomy.py ─────┤
                                        ▼
                 tools/build.py ──▶ data/meta.json
                                    data/index.json
                                    data/skills/<id>.json
                                    data/duplicates.json
                                        │
                 tools/gen_docs.py ─────┼──▶ docs/TAGS.md, CREDITS.md
                                        │
                 tools/bundle.py  ──────┴──▶ dist/*.html
                                        │
                 web/{index,styles,app} ┴──▶ the interface (served or inlined)
```

The interface never reads `sources/`. It reads `data/` and nothing else, which is
why the same `app.js` runs served, bundled and hosted without a code path for each.

---

## Data contracts

### `sources.json` — hand-edited, the only input

```jsonc
{
  "sources": [{
    "id":         "google",              // slug; also the folder under sources/
    "repo":       "google/skills",       // owner/name on GitHub
    "url":        "https://github.com/google/skills",
    "author":     "Google",
    "author_url": "https://github.com/google",
    "license":    "Apache-2.0",          // "Unspecified" when the repo declares none
    "blurb":      "One line shown in Credits.",
    "roots":      ["skills", "plugins"], // subtrees to walk; first match wins on ties
    "accent":     "#e0a34a"              // the card's left rule and its bar in Stats
  }]
}
```

`roots` matters. Several repos keep skills in more than one subtree, and a few
ship the same skill twice (Google has 5 duplicated under `plugins/`). Listing
both roots and deduplicating by content hash keeps the count honest while still
recording where else a file appeared.

### `data/index.json` — one record per skill, no body

Everything the grid, sidebar, search and compare view need, so the first paint
costs one 0.5 MB request instead of 369 small ones.

| Field | Notes |
|---|---|
| `id` | `<origin>--<directory name>`; stable across rebuilds, used in the URL hash |
| `name` / `description` | from frontmatter, falling back to the directory name |
| `origin`, `origin_repo`, `origin_author`, `origin_license` | denormalised so a card renders without a join |
| `source_path` | path inside the upstream repo — what `sparse-checkout` is given |
| `github_url`, `raw_url` | deep links, pinned to `HEAD` |
| `tags` | sorted `facet:value` strings — see `docs/TAGS.md` |
| `score`, `grade`, `score_breakdown` | see below |
| `body_lines`, `words`, `code_blocks`, `languages`, `file_count` | shape of the skill |
| `has_scripts` / `has_references` / `has_assets` | spec-recommended subdirectories |
| `dup_cluster` | cluster key, or `null` |
| `also_at` | paths where a byte-identical copy was found |

### `data/skills/<id>.json` — the full record

The index record plus `body` (the complete `SKILL.md` markdown), `frontmatter`
(everything except the description), `extra_files` (up to 60 bundled paths), and
`parse_error` when the frontmatter was malformed.

### `data/meta.json` — build stamp and vocabulary

Build timestamp, per-source credit including the **pinned commit**, the facet
list and labels, the tag vocabulary with counts, the score weights, collection
stats, and `warnings` — every skill whose frontmatter is off-spec.

### `data/duplicates.json`

`clusters` (key → member ids, union-find over pairs) and the top 400 `pairs`
with their similarity, so the drawer can show "82% overlap" on a specific pair.

All four files are written with `sort_keys=True` and a stable record order, so a
rebuild that changes nothing produces a byte-identical diff.

---

## The forge score

0–100 across four components. It measures **how well a skill is built**, not how
useful it is to you — that is what the star rating is for. Every weight below is
a judgement call, and all of them live in one function (`forge_score` in
`tools/build.py`) so they are easy to argue with and easy to change.

### Spec compliance — 30

Straight from the [specification](https://agentskills.io/specification).

| Check | Points |
|---|--:|
| `name` is lowercase-hyphenated, ≤ 64 chars | 10 (4 if present but malformed) |
| `name` matches the parent directory | 6 |
| `description` present and ≤ 1024 chars | 9 (3 if over) |
| Frontmatter parses as a YAML mapping | 5 |

### Description quality — 25

The description is the *only* text an agent sees when deciding whether to
activate a skill. A vague one makes a good skill invisible.

| Check | Points |
|---|--:|
| Length 120–700 chars | 11 (6 for 60–120 or 700–1024) |
| States a trigger — "use when", "use this skill when" | 9 |
| States an anti-trigger — "don't use for…" | 5 |

The anti-trigger is worth a lot for how rare it is. Google's skills use it
heavily, which is most of why they crowd the top of the score ranking.

### Body substance — 25

| Check | Points |
|---|--:|
| 40–500 lines | 12 (7 for 15–40, 8 for 500–900, 3 otherwise) |
| ≥ 3 headings | 6 (3 for 1–2) |
| ≥ 2 fenced code blocks | 7 (4 for 1) |

The spec recommends keeping `SKILL.md` under 500 lines and moving detail into
`references/`. Long files are penalised for the same reason the spec says so:
the whole body enters context on activation.

### Packaging — 20

| Check | Points |
|---|--:|
| `scripts/` | 5 |
| `references/` | 4 |
| `assets/` | 3 |
| `metadata.version` declared | 3 |
| License declared (skill or repo) | 3 |
| `compatibility` or `allowed-tools` declared | 2 |

### Grades

`S` ≥ 90 · `A` 78–89 · `B` 65–77 · `C` 50–64 · `D` < 50.

Current distribution: 9 S, 197 A, 101 B, 52 C, 10 D — median 78. A low grade
often means "written for a human reader" rather than "bad": several of the most
useful short skills score in the C band because they are 30 lines with no code.
That is exactly the gap the star rating fills.

---

## Near-duplicate detection

Token-set Jaccard over `name + description`, stopworded, tokens ≥ 3 characters.
Pairs at **≥ 0.42** with at least 4 shared tokens become edges; union-find over
those edges yields clusters. The highest-scoring member is suggested as the
keeper.

Deliberately shallow: it compares what an agent sees at *discovery* time, which
is where near-duplicates actually hurt — two skills with near-identical
descriptions make the routing decision ambiguous no matter how different their
bodies are.

At 0.42 it finds 10 clusters (24 skills), including families that are correctly
distinct but confusingly described: the five Google WAF pillars, three mobile-ads
formats, `bigtable-basics` vs `spanner-basics`. Lower it to ~0.35 and the noise
overwhelms the signal.

---

## Interface

`web/app.js` is one IIFE, ~970 lines, no dependencies and no build step, because
a catalogue tool that needs `npm install` to open is a catalogue tool that rots.

- **Loading** — `window.__WARCHEST__` if bundled, otherwise `fetch('../data/…')`.
  Skill bodies load on demand when served, and come pre-inlined when bundled.
- **State** — one `S` object. Every mutation calls `render()`, which recomputes
  filters, grid, chips and sidebar counts. 369 records re-filter in well under a
  frame, so there is no virtualisation and no framework.
- **Markdown** — a deliberate subset (headings, fences, lists, tables, quotes,
  rules, inline marks). Input is HTML-escaped *before* parsing and only
  `http(s):` and `#` hrefs survive, because `SKILL.md` bodies are third-party
  text rendered into the page.
- **Persistence** — ratings, kit and prefs in `localStorage` under
  `warchest.*.v1`, every access wrapped so private-mode failures are silent.
  Export/import is plain JSON, so ratings can be committed and shared.
- **Theming** — every colour is a custom property on `:root`, re-bound under
  `[data-theme="light"]`. Nothing below the token block hardcodes a colour.

### Extending it

- **New facet** — add it to `FACETS` and `FACET_LABELS` in `taxonomy.py` with
  `facet:` prefixed rules. The sidebar, chips, compare view and tag colours all
  read the facet list from `meta.json`; only a `.tag.f-<facet>` colour rule in
  `styles.css` is optional hand-work.
- **New score component** — add it to `forge_score` and to `score_weights` in
  `meta.json`. The drawer's bar chart is generated from `score_weights`, so it
  picks the new component up with no interface change.
- **New source** — append to `sources.json`, run `sync.py` then `build.py`.
