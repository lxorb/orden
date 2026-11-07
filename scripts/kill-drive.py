#!/usr/bin/env python3

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "so.orden.Orden"
WORDS = "Words written just before the kill"
SAID = OUT / "kill-said.json"

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

def scheme():
    return run("document.documentElement.dataset.theme")

def drafts():
    return run(
        "nib.workspace.tabs.filter((tab) => (tab.doc ?? '').includes("
        + json.dumps(WORDS)
        + ")).length"
    )

if PHASE == "write":
    for _ in range(40):
        if scheme() in ("light", "dark"):
            break
        time.sleep(0.5)
    was = scheme()
    run(
        "(() => { const b = document.querySelector(\"button.act[aria-label='Light'], "
        "button.act[aria-label='Dark']\"); if (b) b.click(); return !!b })()"
    )
    time.sleep(0.5)
    now = scheme()
    if now == was or now not in ("light", "dark"):
        raise SystemExit(f"::error::write: the scheme did not switch ({was} -> {now})")
    run("(nib.workspace.openBlank(), 'opened')")
    typed = None
    for _ in range(20):
        time.sleep(0.25)
        typed = run(
            "(() => { const field = document.querySelector('.cm-content[contenteditable=true]');"
            " if (!field) return false; field.focus();"
            " return document.execCommand('insertText', false, " + json.dumps(WORDS) + ") })()"
        )
        if typed:
            break
    held = 0
    for _ in range(40):
        held = drafts()
        if held:
            break
        time.sleep(0.25)
    if not typed or not held:
        raise SystemExit(f"::error::write: the words did not go into a new note ({typed}, {held})")
    probe = run("(() => { const token = 'kept ' + Date.now(); localStorage.setItem('orden:kill-probe', token); return token })()")
    SAID.write_text(json.dumps({"scheme": now, "probe": probe}))
    print(f"write: the scheme switched {was} -> {now}, and a new note holds the words")
else:
    said = json.loads(SAID.read_text())
    failures = []
    found = None
    for _ in range(40):
        found = scheme()
        if found in ("light", "dark"):
            break
        time.sleep(0.5)
    time.sleep(2)
    found = scheme()
    if found != said["scheme"]:
        failures.append(f"the scheme switched to {said['scheme']} came back as {found}")
    held = drafts()
    if not held:
        failures.append("the words written in the new note did not come back in any tab")
    probe = run("localStorage.getItem('orden:kill-probe')")
    if probe != said.get("probe"):
        failures.append(f"the page's storage lost what it was given a tenth of a second before the kill: {probe!r}, not {said.get('probe')!r}")
    for one in failures:
        print(f"::error::read: {one}")
    if failures:
        sys.exit(1)
    print(f"read: started again after the kill, the scheme is {found} and the words are in a tab")
