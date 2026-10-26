#!/usr/bin/env python3
"""Extensions can be seen and managed on Linux, where nib's own Chromium runs them.
#789: an extension could be installed there from a store's own page, but the web bar's
button, its bubble and the list in Settings were Windows' alone, so it could be neither
seen nor removed.

Run with Orden up on a web tab (EXTENSIONS=1 in scripts/wayland-launch.sh). The web
bar has to carry the extensions' button and open their bubble; Settings > General has to
list them, with the field a store link is pasted into; and the engine's own list has to
answer, and a removal has to reach the engine's management API.

    python3 scripts/extensions-drive.py <out folder>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
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


def run(code, timeout=10):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=timeout) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else said.get("error")
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def waited(code, tries=40):
    for _ in range(tries):
        found = run(code)
        if found:
            return found
        time.sleep(0.5)
    return None


button = waited("!!document.querySelector('[data-opens=\"extensions\"]')")
if not button:
    fail("the web bar has no extensions button")
else:
    run("(document.querySelector('[data-opens=\"extensions\"]').click(), 'pressed')")
    bubble = waited("document.querySelector('[role=dialog][aria-label=\"Extensions\"]')?.innerText ?? null", 10)
    if bubble is None:
        fail("the extensions button opened no bubble")
    else:
        print(f"the web bar's extensions bubble: {bubble.strip()[:120]!r}")
    subprocess.run(["grim", str(OUT / "extensions-bubble.png")], check=False)
    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")

run("(nib.settings.show('general'), 'shown')")
listed = waited(
    "(() => { const head = [...document.querySelectorAll('h3')].find((one) => one.innerText.trim() === 'Extensions');"
    " if (!head) return null; const card = head.nextElementSibling; return 'rows: ' + (card ? card.innerText : '') })()"
)
if listed is None:
    fail("Settings > General has no Extensions list")
else:
    print(f"Settings > General > Extensions: {listed.strip()[:160]!r}")
subprocess.run(["grim", str(OUT / "extensions-settings.png")], check=False)

engine = run("window.__TAURI_INTERNALS__.invoke('extensions_list').then((all) => JSON.stringify(all))", 30)
if not isinstance(engine, str) or not engine.startswith("["):
    fail(f"the engine's list did not answer: {engine!r}")
else:
    print(f"the engine's list: {engine[:160]}")

# Removing one that is not there has to reach the engine's management API and be told
# so by it - not stop short of it.
removed = run(
    "window.__TAURI_INTERNALS__.invoke('extensions_remove', { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })"
    ".then(() => 'removed', (error) => 'refused: ' + error)",
    60,
)
print(f"a removal through the engine: {removed!r}")
if not isinstance(removed, str) or "could not be reached" in removed:
    fail(f"a removal did not reach the engine: {removed!r}")

sys.exit(1 if failures else 0)
