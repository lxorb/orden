#!/usr/bin/env python3
"""What a web tab hands a page on Linux: nothing, and what the app's own pages keep. The
Linux half of scripts/web-globals-probe.py, which drives `WebView2`. tauri-runtime-cef's
renderer wrote a read only, non-configurable `window.ipc` into every context, so a classic
script declaring `let ipc` was a `SyntaxError` as a whole, and Google Sheets showed "Loading
issue"; and quick add and the presenter's window were built in the profile a web extension
runs in, with the app's commands. See src-tauri/src/engine/renderer.rs and `engine::own_profile`.

Run with Orden up on a web tab (GLOBALS=1 in scripts/wayland-launch.sh), whose page and
frame in `<out>/site` report what they were given to the server's log. It has to find:

* a page and a frame from another address ran a script declaring `let ipc`, and hold
  nothing of the app's on `window`;
* the app's page holds `window.ipc`, and a command sent down it is answered, so that the
  browser's side of the runtime still hears what the app's renderer writes;
* `--quick-add` and `presenter_open` make pages the app's page can hear over a broadcast
  channel, which reaches only its own profile.

    python3 scripts/globals-drive.py <out folder> <the app's executable>
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT, APP = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
failures = []


def fail(what):
    print(f"::error::globals: {what}")
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
            with urllib.request.urlopen(asked, timeout=15) as answer:
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


def reports(seconds=30):
    """What the page and its frame said, by who said it."""
    found = {}
    for _ in range(seconds * 2):
        log = (OUT / "site.log").read_text(errors="replace") if (OUT / "site.log").exists() else ""
        for query in re.findall(r"GET /said\?(\S+)", log):
            one = dict(urllib.parse.parse_qsl(query))
            found[one.get("who")] = one
        if {"page", "frame"} <= found.keys():
            return found
        time.sleep(0.5)
    return found


said = reports()
for who in ("page", "frame"):
    one = said.get(who)
    if one is None:
        fail(f"the {who} never ran the script declaring `let ipc`")
        continue
    print(f"globals: the {who} says {one}")
    if one.get("ipc") != "undefined":
        fail(f"the {who} has window.ipc: {one.get('ipc')}")
    if one.get("internals") != "undefined":
        fail(f"the {who} has the app's internals")
    if one.get("declared") != "1":
        fail(f"the {who}'s own `ipc` is {one.get('declared')}")

kept = until("JSON.stringify(Object.getOwnPropertyDescriptor(window, 'ipc') ? { kind: typeof window.ipc } : { kind: 'none' })")
print(f"globals: the app's page holds {kept}")
if kept != '{"kind":"object"}':
    fail(f"the app's page lost window.ipc: {kept}")


def hears(channel, kind):
    """Starts the app's page listening; what it answers says whether that message came."""
    name = re.sub(r"\W", "_", channel)
    run(
        f"""(() => {{
  window.__{name} = false
  const channel = new BroadcastChannel({json.dumps(channel)})
  channel.onmessage = (event) => {{ if (event.data && event.data.kind === {json.dumps(kind)}) window.__{name} = true }}
  window.__{name}_channel = channel
  return true
}})()"""
    )
    return f"window.__{name}"


heard = hears("nib:presenter", "here")
opened = run("window.__TAURI_INTERNALS__.invoke('presenter_open', {}).then(() => 'opened', (error) => String(error))")
print(f"globals: the presenter's window: {opened}")
if opened != "opened":
    fail(f"the presenter's window was not opened: {opened}")
elif not until(heard):
    fail("the presenter's window was never heard: it is not in the app's profile")

heard = hears("nib-quick-add", "hello")
subprocess.run([APP, "--quick-add"], check=False, timeout=30, capture_output=True)
if not until(heard):
    fail("the quick add window was never heard: it is not in the app's profile")

# Down the channel itself: the page's custom protocol refused, as it may be, so
# `ipc-protocol.js` falls back on `window.ipc.postMessage` from then on, for this page. Last
# of all because of that.
answered = run(
    """new Promise((settle) => {
  const internals = window.__TAURI_INTERNALS__
  window.fetch = () => Promise.reject(new Error('refused by the drive'))
  internals.invoke('pdf_supported').then(
    () => settle('answered'),
    (error) => settle('refused: ' + error),
  )
  setTimeout(() => settle('no answer'), 8000)
})"""
)
print(f"globals: a command down window.ipc: {answered}")
if answered != "answered":
    fail(f"a command down window.ipc came back {answered}")

if failures:
    sys.exit(1)
print("globals: nothing on a page, and the app's own pages hear each other")
