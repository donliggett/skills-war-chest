#!/usr/bin/env python3
"""
Skills War Chest — build pipeline.

Reads the upstream clones in sources/, and emits everything the browser needs:

    data/meta.json            build stamp, source credits, tag vocabulary + counts
    data/index.json           one lightweight record per skill (no body)
    data/skills/<id>.json     full record incl. the complete SKILL.md body
    data/duplicates.json      near-duplicate clusters across repos

Deterministic: same clones in, byte-identical JSON out (sorted keys, stable ids).

    python3 tools/build.py
    python3 tools/build.py --no-bundle     # skip the standalone HTML step
"""
import argparse, hashlib, json, math, re, subprocess, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import taxonomy  # noqa: E402

try:
    import yaml
except ImportError:
    sys.exit("pyyaml required:  pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
DATA = ROOT / "data"

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)
TRIGGER_RE = re.compile(r"\buse (this skill |it )?when\b|\buse for\b|\btrigger", re.I)
ANTITRIGGER_RE = re.compile(r"\bdon'?t use\b|\bdo not use\b|\bnot for\b|\bavoid using\b", re.I)
STOP = set("""a an the and or of to in for with on at by from as is are be this that it its use using when
how what which your you we our can will should not no do does if then than into onto over under about
skill skills claude agent agents user users file files code""".split())


# ---------------------------------------------------------------- parsing ---

def parse_skill_md(text):
    """Return (frontmatter dict, body str, parse_error str|None)."""
    m = FM_RE.match(text.lstrip("﻿"))
    if not m:
        return {}, text, "no YAML frontmatter delimiters"
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except Exception as e:
        return {}, m.group(2), f"YAML error: {e}"
    if not isinstance(fm, dict):
        return {}, m.group(2), "frontmatter is not a mapping"
    return fm, m.group(2), None


def headings_of(body):
    return [h.strip() for h in re.findall(r"^#{1,6}\s+(.+)$", body, re.M)]


def code_fences(body):
    return re.findall(r"^```(\w*)", body, re.M)


def tokens(text):
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(t) > 2 and t not in STOP}


def git_info(path):
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%H%x1f%cI"], cwd=path, capture_output=True, text=True, timeout=20
        )
        if out.returncode == 0 and out.stdout.strip():
            sha, when = out.stdout.strip().split("\x1f")
            return {"commit": sha[:12], "committed_at": when}
    except Exception:
        pass
    return {"commit": None, "committed_at": None}


# ------------------------------------------------------------- forge score ---
# 0-100, four weighted components. Every number below is explained in
# docs/ARCHITECTURE.md so the score can be argued with rather than trusted.

def forge_score(rec, fm, body, parse_error, src):
    b = {}

    # 1. Spec compliance — does it satisfy the agentskills.io specification? (30)
    spec = 0
    name = str(fm.get("name", "") or "")
    if name and NAME_RE.match(name) and len(name) <= 64:
        spec += 10
    elif name:
        spec += 4
    if name and name == rec["dir_name"]:
        spec += 6          # spec: name MUST match the parent directory
    desc = str(fm.get("description", "") or "")
    if desc and len(desc) <= 1024:
        spec += 9
    elif desc:
        spec += 3
    if not parse_error:
        spec += 5
    b["spec"] = min(30, spec)

    # 2. Description quality — the only thing an agent sees at discovery. (25)
    dq = 0
    n = len(desc)
    if 120 <= n <= 700:
        dq += 11
    elif 60 <= n < 120 or 700 < n <= 1024:
        dq += 6
    elif n:
        dq += 2
    if TRIGGER_RE.search(desc):
        dq += 9        # states WHEN to activate
    if ANTITRIGGER_RE.search(desc):
        dq += 5        # states when NOT to — rare and very valuable
    b["description"] = min(25, dq)

    # 3. Body substance — instructions worth loading, but not a novel. (25)
    bs = 0
    lines = rec["body_lines"]
    if 40 <= lines <= 500:
        bs += 12
    elif 15 <= lines < 40:
        bs += 7
    elif 500 < lines <= 900:
        bs += 8
    elif lines:
        bs += 3
    if rec["heading_count"] >= 3:
        bs += 6
    elif rec["heading_count"]:
        bs += 3
    if rec["code_blocks"] >= 2:
        bs += 7
    elif rec["code_blocks"]:
        bs += 4
    b["body"] = min(25, bs)

    # 4. Packaging — bundled resources and declared provenance. (20)
    pk = 0
    if rec["has_scripts"]:
        pk += 5
    if rec["has_references"]:
        pk += 4
    if rec["has_assets"]:
        pk += 3
    meta = fm.get("metadata") or {}
    if isinstance(meta, dict) and meta.get("version"):
        pk += 3
    if fm.get("license") or src.get("license") not in (None, "Unspecified"):
        pk += 3
    if fm.get("compatibility") or fm.get("allowed-tools"):
        pk += 2
    b["packaging"] = min(20, pk)

    return sum(b.values()), b


