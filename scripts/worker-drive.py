#!/usr/bin/env python3
"""A page in a web tab has its workers run, as it opens and after the app is started
again. #777: Anubis works its check out in workers its page starts, and in a web tab
they never ran a line - "Calculating... Speed: 0kH/s", for good.

Run with Orden up on scripts/wayland-launch.sh's page for it (WORKER=1): a page that
starts a worker the way Anubis does, from a blob, and takes the worker's answer into its
title, with the moment the page was loaded. The title has to come back with an answer,
from a page loaded after `since` (milliseconds since the epoch) where that is given.

    python3 scripts/worker-drive.py <out folder> <label> [since]
"""

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

OUT, LABEL = Path(sys.argv[1]), sys.argv[2]
SINCE = int(sys.argv[3]) if len(sys.argv) > 3 else 0
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
ANSWERED = re.compile(r"a worker answered at (\d+)")


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


seen = ""
for _ in range(60):
    seen = run("document.body.innerText") or ""
    loads = [int(at) for at in ANSWERED.findall(seen)]
    if any(at > SINCE for at in loads):
        print(f"{LABEL}: the page's worker answered, on a page loaded at {max(loads)}")
        break
    time.sleep(0.5)
else:
    waiting = "a worker waiting" in seen
    (OUT / f"worker-{LABEL}.txt").write_text(seen)
    print(
        f"::error::{LABEL}: the page's worker never answered in 30 s"
        + (" - the page is still waiting for it" if waiting else " - and the page is not in sight")
    )
    sys.exit(1)
