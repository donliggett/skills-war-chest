# War Chest

A searchable, tagged, rated browser interface over agent skills gathered from
across GitHub. 369 skills from 7 repositories, indexed against the open
[Agent Skills specification](https://agentskills.io/specification).

Nothing here forks anyone's work. The chest is an **index**: it reads upstream
clones, derives tags and a quality score, and stores that metadata — no
`SKILL.md` text. Opening a skill reads its text live from the original
repository, and installing one pulls from there too.

---

## Open it

**No setup** — double-click `dist/skills-war-chest.html`. The interface and the
whole index are inlined into that one 0.6 MB file: no server, no build step.
Browsing, search, ratings and compare work offline; the text of a skill is
fetched from GitHub when you open it, so reading one needs a connection.

**While iterating on the interface** — serve the repo so `web/index.html` can
fetch `data/`:

```bash
python3 -m http.server 8080
# http://localhost:8080/web/
```

**On a static host** — `dist/site/` is a deployable site: `index.html` at the
root beside `data/`, so any host serves it as-is, and `dist/site.zip` is the
same tree packed for upload. It behaves like the single file, served as
separate files.

## Rebuild it

```bash
python3 tools/sync.py     # clone / fast-forward the 7 upstream repos into sources/
python3 tools/build.py    # parse → tag → score → emit data/, docs, dist/
```

`build.py` chains `gen_docs.py` and `bundle.py`, so one command refreshes the
index, `docs/TAGS.md`, `CREDITS.md` and the standalone bundle. Add a repo by
appending to `sources.json` and running those two commands again.

Requires Python 3.9+, `pyyaml`, and `git`. Nothing else — the interface has zero
runtime dependencies and no build toolchain.

## What's in the box

| Path | What it is |
|---|---|
| `web/` | the interface — `index.html`, `styles.css`, `app.js`, vanilla, no deps |
| `tools/` | `sync.py`, `build.py`, `taxonomy.py`, `gen_docs.py`, `bundle.py` |
| `data/` | generated: `index.json`, `meta.json`, `duplicates.json` |
| `dist/` | generated: the single-file HTML bundle (and, untracked, `site/`) |
| `docs/` | `PROCESS.md` (how this was built), `ARCHITECTURE.md` (data contracts), `TAGS.md` (generated) |
| `licenses/` | generated: verbatim upstream license texts, one per source |
| `sources/` | gitignored upstream clones — a cache, reproduced by `sync.py` |
| `CREDITS.md` | generated per-repo attribution, licenses and pinned commits |

## Features

**Search.** Plain words rank across name, tags, description and path. Field
operators narrow it: `tag:animation`, `origin:google`, `author:pocock`,
`grade:S`, `score:>85`, `stars:>=4`, `status:keeper`, `has:scripts`,
`lines:<80`, `lang:python`, `"exact phrase"`. They combine —
`animation origin:emilkowalski score:>80`.

**Faceted tags.** Six facets — domain, capability, stack, format, agent, trait —
derived deterministically from each skill's own text and file tree. AND across
facets, OR within one. Counts in the sidebar update against the live result set.
Full vocabulary and the rules behind it: [`docs/TAGS.md`](docs/TAGS.md).

**Ratings, two kinds.** A computed **forge score** (0–100, graded S–D) measuring
spec compliance, description quality, body substance and packaging — every weight
is written down in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) so you can argue
with it. And your own: 1–5 stars, a status (untried / in rotation / keeper /
retired) and free notes, held in `localStorage`, exportable as JSON you can commit.

**Full contents in the page.** Opening a skill renders its entire `SKILL.md` —
headings, tables, code fences — plus its score breakdown, bundled file list and
upstream credit. The text is read live from the source repository, so it is the
current version; if GitHub can't be reached, the drawer says so and links to it.

**Near-duplicate detection.** Token-overlap clustering across all repos flags the
10 clusters where skills substantially restate each other, and suggests which one
to keep.

**Compare.** Shift-click up to four cards to see them side by side with a tag
diff — the overlapping tags are solid, the missing ones ghosted.

**Install kit.** Add skills to a basket and export a single `install-kit.sh` that
sparse-checkouts each one from its own upstream repo into `~/.claude/skills`
(override with `SKILLS_DIR`). Per-skill one-liners are copyable too.

**Stats.** Counts by origin, grade and tag, plus a domain × repo coverage heatmap
that shows where the collection is thin.

Dark and light themes, responsive to phone width, keyboard-driven
(`/` search, `j`/`k` cards, `1`–`5` rate, `g s` stats, `?` help).

## Sources and licensing

Matt Pocock · Emil Kowalski · Google · Sahil Lavingia · Hugging Face · Meng To ·
Addy Osmani. Per-repo counts, pinned commits and licenses in
[`CREDITS.md`](CREDITS.md).

Every skill belongs to its author. This project changes no upstream licensing
and carries **no `SKILL.md` text**: it stores metadata — each skill's name and
description as written upstream, plus derived tags, score and size — and the
interface reads the text live from the source repository. Installing a skill
pulls from there too. Upstream licenses are reproduced in
[`licenses/`](licenses/) for attribution.

Where a repository declares no license, its source is marked
`"redistribute": false` in `sources.json` and the drawer says so. That
currently applies to `slavingia/skills` (10 skills), whose content also derives
from a published book. No license is not the same as permissive — it means all
rights reserved. If you add a source, record its license in `sources.json`.

This repository's own work — `tools/`, the taxonomy, the forge score, `web/`
and `docs/` — is MIT ([`LICENSE`](LICENSE)).

## How it was made

[`docs/PROCESS.md`](docs/PROCESS.md) is the full account: the decisions, what
they cost, what broke, and how to redo or extend any stage.
