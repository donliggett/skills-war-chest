#!/usr/bin/env python3
"""
Skills War Chest — source sync.

Clones (or fast-forwards) every repo listed in sources.json into sources/<id>.
sources/ is gitignored: it is a cache, never part of this repo's history.

    python3 tools/sync.py            # clone missing, pull existing
    python3 tools/sync.py --fresh    # delete and re-clone everything
    python3 tools/sync.py --only google mengto
"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="delete each clone before fetching")
    ap.add_argument("--only", nargs="*", help="limit to these source ids")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    SOURCES.mkdir(exist_ok=True)

    for src in cfg["sources"]:
        sid = src["id"]
        if args.only and sid not in args.only:
            continue
        dest = SOURCES / sid
        if args.fresh and dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        if dest.exists():
            r = run(["git", "pull", "--ff-only", "--depth", "1"], cwd=dest)
            status = "updated" if r.returncode == 0 else f"pull failed: {r.stderr.strip()[:80]}"
        else:
            r = run(["git", "clone", "--depth", "1", f"https://github.com/{src['repo']}.git", str(dest)])
            status = "cloned" if r.returncode == 0 else f"clone failed: {r.stderr.strip()[:80]}"
        print(f"{sid:<14} {src['repo']:<28} {status}")

    print("\nNext: python3 tools/build.py")


if __name__ == "__main__":
    sys.exit(main())
