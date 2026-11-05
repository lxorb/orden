#!/usr/bin/env python3
"""A real extension, on Linux where Orden's own Chromium runs it: seen in the web bar and in
Settings, and removed from them both and from the engine. #789: an extension could be
installed there and then neither seen nor removed, the bar's button, its bubble and the
list in Settings being Windows' alone.

Run with Orden up on a web tab (EXTENSIONS=1 in scripts/wayland-launch.sh), started with
the run's own small extension loaded (`--load-extension`, through `NIB_CEF_ARGS`). With
`installed`: the engine's list has to hold it, the web bar's bubble and Settings > General
have to name it, and `extensions_remove` has to take it away - out of the engine's list
and out of Settings. With `again`, after the app is started again without it: the list
has to stay empty.

    python3 scripts/extensions-drive.py <out folder> <installed|again> <name>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE, NAME = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
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


def listed():
    said = run("window.__TAURI_INTERNALS__.invoke('extensions_list').then((all) => JSON.stringify(all))", 40)
    try:
        return json.loads(said)
    except (TypeError, ValueError):
        return None


def ours(all_of):
    return [one for one in all_of or [] if one.get("name") == NAME]


def settings_rows():
    run("(nib.settings.show('general'), 'shown')")
    for _ in range(40):
        said = run(
            "(() => { const head = [...document.querySelectorAll('h3')].find((one) => one.innerText.trim() === 'Extensions');"
            " if (!head) return null; const card = head.nextElementSibling; return 'rows: ' + (card ? card.innerText : '') })()"
        )
        if said:
            return said
        time.sleep(0.5)
    return None


def closed():
    run("(nib.settings.hide ? nib.settings.hide() : (nib.settings.open = false), 'closed')")
    time.sleep(0.5)


def answering(seconds, what):
    """The app asked something small over and over for `seconds`: the longest it took to
    answer, or None where it did not answer within a few seconds at all."""
    worst, until = 0.0, time.monotonic() + seconds
    while time.monotonic() < until:
        began = time.monotonic()
        said = quick("'here'")
        took = time.monotonic() - began
        if said != "here":
            fail(f"{what}: the app stopped answering ({took:.1f} s, {said!r})")
            return None
        worst = max(worst, took)
        time.sleep(0.2)
    return worst


def quick(code):
    """One question, given three seconds and no second try: a frozen app is an answer."""
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(asked, timeout=3) as answer:
            said = json.loads(answer.read())
        return said.get("value") if said.get("ok") else said.get("error")
    except (TimeoutError, OSError) as error:
        return f"no answer: {error}"


BUTTON = f"document.querySelector('button.extension[aria-label={json.dumps(NAME)}]')"
BUBBLE = "(() => { const box = document.querySelector('.popup.nib-bubble')?.getBoundingClientRect(); return box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null })()"


def pressed():
    """#1035: the extension's own button pressed opens its popup, and the app answers all
    the while - pressed once, and then again and again, as a hand does that thinks nothing
    happened."""
    for _ in range(40):
        if run(f"!!{BUTTON}"):
            break
        time.sleep(0.5)
    if not run(f"!!{BUTTON}"):
        fail("no button of its own in the web bar")
        return
    quick(f"({BUTTON}.click(), 'pressed')")
    worst = answering(8, "its popup opening")
    sized = quick(BUBBLE)
    if not sized or sized.startswith("no answer"):
        fail(f"no popup over the bar after its button was pressed: {sized!r}")
    subprocess.run(["grim", str(OUT / "extension-popup.png")], check=False)
    print(f"installed: its button pressed, the app answered within {worst} s; popup {sized}")
    # Pressed again and again: each press closes the popup open and opens it anew.
    for _ in range(6):
        quick(f"({BUTTON}.click(), 'pressed')")
        time.sleep(0.15)
    worst = answering(8, "its button pressed again and again")
    print(f"installed: pressed six times more, the app answered within {worst} s")
    if worst is not None and worst > 2:
        fail(f"the app took {worst:.1f} s to answer while the popup opened")
    quick("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")
    time.sleep(0.5)


if PHASE == "installed":
    found = []
    for _ in range(60):
        found = ours(listed())
        if found:
            break
        time.sleep(1)
    if not found:
        raise SystemExit(f"::error::installed: the engine never listed {NAME}: {listed()}")
    one = found[0]
    print(f"installed: the engine lists {NAME} as {one.get('id')}")

    for _ in range(40):
        if run("!!document.querySelector('[data-opens=\"extensions\"]')"):
            break
        time.sleep(0.5)
    run("(document.querySelector('[data-opens=\"extensions\"]')?.click(), 'pressed')")
    bubble = None
    for _ in range(20):
        bubble = run("document.querySelector('[role=dialog][aria-label=\"Extensions\"]')?.innerText ?? null")
        if bubble and NAME in bubble:
            break
        time.sleep(0.5)
    subprocess.run(["grim", str(OUT / "extensions-bubble.png")], check=False)
    if not bubble or NAME not in bubble:
        fail(f"the web bar's bubble does not name it: {bubble!r}")
    else:
        print(f"installed: the web bar's bubble names it: {bubble.strip()[:120]!r}")
    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")
    pressed()

    rows = settings_rows()
    subprocess.run(["grim", str(OUT / "extensions-settings.png")], check=False)
    if not rows or NAME not in rows:
        fail(f"Settings > General > Extensions does not name it: {rows!r}")
    else:
        print(f"installed: Settings > General > Extensions names it: {rows.strip()[:120]!r}")
    closed()

    removed = run(
        f"window.__TAURI_INTERNALS__.invoke('extensions_remove', {{ id: {json.dumps(one['id'])} }})"
        ".then(() => 'removed', (error) => 'refused: ' + error)",
        60,
    )
    print(f"installed: removed through the engine: {removed!r}")
    if removed != "removed":
        fail(f"the engine did not remove it: {removed!r}")
    left = None
    for _ in range(20):
        left = listed()
        if left is not None and not ours(left):
            break
        time.sleep(0.5)
    if ours(left):
        fail(f"the engine still lists it after it was removed: {left}")
    else:
        print(f"installed: the engine's list after the removal: {left}")
    rows = settings_rows()
    if rows and NAME in rows:
        fail(f"Settings still names it after it was removed: {rows!r}")
    else:
        print(f"installed: Settings after the removal: {(rows or '').strip()[:120]!r}")
    closed()
else:
    time.sleep(5)
    left = listed()
    if left is None or ours(left):
        fail(f"started again, the engine lists {left}")
    else:
        print(f"again: started again without it, the engine's list is {left}")

sys.exit(1 if failures else 0)
