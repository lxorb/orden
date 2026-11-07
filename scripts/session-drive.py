#!/usr/bin/env python3

import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devtools import Session  # noqa: E402

OUT, STEP = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
DEBUG = os.environ["ORDEN_CEF_DEBUG_PORT"]

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

def pages():
    with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG}/json/version", timeout=5) as answer:
        browser = json.loads(answer.read())["webSocketDebuggerUrl"]
    session = Session({"webSocketDebuggerUrl": browser, "url": "", "title": "browser"})
    try:
        found = session.call("Target.getTargets")["targetInfos"]
    finally:
        session.close()
    return [one for one in found if one.get("type") == "page"]

def windows():
    tree = json.loads(subprocess.check_output(["swaymsg", "-t", "get_tree"]))

    def walk(node):
        own = 1 if node.get("pid") and node.get("type") in ("con", "floating_con") else 0
        return own + sum(walk(one) for one in node.get("nodes", []) + node.get("floating_nodes", []))

    return walk(tree)

def site(found, private=False):
    return [
        one
        for one in found
        if one.get("url", "").startswith("http://127.0.0.1") and ("?private" in one["url"]) == private
    ]

def titled(said, private=False):
    found = []
    for _ in range(60):
        found = pages()
        if any(one.get("title") == said for one in site(found, private)):
            return found
        time.sleep(0.5)
    (OUT / "session-targets.json").write_text(json.dumps(found, indent=1))
    raise SystemExit(f"::error::{STEP}: no page of the site says {said!r}; see session-targets.json")

def cookies():
    found = []
    for store in (CONFIG / "chromium").rglob("Cookies"):
        with sqlite3.connect(f"file:{store}?mode=ro", uri=True) as db:
            found += [tuple(row) for row in db.execute("select name, is_persistent from cookies")]
    return found

def counted(found, wanted_pages=None, wanted_windows=None):
    seen, shown = len(found), windows()
    print(f"session: {STEP}: {seen} page targets, {shown} windows")
    if wanted_pages is not None and seen != int(wanted_pages):
        (OUT / "session-targets.json").write_text(json.dumps(found, indent=1))
        raise SystemExit(f"::error::{STEP}: {seen} page targets where the first run had {wanted_pages}")
    if wanted_windows is not None and shown != int(wanted_windows):
        raise SystemExit(f"::error::{STEP}: {shown} windows where the first run had {wanted_windows}")
    return seen, shown

if STEP == "first":
    found = titled("a session cookie made")
    seen, shown = counted(found)
    if len(site(found)) != 1:
        raise SystemExit(f"::error::first: {len(site(found))} pages of the site")
    (OUT / "session-counts").write_text(f"{seen} {shown}\n")
    normal = run("nib.workspace.activeTabId")
    run("nib.workspace.openWebsite(true); true")
    private = None
    for _ in range(40):
        private = run("nib.workspace.activeTabId")
        if private and private != normal:
            break
        time.sleep(0.5)
    address = site(found)[0]["url"].split("?")[0]
    run(f"nib.pages.go({json.dumps(private)}, {json.dumps(address + '?private')}); true")
    titled("a private cookie made", private=True)
    print("session: a private tab made its cookie")
elif STEP == "again":
    found = titled("a session cookie kept")
    counted(found, sys.argv[3], sys.argv[4])
    if site(found, private=True):
        raise SystemExit("::error::again: the private page came back")
    on_disk = cookies()
    print(f"session: on the disk: {on_disk}")
    if any(name == "hidden" for name, _ in on_disk):
        raise SystemExit("::error::again: the private tab's cookie is on the disk")
    if ("signed", 1) not in on_disk:
        raise SystemExit("::error::again: the session cookie was not written to last")
elif STEP == "killed":
    found = titled("a session cookie kept")
    counted(found, sys.argv[3], sys.argv[4])
