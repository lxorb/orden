#!/usr/bin/env python3
import re
import sys
import time
from pathlib import Path
from linux_app import run

OUT, LABEL = Path(sys.argv[1]), sys.argv[2]
SINCE = int(sys.argv[3]) if len(sys.argv) > 3 else 0
ANSWERED = re.compile(r"a worker answered at (\d+)")
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
