#!/usr/bin/env python3
"""
Skills War Chest — standalone bundler.

Inlines web/styles.css, web/app.js and the whole of data/ into a single
self-contained HTML file at dist/skills-war-chest.html. That file needs no
server, no network and no build step: double-click it, or publish it.

    python3 tools/bundle.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB, DATA, DIST = ROOT / "web", ROOT / "data", ROOT / "dist"


def js_json(obj):
    """JSON safe to sit inside a <script> element."""
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            .replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def main():
    DIST.mkdir(exist_ok=True)
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "styles.css").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")

    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    dupes = json.loads((DATA / "duplicates.json").read_text(encoding="utf-8"))

    bodies, extras = {}, {}
    for f in sorted((DATA / "skills").glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        bodies[rec["id"]] = rec.get("body", "")
        if rec.get("extra_files"):
            extras[rec["id"]] = rec["extra_files"]

    payload = {"meta": meta, "index": index, "duplicates": dupes, "bodies": bodies, "extras": extras}

    html = html.replace(
        '<!--WARCHEST_STYLE-->\n<link rel="stylesheet" href="styles.css">',
        f"<style>\n{css}\n</style>")
    html = html.replace(
        '<!--WARCHEST_SCRIPT-->\n<script src="app.js"></script>',
        f"<script>\n{js}\n</script>")
    html = html.replace(
        "<!--WARCHEST_DATA-->",
        f"<script>window.__WARCHEST__={js_json(payload)};</script>")

    for marker in ("WARCHEST_STYLE", "WARCHEST_SCRIPT", "WARCHEST_DATA"):
        if marker in html:
            raise SystemExit(f"bundle: marker {marker} was not replaced — did web/index.html change?")

    out = DIST / "skills-war-chest.html"
    out.write_text(html, encoding="utf-8")
    mb = out.stat().st_size / 1048576
    print(f"  bundled -> dist/skills-war-chest.html  ({mb:.2f} MB, {len(index)} skills, no external requests)")

    # A body-less variant: same UI, fetches nothing, ~30x smaller. Handy for
    # sharing the catalogue when the full text isn't needed.
    lite = html.replace(js_json(payload), js_json({**payload, "bodies": {}, "extras": {}}))
    (DIST / "skills-war-chest-lite.html").write_text(lite, encoding="utf-8")
    print(f"  bundled -> dist/skills-war-chest-lite.html  ({(DIST / 'skills-war-chest-lite.html').stat().st_size / 1048576:.2f} MB, index only)")
    artifact_variant()


def artifact_variant():
    """A body-only copy of the full bundle, for hosts that supply their own
    <!doctype>/<head> skeleton (the Artifact publisher). Same page, no wrapper."""
    src = (DIST / "skills-war-chest.html").read_text(encoding="utf-8")
    title = "<title>Skills War Chest</title>"
    style = src[src.index("<style>"):src.index("</style>") + 8]
    body = src[src.index("<body>") + 6:src.rindex("</body>")]
    out = DIST / "skills-war-chest-artifact.html"
    out.write_text(f"{title}\n{style}\n{body}\n", encoding="utf-8")
    print(f"  bundled -> dist/skills-war-chest-artifact.html  ({out.stat().st_size / 1048576:.2f} MB, no doctype/head)")


if __name__ == "__main__":
    main()
    artifact_variant()
