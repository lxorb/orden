#!/usr/bin/env python3

import json
import sys
import time
from pathlib import Path

from drive_scheme import clicked, other
from linux_app import run

OUT, PHASE = Path(sys.argv[1]), sys.argv[2]
WORDS = "Words written just before the kill"
SAID = OUT / "kill-said.json"

def scheme():
    return run("document.documentElement.dataset.theme")

def drafts():
    return run(
        "orden.workspace.tabs.filter((tab) => (tab.doc ?? '').includes("
        + json.dumps(WORDS)
        + ")).length"
    )

if PHASE == "write":
    for _ in range(40):
        if scheme() in ("light", "dark"):
            break
        time.sleep(0.5)
    was = scheme()
    said = clicked(run, other(was))
    now = scheme()
    if now == was or now not in ("light", "dark"):
        raise SystemExit(f"::error::write: the scheme did not switch ({was} -> {now}): {said}")
    run("(orden.workspace.openBlank(), 'opened')")
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
