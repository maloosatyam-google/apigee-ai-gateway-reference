#!/usr/bin/env python3
"""Render deployment placeholders in a proxy bundle or template directory.

Proxy bundles in this repo never contain project IDs, hostnames or resource IDs.
Instead they carry placeholders such as ``__GCP_PROJECT_ID__``. This script copies a
source tree to a destination and replaces every ``__NAME__`` with the value of the
environment variable ``NAME`` (see scripts/lib/config.sh and .env.example).

It fails if a placeholder has no value, so a half-configured environment can never
deploy a bundle that points at somebody else's project.

    render_tokens.py <src_dir> <dst_dir>
    render_tokens.py --check <dir>      # list the placeholders a tree needs
"""
import os
import re
import shutil
import sys

TOKEN = re.compile(r"__([A-Z][A-Z0-9_]*[A-Z0-9])__")
TEXT_EXT = {".xml", ".js", ".json", ".yaml", ".yml", ".properties", ".tmpl", ".py", ".txt"}


def _is_text(path):
    return os.path.splitext(path)[1].lower() in TEXT_EXT


def tokens_in(root):
    found = {}
    for dirpath, _, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            if not _is_text(p):
                continue
            with open(p, encoding="utf-8") as fh:
                for name in TOKEN.findall(fh.read()):
                    found.setdefault(name, set()).add(os.path.relpath(p, root))
    return found


def render(src, dst):
    needed = tokens_in(src)
    missing = sorted(n for n in needed if not os.environ.get(n))
    if missing:
        for n in missing:
            print(f"render_tokens: no value for __{n}__ (used in {', '.join(sorted(needed[n]))})", file=sys.stderr)
        print("Set these in .env (see .env.example).", file=sys.stderr)
        sys.exit(1)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".DS_Store"))
    for dirpath, _, files in os.walk(dst):
        for f in files:
            p = os.path.join(dirpath, f)
            if not _is_text(p):
                continue
            with open(p, encoding="utf-8") as fh:
                text = fh.read()
            new = TOKEN.sub(lambda m: os.environ[m.group(1)], text)
            if new != text:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        for name, files in sorted(tokens_in(sys.argv[2]).items()):
            print(f"{name}: {', '.join(sorted(files))}")
    elif len(sys.argv) == 3:
        render(sys.argv[1], sys.argv[2])
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
