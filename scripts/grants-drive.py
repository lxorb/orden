#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
SITE = "http://127.0.0.1:8765"

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

def until(code, seconds=15):
    for _ in range(seconds * 4):
        said = run(code)
        if said:
            return said
        time.sleep(0.25)
    return None

def ask(tab, number):
    payload = {"tab": tab, "id": number, "origin": f"{SITE}/", "kind": "camera"}
    return run(
        "window.__TAURI_INTERNALS__.invoke('plugin:event|emit', "
        f"{{ event: 'nib://web-ask', payload: {json.dumps(payload)} }}).then(() => true, (e) => String(e))"
    )

BUBBLE = "document.querySelector('.ask[role=\"dialog\"]') !== null"
STORED = "localStorage.getItem('nib:web-grants') || ''"

failures = []

normal = until("nib.workspace.activeTabId")
if not until(f"(nib.pages.addressOf({json.dumps(normal)}) || '').startsWith('{SITE}')"):
    sys.exit("::error::the normal web tab never reached the run's site")
print(f"grants: the normal tab {normal} is on {SITE}")

run("nib.workspace.openWebsite(true); true")
private = until(
    f"(() => {{ const id = nib.workspace.activeTabId; return id !== {json.dumps(normal)} && id }})()"
)
run(f"nib.pages.go({json.dumps(private)}, '{SITE}/'); true")
if not until(f"(nib.pages.addressOf({json.dumps(private)}) || '').startsWith('{SITE}')"):
    sys.exit("::error::the private tab never reached the run's site")
inprivate = run(f"nib.pages.of({json.dumps(private)}).inPrivate")
print(f"grants: a private tab {private} is on {SITE} (inPrivate: {inprivate})")
time.sleep(1)

emitted = ask(private, 900001)
if emitted is not True:
    sys.exit(f"::error::the request could not be sent as the crate sends it: {emitted!r}")
if not until(BUBBLE, 10):
    sys.exit("::error::the private tab's request brought up no bubble")
subprocess.run(["grim", str(OUT / "grants-private.png")], check=False)
run("document.querySelector('.ask[role=\"dialog\"] .rows button:last-child').click(); true")
if not until(f"!({BUBBLE})", 5):
    failures.append("Allow in the private tab's bubble did not answer it")
stored = run(STORED) or ""
print(f"grants: Allow pressed in the private tab; the store holds {stored!r}")
if "127.0.0.1" in stored:
    failures.append(f"the private tab's answer was written to the store: {stored!r}")

run(f"nib.workspace.close({json.dumps(private)}); true")
time.sleep(2)
run(f"nib.workspace.activate({json.dumps(normal)}); true")
time.sleep(1)
ask(normal, 900002)
asked = until(BUBBLE, 6)
subprocess.run(["grim", str(OUT / "grants-normal.png")], check=False)
print(f"grants: the same site asked from the normal tab; the bubble is {'up' if asked else 'not up'}")
if not asked:
    failures.append("the normal tab was answered with what the private tab said, and never asked")
else:
    run("document.querySelector('.ask[role=\"dialog\"] .rows button:first-child').click(); true")

for failure in failures:
    print(f"::error::grants: {failure}")
sys.exit(1 if failures else 0)