def grade(score):
    return ("S" if score >= 90 else "A" if score >= 78 else "B" if score >= 65
            else "C" if score >= 50 else "D")


# ------------------------------------------------------------------ build ---

def collect(src):
    """Yield every SKILL.md under a source's configured roots."""
    base = SOURCES / src["id"]
    if not base.exists():
        print(f"  ! sources/{src['id']} missing — run tools/sync.py", file=sys.stderr)
        return
    for root in src.get("roots") or ["."]:
        rdir = base / root
        if not rdir.exists():
            continue
        for path in sorted(rdir.rglob("SKILL.md")):
            if ".git" in path.parts:
                continue
            yield root, path


def build():
    cfg = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    records, by_hash, warnings = [], {}, []

    for src in cfg["sources"]:
        gi = git_info(SOURCES / src["id"])
        src["_git"] = gi
        seen_here = 0
        for root, path in collect(src):
            raw = path.read_text(encoding="utf-8", errors="replace")
            digest = hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()[:16]
            if digest in by_hash:
                by_hash[digest]["also_at"].append(f"{src['id']}/{path.parent.relative_to(SOURCES / src['id']).as_posix()}")
                continue

            fm, body, parse_error = parse_skill_md(raw)
            skill_dir = path.parent
            rel = skill_dir.relative_to(SOURCES / src["id"]).as_posix()
            scoped = skill_dir.relative_to(SOURCES / src["id"] / root).as_posix() if root != "." else rel
            dir_name = skill_dir.name
            heads = headings_of(body)
            fences = code_fences(body)

            rec = {
                "id": f"{src['id']}--{dir_name}",
                "dir_name": dir_name,
                "name": str(fm.get("name") or dir_name),
                "description": str(fm.get("description") or "").strip(),
                "origin": src["id"],
                "origin_repo": src["repo"],
                "origin_author": src["author"],
                "origin_url": src["url"],
                "origin_license": src.get("license", "Unspecified"),
                "source_path": rel,
                "github_url": f"{src['url']}/tree/HEAD/{rel}",
                "raw_url": f"https://raw.githubusercontent.com/{src['repo']}/HEAD/{rel}/SKILL.md",
                "group": scoped.split("/")[0] if "/" in scoped else "",
                "hash": digest,
                "bytes": len(raw.encode("utf-8")),
                "body_lines": body.count("\n") + 1 if body.strip() else 0,
                "words": len(body.split()),
                "heading_count": len(heads),
                "code_blocks": len(fences),
                "languages": sorted({f.lower() for f in fences if f}),
                "has_scripts": (skill_dir / "scripts").is_dir(),
                "has_references": (skill_dir / "references").is_dir(),
                "has_assets": (skill_dir / "assets").is_dir(),
                "extra_files": sorted(
                    p.relative_to(skill_dir).as_posix()
                    for p in skill_dir.rglob("*")
                    if p.is_file() and p.name != "SKILL.md" and ".git" not in p.parts
                )[:60],
                "frontmatter": {k: v for k, v in fm.items() if k != "description"},
                "parse_error": parse_error,
                "also_at": [],
                "_body": body,
            }
            rec["file_count"] = len(rec["extra_files"]) + 1

            tags, scores = taxonomy.derive_tags(rec["name"], scoped, rec["description"], heads, body)
            rec["tags"] = taxonomy.cap_by_facet(tags, scores)

            traits = []
            if rec["has_scripts"]:
                traits.append("trait:has-scripts")
            if rec["has_references"]:
                traits.append("trait:has-references")
            if rec["has_assets"]:
                traits.append("trait:has-assets")
            if rec["body_lines"] > 400:
                traits.append("trait:long-form")
            if rec["body_lines"] and rec["body_lines"] <= 80:
                traits.append("trait:quick-ref")
            if rec["code_blocks"] >= 3:
                traits.append("trait:code-heavy")
            if not parse_error and NAME_RE.match(rec["name"]) and rec["name"] == dir_name and rec["description"]:
                traits.append("trait:spec-clean")
            rec["tags"] = sorted(rec["tags"] + traits)

            score, breakdown = forge_score(rec, fm, body, parse_error, src)
            rec["score"] = score
            rec["score_breakdown"] = breakdown
            rec["grade"] = grade(score)

            if parse_error:
                warnings.append({"id": rec["id"], "issue": parse_error})
            if fm.get("name") and fm["name"] != dir_name:
                warnings.append({"id": rec["id"], "issue": f"name '{fm['name']}' != directory '{dir_name}'"})
            if not rec["description"]:
                warnings.append({"id": rec["id"], "issue": "empty description"})

            by_hash[digest] = rec
            records.append(rec)
            seen_here += 1
        print(f"  {src['id']:<14} {seen_here:>4} skills   @{gi['commit'] or '?'}")

    records.sort(key=lambda r: (r["origin"], r["name"]))

    # ---- near-duplicate clusters (token-set Jaccard on name + description) --
    sigs = {r["id"]: tokens(r["name"].replace("-", " ") + " " + r["description"]) for r in records}
    pairs = []
    for i, a in enumerate(records):
        ta = sigs[a["id"]]
        if len(ta) < 4:
            continue
        for bq in records[i + 1:]:
            tb = sigs[bq["id"]]
            if len(tb) < 4:
                continue
            inter = len(ta & tb)
            if inter < 4:
                continue
            j = inter / len(ta | tb)
            if j >= 0.42:
                pairs.append({"a": a["id"], "b": bq["id"], "similarity": round(j, 3),
                              "cross_repo": a["origin"] != bq["origin"]})
    pairs.sort(key=lambda p: -p["similarity"])

    parent = {r["id"]: r["id"] for r in records}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in pairs:
        ra, rb = find(p["a"]), find(p["b"])
        if ra != rb:
            parent[rb] = ra
    clusters = defaultdict(list)
    for r in records:
        clusters[find(r["id"])].append(r["id"])
    clusters = {k: sorted(v) for k, v in clusters.items() if len(v) > 1}
    dup_ids = {i for v in clusters.values() for i in v}
    for r in records:
        r["dup_cluster"] = find(r["id"]) if r["id"] in dup_ids else None

    # ------------------------------------------------------------- emit ----
    DATA.mkdir(exist_ok=True)
    (DATA / "skills").mkdir(exist_ok=True)
    stale = 0
    for old in (DATA / "skills").glob("*.json"):
        try:
            old.unlink()
        except OSError:
            stale += 1  # read-only mount / locked file: it will simply be overwritten
    if stale:
        print(f"  note: could not clear {stale} old json file(s); they were overwritten in place")

    index, tag_counts = [], Counter()
    for r in records:
        tag_counts.update(r["tags"])
        full = {k: v for k, v in r.items() if k != "_body"}
        full["body"] = r["_body"]
        (DATA / "skills" / f"{r['id']}.json").write_text(
            json.dumps(full, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")
        index.append({k: r[k] for k in (
            "id", "name", "description", "origin", "origin_author", "origin_repo", "origin_license",
            "source_path", "github_url", "raw_url", "group", "tags", "score", "grade",
            "score_breakdown", "body_lines", "words", "bytes", "code_blocks", "languages",
            "file_count", "has_scripts", "has_references", "has_assets", "dup_cluster", "also_at",
        )})

    vocab = {f: sorted({t for t in tag_counts if t.startswith(f + ":")}) for f in taxonomy.FACETS}
    meta = {
        "built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "generator": "tools/build.py",
        "spec": "https://agentskills.io/specification",
        "skill_count": len(records),
        "source_count": len(cfg["sources"]),
        "sources": [{
            "id": s["id"], "repo": s["repo"], "url": s["url"], "author": s["author"],
            "author_url": s["author_url"], "license": s.get("license", "Unspecified"),
            "blurb": s.get("blurb", ""), "accent": s.get("accent", "#c79a4b"),
            "commit": s["_git"]["commit"], "committed_at": s["_git"]["committed_at"],
            "count": sum(1 for r in records if r["origin"] == s["id"]),
        } for s in cfg["sources"]],
        "facets": taxonomy.FACETS,
        "facet_labels": taxonomy.FACET_LABELS,
        "tag_vocabulary": vocab,
        "tag_counts": dict(sorted(tag_counts.items())),
        "score_weights": {"spec": 30, "description": 25, "body": 25, "packaging": 20},
        "warnings": warnings,
        "stats": {
            "total_words": sum(r["words"] for r in records),
            "total_bytes": sum(r["bytes"] for r in records),
            "median_score": sorted(r["score"] for r in records)[len(records) // 2] if records else 0,
            "grades": dict(Counter(r["grade"] for r in records)),
            "with_scripts": sum(1 for r in records if r["has_scripts"]),
            "with_references": sum(1 for r in records if r["has_references"]),
            "with_assets": sum(1 for r in records if r["has_assets"]),
            "duplicate_clusters": len(clusters),
        },
    }

    (DATA / "meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    (DATA / "index.json").write_text(json.dumps(index, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")
    (DATA / "duplicates.json").write_text(json.dumps(
        {"threshold": 0.42, "clusters": clusters, "pairs": pairs[:400]},
        indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")

    print(f"\n  {len(records)} skills | {len(tag_counts)} distinct tags | "
          f"{len(clusters)} duplicate clusters | {len(warnings)} warnings")
    print(f"  median forge score {meta['stats']['median_score']} | grades {meta['stats']['grades']}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-bundle", action="store_true", help="skip the standalone HTML step")
    ap.add_argument("--no-docs", action="store_true", help="skip regenerating TAGS.md / CREDITS.md")
    a = ap.parse_args()
    print("Skills War Chest — build\n")
    build()
    if not a.no_docs:
        import gen_docs
        gen_docs.main()
    if not a.no_bundle:
        import bundle
        bundle.main()
