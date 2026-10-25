#!/usr/bin/env python3
"""The DNS the web tabs' pages look names up with, chosen in Settings. #766, #767: the
pages asked the system's resolver and nothing could change that - no other DNS, no
DNS over HTTPS.

Run with Orden up on scripts/wayland-launch.sh's setup for it (DNS=1): a name only a
DNS over HTTPS server of the run's own knows (scripts/doh-server.py), and the web tab
opened on that name. With `choose`: the tab cannot reach it on the system's DNS; then
Settings > General > DNS is set to another provider, that server, by pressing and
typing; and the tab, sent to the name again, reaches it at once, the lookup having gone
through the server. With `again`, after Orden is quit and started again: the tab
reaches the name the moment it loads, the choice kept.

    python3 scripts/dns-drive.py <out folder> <choose|again> <name> <provider> <server log>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE, NAME, PROVIDER, SERVED = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], Path(sys.argv[5])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
REACHED = "reached by name"
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


def reached(within):
    for _ in range(within * 2):
        if REACHED in (run("document.body.innerText") or ""):
            return True
        time.sleep(0.5)
    return False


def looked_up():
    try:
        return NAME in SERVED.read_text()
    except OSError:
        return False


def shot(name):
    subprocess.run(["grim", str(OUT / f"dns-{name}.png")], check=False)


if PHASE == "choose":
    if reached(8):
        fail(f"{NAME} was reached on the system's DNS, which does not know it")
    else:
        print(f"choose: on the system's DNS the tab does not reach {NAME}")
    shot("before")

    run("(nib.settings.show('general'), 'shown')")
    row = None
    for _ in range(40):
        row = run("document.querySelector('[role=combobox][aria-label=\"DNS\"]')?.innerText ?? null")
        if row:
            break
        time.sleep(0.5)
    if not row:
        fail("Settings > General has no DNS row")
        sys.exit(1)
    print(f"choose: Settings > General > DNS says {row.strip()!r}")
    run("document.querySelector('[role=combobox][aria-label=\"DNS\"]').click()")
    time.sleep(0.5)
    picked = run(
        "(() => { const one = [...document.querySelectorAll('[role=option]')]"
        ".find((option) => option.innerText.trim() === 'Another provider');"
        " if (!one) return false; (one.querySelector('button') ?? one).click(); return true })()"
    )
    if not picked:
        fail("the DNS row offers no other provider")
    typed = None
    for _ in range(20):
        typed = run(
            "(() => { const field = document.querySelector('input[placeholder=\"https://dns.example/dns-query\"]');"
            " if (!field) return false; field.value = " + json.dumps(PROVIDER) + ";"
            " field.dispatchEvent(new Event('input', { bubbles: true }));"
            " field.dispatchEvent(new Event('change', { bubbles: true })); return true })()"
        )
        if typed:
            break
        time.sleep(0.5)
    if not typed:
        fail("there is no field for the provider's address")
    time.sleep(1.5)
    shot("chosen")
    kept = run("window.__TAURI_INTERNALS__.invoke('dns_chosen')")
    print(f"choose: kept {kept}")
    if not kept or kept.get("choice") != "custom" or kept.get("custom") != PROVIDER:
        fail(f"the choice kept is {kept}, not {PROVIDER}")
    run("(nib.settings.hide ? nib.settings.hide() : (nib.settings.open = false), 'closed')")
    time.sleep(1)

    # The tab sent to the name again, now: the engine was told at once.
    tab = run(
        "[...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => one.dataset.tab)"
        ".find((id) => nib.pages.each().some(([page]) => page === id)) ?? null"
    )
    run(f"window.__TAURI_INTERNALS__.invoke('web_navigate', {{ tab: {json.dumps(tab)}, url: 'http://{NAME}:8765/' }}).then(() => 'sent')")
    if reached(20):
        print(f"choose: with the provider chosen, the tab reaches {NAME} at once")
    else:
        fail(f"with the provider chosen, the tab does not reach {NAME}")
    if looked_up():
        print(f"choose: {NAME} was looked up through the provider")
    else:
        fail(f"the provider was never asked for {NAME}")
    shot("after")
else:
    if reached(25):
        print(f"again: started again, the tab reaches {NAME}, the provider kept")
    else:
        fail(f"started again, the tab does not reach {NAME}")
    if looked_up():
        print(f"again: {NAME} was looked up through the provider")
    else:
        fail(f"started again, the provider was never asked for {NAME}")
    shot("again")

sys.exit(1 if failures else 0)
