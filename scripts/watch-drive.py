#!/usr/bin/env python3
"""Changes made in a space by another program are heard though a folder in it cannot be
watched, and past the system's limit of watched folders, which the watch says. #481: on
Linux one unreadable folder, or the inotify limit, stopped file watching for every space.

Run with Orden up on its spaces folder (WATCH=1 in scripts/wayland-launch.sh). The
crate's watch of the space is asked for as the window asks for it. With `folders`: the
space holds a folder nobody may read; a note written into it by another program, at its
top and deep in it, has to be heard. With `limit`, started again under a lowered limit:
the watch has to say the limit was reached, and a note written at the top still has to
be heard. That the window tells the reader is lib/sync2/watching.test.ts's.

    python3 scripts/watch-drive.py <out folder> <folders|limit> <space folder>
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE, SPACE = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
failures = []


def fail(what):
    print(f"::error::{PHASE}: {what}")
    failures.append(what)


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


# The crate's own watch of the space, asked for here as the window asks for it (see
# lib/space-watch.ts), and every message it sends kept on the page: the window starts it
# only for a signed-in account's spaces, which a run has none of.
ARM = """(() => { window.nibHeard = []; const internals = window.__TAURI_INTERNALS__;
  const id = internals.transformCallback((raw) => { if (raw && 'message' in raw) window.nibHeard.push(raw.message) });
  return internals.invoke('space_watch', { roots: [ROOT], news: '__CHANNEL__:' + id })
    .then(() => 'armed', (error) => 'refused: ' + error) })()"""


def heard():
    return run("JSON.stringify(window.nibHeard ?? [])") or "[]"


armed = run(ARM.replace("ROOT", json.dumps(str(SPACE))))
print(f"{PHASE}: the space's watch: {armed}")
if armed != "armed":
    fail(f"the space could not be watched: {armed}")
time.sleep(3)
said = json.loads(heard())
scans = [one for one in said if one.get("scan")]
print(f"{PHASE}: as it started, the watch said {[{k: one.get(k) for k in ('scan', 'unwatched')} for one in scans]}")

places = [SPACE / "outside-top.md"]
if PHASE == "folders":
    places.append(SPACE / "deep" / "inner" / "outside-deep.md")
for at, path in enumerate(places):
    path = path.with_name(f"{path.stem}-{PHASE}.md")
    path.write_text(f"# Written by another program ({PHASE} {at})\n")
    for _ in range(40):
        if path.name in heard():
            print(f"{PHASE}: {path.relative_to(SPACE)} written outside Orden, and the watch heard it")
            break
        time.sleep(0.5)
    else:
        fail(f"{path.relative_to(SPACE)} was written outside Orden and the watch never heard it")

if PHASE == "limit" and not any(one.get("unwatched") == "limit" for one in scans):
    fail("the watch did not say the limit of watched folders was reached")
if PHASE == "folders" and any(one.get("unwatched") == "limit" for one in scans):
    fail("the watch said the limit was reached where it was not")

sys.exit(1 if failures else 0)
