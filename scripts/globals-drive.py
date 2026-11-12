
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
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / os.environ.get("DRIVEN_ID", "so.orden.Orden")
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

heard = hears("orden-quick-add", "hello")
subprocess.run([APP, "--quick-add"], check=False, timeout=30, capture_output=True)
if not until(heard):
    fail("the quick add window was never heard: it is not in the app's profile")

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
