"""Every drive in this folder, one after another, with a table at the end.

Forty-odd drives were each written beside the batch that needed them, and each
knows how to serve the built app and seed a space for itself. What nobody had
was a way to run the set: this is it.

    python apps/desktop/test/e2e/run-all.py              # build once, run all
    python apps/desktop/test/e2e/run-all.py --no-build   # reuse apps/desktop/dist
    python apps/desktop/test/e2e/run-all.py --only tree  # the drives matching a word
    python apps/desktop/test/e2e/run-all.py --list       # what would run, in order

One build, at the start, into `apps/desktop/dist`, and then every drive is run
with `NIB_SKIP_BUILD=1` so the set costs one build rather than forty. Drives run
one at a time, each on the port it already picked for itself, because two drives
sharing a port is only a problem when they overlap and none of them do here.

A drive passes when it exits zero, which is what the drives that check something
already do; the ones that only print what they saw and photograph it pass as
long as they get through, which is still worth knowing - a scratch drive that
throws is an app that broke. The last column says which kind each one is.

The table at the end holds the exit status, how long it took and where it put
its screenshots. The exit status of the run is the number of drives that failed.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
APP = ROOT / "apps" / "desktop"

#: This file, and anything else that is not a drive.
NOT_A_DRIVE = {"run-all.py"}

#: How long one drive may take before it is called hung. The longest of them,
#: the one that drives two browsers through a shared canvas, takes minutes.
PATIENCE = 900

#: A drive that only prints what it saw is still a drive, but the table should
#: not claim it checked anything. A drive counts as checking something when it
#: can come back with a status other than zero of its own accord: a verdict it
#: counted up, or a walk-out over something it did not like. The one walk-out
#: that is not a verdict is the shared "gave up waiting" helper, which every
#: drive has and which says the app never got going rather than that it is
#: wrong, so it is not what makes a drive one that checks.
WAITED = "gave up waiting for"
VERDICT = re.compile(r"^\s+return 1\b", re.MULTILINE)
WALKED = re.compile(r"raise SystemExit\([\"f]", re.MULTILINE)


def drives(only: str | None) -> list[Path]:
    found = sorted(one for one in HERE.glob("*.py") if one.name not in NOT_A_DRIVE)
    if only:
        found = [one for one in found if only in one.name]
    return found


def kind_of(drive: Path) -> str:
    source = drive.read_text(encoding="utf-8")
    if VERDICT.search(source):
        return "checks"
    walkouts = [one for one in source.splitlines() if WALKED.search(one)]
    if any(WAITED not in one for one in walkouts):
        return "checks"
    return "shows"


def build() -> int:
    """One build for the whole set, in development mode: a production build hides
    the stores on `window.nibApp` that nearly every drive seeds its space through."""
    print("building the web app once for the whole set", flush=True)
    started = time.monotonic()
    done = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if done.returncode != 0:
        print("the build failed:", flush=True)
        print(done.stdout, flush=True)
        print(done.stderr, flush=True)
        return done.returncode
    print(f"built in {time.monotonic() - started:.0f}s", flush=True)
    return 0


def run(drive: Path, patience: int) -> tuple[int, float, str]:
    """One drive, with its own output passed straight through, so a run that is
    going wrong says so while it is going wrong rather than at the end."""
    started = time.monotonic()
    try:
        done = subprocess.run(
            [sys.executable, str(drive)],
            cwd=ROOT,
            env={**os.environ, "NIB_SKIP_BUILD": "1", "PYTHONIOENCODING": "utf-8"},
            timeout=patience,
            check=False,
        )
        return done.returncode, time.monotonic() - started, ""
    except subprocess.TimeoutExpired:
        return 124, time.monotonic() - started, f"gave up after {patience}s"


def shots(drive: Path, since: float) -> str:
    """Where a drive left its screenshots, if it left any: a folder under `shots`
    that it wrote to while it was running. Read off the disk rather than out of
    the source, because a drive names its folder however it likes."""
    where = HERE / "shots"
    if not where.is_dir():
        return ""
    fresh = [
        one
        for one in where.iterdir()
        if one.is_dir() and one.stat().st_mtime >= since - 1
    ]
    if not fresh:
        return ""
    return ", ".join(f"shots/{one.name}" for one in sorted(fresh, key=lambda p: p.name))


def main() -> int:
    ask = argparse.ArgumentParser(description="run every e2e drive, in order")
    ask.add_argument("--no-build", action="store_true", help="reuse apps/desktop/dist")
    ask.add_argument("--only", help="run the drives whose name holds this word")
    ask.add_argument("--list", action="store_true", help="say what would run and stop")
    ask.add_argument("--patience", type=int, default=PATIENCE, help="seconds per drive")
    said = ask.parse_args()

    found = drives(said.only)
    if not found:
        print("no drives matched", flush=True)
        return 1

    if said.list:
        for one in found:
            print(f"  {one.name:22} {kind_of(one)}", flush=True)
        return 0

    if not said.no_build and build() != 0:
        return 1
    if said.no_build and not (APP / "dist" / "index.html").exists():
        print("nothing built under apps/desktop/dist", flush=True)
        return 1

    table: list[tuple[str, int, float, str, str, str]] = []
    for at, one in enumerate(found, 1):
        print(f"=== {at}/{len(found)} {one.name} ===", flush=True)
        started = time.time()
        status, took, why = run(one, said.patience)
        table.append((one.name, status, took, kind_of(one), shots(one, started), why))

    failed = [one for one in table if one[1] != 0]

    print("", flush=True)
    print(f"{'drive':22} {'status':>8} {'time':>8}  {'kind':6} shots", flush=True)
    print("-" * 78, flush=True)
    for name, status, took, kind, where, why in table:
        mark = "pass" if status == 0 else f"FAIL {status}"
        tail = f" {why}" if why else ""
        print(f"{name:22} {mark:>8} {took:7.0f}s  {kind:6} {where}{tail}", flush=True)

    print("-" * 78, flush=True)
    print(f"{len(table) - len(failed)} of {len(table)} passed", flush=True)
    for name, status, _, _, _, why in failed:
        tail = f": {why}" if why else ""
        print(f"  FAILED {name}{tail}", flush=True)

    return len(failed)


if __name__ == "__main__":
    raise SystemExit(main())
