#!/usr/bin/env python3

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE, SPACE = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / os.environ.get("DRIVEN_ID", "so.orden.Orden")
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

ARM = """(() => { window.nibHeard = []; const internals = window.__TAURI_INTERNALS__;
  const id = internals.transformCallback((raw) => { if (raw && 'message' in raw) window.nibHeard.push(raw.message) });
  return internals.invoke('working_watch', { root: ROOT, news: '__CHANNEL__:' + id })
    .then(() => 'armed', (error) => 'refused: ' + error) })()"""

def heard():
    return run("JSON.stringify(window.nibHeard ?? [])") or "[]"

for _ in range(120):
    if run("performance.getEntriesByName('orden: launch order finished').length > 0"):
        break
    time.sleep(0.5)
else:
    fail("the launch never finished")
if PHASE == "where":
    root = None
    for _ in range(80):
        root = run("nib.workspace.activeSpace && orden.workspace.activeSpace.root")
        if root:
            break
        time.sleep(0.25)
    working = run(f"nib.working({json.dumps(root)})") if root else None
    print(f"where: the space {root!r} works in {working!r}", file=sys.stderr)
    print(working or "")
    sys.exit(0 if working else 1)
settled = None
for _ in range(80):
    settled = run("nib.workspace.activeSpace ? orden.working(orden.workspace.activeSpace.root) : null")
    if settled:
        break
    time.sleep(0.25)
print(f"{PHASE}: the app keeps its working folder at {settled!r}, so its own watch is armed before this one")
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
