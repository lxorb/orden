#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT, APP = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "so.orden.Orden"
failures = []


def fail(what):
    print(f"::error::{what}", flush=True)
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
                return json.loads(answer.read()).get("value")
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def waited(code, what, seconds=30):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        said = run(code)
        if said:
            return said
        time.sleep(0.5)
    fail(f"gave up waiting for {what}")
    return None


def shot(name):
    subprocess.run(["grim", str(OUT / f"{name}.png")], check=False)


SHEET = "document.querySelector('.orden-screen.sheet[role=\"dialog\"]')"

KEPT = """(() => ({
  told: localStorage.getItem('orden:crash-reports-told'),
  reports: localStorage.getItem('orden:crash-reports'),
}))()"""

asked = waited(
    f"(() => {{ const s = {SHEET}; return s ? {{ words: s.innerText, ticked: s.querySelector('input.orden-checkbox')?.checked ?? null }} : null }})()",
    "the question about crash reports on the first start",
)
shot("asked")
print(f"asked: {asked}", flush=True)
if asked:
    if "crash reports" not in str(asked.get("words", "")).lower():
        fail(f"the first start's question is not about crash reports: {asked}")
    if asked.get("ticked") is not True:
        fail(f"sending crash reports is not offered ticked: {asked}")
    before = run(KEPT)
    if before != {"told": None, "reports": None}:
        fail(f"something was kept before the question was answered: {before}")

    run(
        f"(() => {{ const s = {SHEET}; const box = s.querySelector('input.orden-checkbox');"
        " if (box.checked) box.click(); s.querySelector('button[data-lands]').click(); return true })()"
    )
    waited(f"!{SHEET}", "the question to go once answered", 10)
    kept = run(KEPT)
    print(f"answered without sending: {kept}", flush=True)
    if kept != {"told": "true", "reports": "false"}:
        fail(f"the answer was not kept: {kept}")

    run("location.reload(); true")
    time.sleep(2)
    waited("document.readyState === 'complete' && !!document.querySelector('[data-pane]')", "the window loaded again", 30)
    time.sleep(5)
    again = run(f"!!{SHEET}")
    shot("again")
    if again:
        fail("the question came again once answered")
    else:
        print("loaded again: no question", flush=True)

if failures:
    sys.exit(1)
print("the first start asks about crash reports once, and keeps the answer", flush=True)
