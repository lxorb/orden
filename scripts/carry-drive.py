#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from carry_page import NOTE, PANE, TITLES, WORDS, field_of, heard, into_field, put_note, row_box, wrong_drop, zone_of  # noqa: E402

OUT, APP = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "so.orden.Orden"
CARRIED = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "so.orden.Orden" / "carried"
POINTER = OUT / "pointer.fifo"
URL = "http://127.0.0.1:8765/carry.html"

def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")

PORT, SECRET = endpoint()

def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=10) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None

def until(code, seconds=30):
    for _ in range(seconds * 4):
        said = run(code)
        if said:
            return said
        time.sleep(0.25)
    return None

def window():
    def walk(node):
        if str(node.get("pid")) == APP:
            yield node
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child)

    tree = json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_tree"]))
    found = sorted(walk(tree), key=lambda n: n["rect"]["width"] * n["rect"]["height"])
    rect = found[-1]["rect"]
    return rect["x"], rect["y"]

def tell(*lines):
    with open(POINTER, "w") as pointer:
        pointer.write("".join(line + "\n" for line in lines))

def screen(css):
    x, y = window()
    scale = run("devicePixelRatio") or 1
    return x + css[0] * scale, y + css[1] * scale

def dragged(start, end):
    a, b = screen(start), screen(end)
    tell(f"move {a[0]} {a[1]}")
    time.sleep(0.3)
    tell("press")
    time.sleep(0.3)
    steps = 24
    for step in range(1, steps + 1):
        tell(f"move {a[0] + (b[0] - a[0]) * step / steps} {a[1] + (b[1] - a[1]) * step / steps}")
        time.sleep(0.05)
    time.sleep(0.8)
    tell("release")
    time.sleep(1.5)

def middle(box):
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

def shoot(name):
    subprocess.run(["grim", str(OUT / f"carry-{name}.png")], check=False)

failures = []

def fail(what):
    print(f"::error::{what}", flush=True)
    failures.append(what)

subprocess.run(["swaymsg", f"[pid={APP}] move container to output HEADLESS-2, focus"], check=False)
time.sleep(2)

root = until("nib.workspace.activeSpace && nib.workspace.activeSpace.root")
if not root:
    sys.exit("::error::no space is open")
note = put_note(run, root)
if not isinstance(note, str):
    sys.exit(f"::error::the app put no note in the space: {note}")
if not until(f"void nib.workspace.loadTree(), !!nib.workspace.entryAt({json.dumps(note)})"):
    sys.exit("::error::the file list never showed the note put in the space")

run(f"nib.workspace.openPage({json.dumps(URL)}); true")
if not until(f"({TITLES}) !== ''", 40):
    sys.exit("::error::the page never loaded")
time.sleep(2)
pane = until(PANE)
row = until(row_box(note))
if not isinstance(pane, dict) or not isinstance(row, dict):
    sys.exit(f"::error::no page or no row to drag: page {pane}, row {row}")
print(f"carry: the row at {row}, the page at {pane}", flush=True)
shoot("before")

dragged(middle(row), zone_of(pane))
said = heard(until(TITLES, 10))
shoot("dropped")
print(f"carry: the page heard {said}", flush=True)
for one in wrong_drop(said):
    fail(one)
if said.get("trusted") is not True:
    fail(f"the page's drop was not the engine's own: {said.get('trusted')}")
kept = sorted(CARRIED.glob("*/*")) if CARRIED.is_dir() else []
print(f"carry: carried files kept for the page: {[str(one) for one in kept]}", flush=True)
if not any(one.name == NOTE for one in kept):
    fail(f"no carried copy of the note is kept for the page to read in {CARRIED}")

dragged(middle(row), field_of(pane))
said = heard(until(TITLES, 10))
shoot("field")
print(f"carry: a field that takes words only got {into_field(said)}", flush=True)
if WORDS.strip() not in str(said.get("field") or ""):
    print("::warning::a field with no drop of its own was not given the note's words", flush=True)

before = sorted(CARRIED.glob("*")) if CARRIED.is_dir() else []
dragged(middle(row), (row["x"] + row["width"] * 0.8, row["y"] + row["height"] / 2))
after = sorted(CARRIED.glob("*")) if CARRIED.is_dir() else []
print(f"carry: carried folders before a drag let go of on the list {len(before)}, after {len(after)}", flush=True)
if len(after) > len(before):
    fail("a drag no page took left its carried files behind")

(OUT / "carry.json").write_text(json.dumps({"failures": failures}, indent=1))
sys.exit(1 if failures else 0)
