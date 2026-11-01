#!/usr/bin/env python3
"""A download stopped in a web tab stops, and the next one of the same name is a file of
its own. #788: on Linux, Cancel only marked the list - the engine went on writing - and
a second download of the same name was given the same file, which the first one's end
then marked as done.

Run with Orden up on scripts/wayland-launch.sh's page for it (DOWNLOAD=1). The tab is
sent to a file that arrives slowly; once it is on its way it is stopped from the list,
and the server has to see the engine hang up, the list has to say it stopped, and no
file may be left. Then the same name again, quickly: it has to arrive whole, as a file of
its own, and be the one the list says is done.

    python3 scripts/download-drive.py <out folder> <downloads folder> <server log>
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT, FOLDER, SERVED = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
WHOLE = 65536 * 200
failures = []


def fail(what):
    print(f"::error::{what}")
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


def listed():
    return run("window.__TAURI_INTERNALS__.invoke('web_downloads')") or []


def tab():
    for _ in range(60):
        found = run(
            "[...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => one.dataset.tab)"
            ".find((id) => nib.pages.each().some(([page]) => page === id)) ?? null"
        )
        if found:
            return found
        time.sleep(0.5)
    raise SystemExit("::error::there is no web tab")


def send(to):
    run(f"window.__TAURI_INTERNALS__.invoke('web_navigate', {{ tab: {json.dumps(tab())}, url: {json.dumps(to)} }}).then(() => 'sent')")


def served():
    try:
        return SERVED.read_text()
    except OSError:
        return ""


time.sleep(2)
send("http://127.0.0.1:8765/slow")
going = None
for _ in range(60):
    going = next((one for one in listed() if one.get("state") == "going"), None)
    if going and going.get("received", 0) > 0:
        break
    time.sleep(0.5)
if not going:
    raise SystemExit("::error::the slow file never started")
print(f"on its way: {going['name']}, {going.get('received', 0)} of {going.get('total')} bytes")

run(f"window.__TAURI_INTERNALS__.invoke('web_download_cancel', {{ id: {going['id']} }}).then(() => 'stopped')")
for _ in range(40):
    if "/slow" in served():
        break
    time.sleep(0.25)
log = served()
if "/slow hung up" in log:
    print(f"stopped: {log.strip().splitlines()[-1]}")
elif "/slow sent whole" in log:
    fail("the stopped download went on: the server sent all of it")
else:
    fail("the server never heard the stopped download end")
time.sleep(2)
state = next((one["state"] for one in listed() if one["id"] == going["id"]), None)
if state != "cancelled":
    fail(f"the list says the stopped download is {state}")
left = [one.name for one in FOLDER.iterdir()] if FOLDER.exists() else []
if any(name.startswith("report") and not name.endswith(".crdownload") for name in left):
    fail(f"the stopped download left a file: {left}")

send("http://127.0.0.1:8765/fast")
done = None
for _ in range(60):
    done = next((one for one in listed() if one["id"] != going["id"] and one.get("state") == "done"), None)
    if done:
        break
    time.sleep(0.5)
if not done:
    fail("the second download of the same name never arrived")
else:
    path = FOLDER / done["name"]
    size = path.stat().st_size if path.exists() else -1
    if size != WHOLE:
        fail(f"{done['name']} is {size} bytes, not {WHOLE}")
    else:
        print(f"the next one of the same name: {done['name']}, whole, {size} bytes, and the list says it is done")
(OUT / "download.json").write_text(json.dumps({"listed": listed(), "folder": sorted(os.listdir(FOLDER)) if FOLDER.exists() else []}, indent=2))
sys.exit(1 if failures else 0)
