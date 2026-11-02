#!/usr/bin/env python3
"""A sign-in that lives in a session cookie lasts across a restart. #483: Moodle's and
Shibboleth's were gone at every launch on Linux, where CEF drops session cookies unless
it is told to keep them (`persist_session_cookies` in `cef_runtime`, engine.rs).

Run with Orden up on scripts/wayland-launch.sh's page for it (SESSION=1): a page that
makes a cookie with no expiry the first time and says in its title, which the tab strip
shows, whether it found one. `said` is the title the run has to see.

    python3 scripts/session-drive.py <out folder> <said>
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT, SAID = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"


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
    if SAID in seen:
        print(f"the tab says: {SAID}")
        break
    time.sleep(0.5)
else:
    (OUT / "session.txt").write_text(seen)
    print(f"::error::the tab never said {SAID!r} in 30 s; see session.txt")
    sys.exit(1)
