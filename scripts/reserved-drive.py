#!/usr/bin/env python3

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"

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
            with urllib.request.urlopen(asked, timeout=20) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None

def until(code, seconds=20):
    for _ in range(seconds * 4):
        said = run(code)
        if said:
            return said
        time.sleep(0.25)
    return None

def command(name, args):
    return run(
        f"nib.invoke({json.dumps(name)}, {json.dumps(args)})"
        ".then(() => 'done', (error) => 'refused: ' + error)"
    )

def there(path):
    return run(f"nib.invoke('path_exists', {{ path: {json.dumps(str(path))} }})") is True

def text_of(path):
    return run(f"nib.invoke('read_note', {{ path: {json.dumps(str(path))} }}).catch(() => null)")

root = until("nib.workspace.activeSpace && nib.workspace.activeSpace.root")
if not root:
    sys.exit("::error::no space is open")
folder = Path(root)
plan = folder / "Plan.md"
arrived = folder / "aux.md"
for path, words in ((plan, "# Plan\n"), (arrived, "came from elsewhere\n")):
    put = command("write_note", {"path": str(path), "content": words, "arrived": True})
    if put != "done":
        sys.exit(f"::error::the app put no {path.name} in the space: {put}")
print(f"reserved: a note and one called aux.md put in {root}")

failures = []

def refused(what, name, args, made):
    said = command(name, args) or ""
    print(f"reserved: {what}: {said}")
    if not said.startswith("refused"):
        failures.append(f"{what} was not refused: {said!r}")
    if there(made):
        failures.append(f"{what} left {made.name} in the space")

refused("renamed nul.md", "rename_note", {"from": str(plan), "to": str(folder / "nul.md")}, folder / "nul.md")
refused("renamed 'CON .md'", "rename_note", {"from": str(plan), "to": str(folder / "CON .md")}, folder / "CON .md")
refused("a folder made called COM¹", "create_folder", {"path": str(folder / "COM¹")}, folder / "COM¹")
refused("a note first written as lpt1.md", "write_note", {"path": str(folder / "lpt1.md"), "content": "x"}, folder / "lpt1.md")
refused("copied to conin$.md", "copy_path", {"from": str(plan), "to": str(folder / "conin$.md")}, folder / "conin$.md")
if not there(plan):
    failures.append("the note asked to be renamed is gone")

saved = run("nib.workspace.noteFrom('# NUL\\n\\nwords').then((path) => path)")
print(f"reserved: a note made from words headed NUL is saved as {Path(saved).name if saved else saved!r}")
if not saved or Path(saved).name.split(".")[0].strip().upper() == "NUL":
    failures.append(f"a note headed NUL was saved under the device's name: {saved!r}")

kept = command("write_note", {"path": str(arrived), "content": "still written\n"})
command("create_folder", {"path": str(folder / "Kept")})
moved = command("rename_note", {"from": str(arrived), "to": str(folder / "Kept" / "aux.md")})
reads = text_of(folder / "Kept" / "aux.md")
print(f"reserved: the note that came as aux.md: written {kept}, moved {moved}, reads {reads!r}")
if kept != "done" or moved != "done" or reads != "still written\n":
    failures.append("a note that already had such a name was not written and moved as ever")

for failure in failures:
    print(f"::error::reserved: {failure}")
sys.exit(1 if failures else 0)
