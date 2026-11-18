#!/usr/bin/env python3

import json
import sys
import time

from drive_scheme import other, switch
from linux_app import run
from linux_desk import DESK, OUT, failures, box, at, press, fail, colour_at, page_is

VISIBLE = "orden.pages.each().some(([, page]) => page.sent && page.sent.visible)"
WEB_TAB = (
    "(() => { const one = [...document.querySelectorAll('.tab .pick[data-tab]')]"
    ".find((tab) => orden.pages.each().some(([id]) => id === tab.dataset.tab));"
    " if (!one) return null; const r = one.getBoundingClientRect();"
    " return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)
HOLE = (
    "(() => { const all = orden.pages.each().map(([, page]) => page.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)

for _ in range(30):
    if run(VISIBLE):
        break
    tab = run(WEB_TAB)
    if isinstance(tab, dict):
        press(tab)
    time.sleep(1)
else:
    raise SystemExit(f"::error::{DESK}: no web tab's page in sight")
time.sleep(2)

seen = []
for turn in range(5):
    app = run("document.documentElement.dataset.theme")
    hole = run(HOLE)
    if not isinstance(hole, dict):
        fail(f"turn {turn}: no hole for the page", f"{turn}-hole")
        break
    x, y = at(hole)
    page = None
    for _ in range(15):
        page = page_is(colour_at(x, y))
        if page == app:
            break
        time.sleep(0.4)
    print(f"{DESK}: turn {turn}: the app is {app}, the page is drawn {page}")
    seen.append({"app": app, "page": page})
    if page != app:
        fail(f"turn {turn}: the app is {app} and the page is drawn {page}", f"{turn}-page")
    said = switch(run, box, press, other(app))
    if said != "switched":
        fail(f"turn {turn}: the app's scheme did not switch: {said}", f"{turn}-toggle")
        break

(OUT / "scheme.json").write_text(json.dumps({"seen": seen, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
