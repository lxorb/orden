#!/usr/bin/env python3
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path
import linux_app

OUT, PHASE = Path(sys.argv[1]), sys.argv[2]
SAID = OUT / "auto-tidy.json"
PORT_PAGES = 8769
SITE = f"http://127.0.0.1:{PORT_PAGES}/plain"
WORDS = "Words in a draft Auto-tidy keeps"
NOTES = {"A": "Tidy A", "B": "Tidy B", "C": "Tidy C", "D": "Tidy D"}
HOURS = "0.005"
class Pages(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<!doctype html><title>plain</title><body>a page")
class Serving(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
def run(code, timeout=15.0):
    answer = linux_app.said(code, timeout, tries=1)
    return None if answer is None else answer.get("value") if answer.get("ok") else answer.get("error")
def until(code, seconds=30.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        said = run(code)
        if said:
            return said
        time.sleep(0.25)
    return None
def fail(why):
    raise SystemExit(f"::error::{PHASE}: {why}")
TABS = (
    "orden.workspace.tabs.map((tab) => ({ id: tab.id, kind: tab.kind, path: tab.path, name: tab.shown,"
    " pane: tab.paneId, dirty: tab.dirty, draft: (tab.doc ?? '').includes(" + json.dumps(WORDS) + ") }))"
)
FRONTS = "orden.workspace.panes.all.map((pane) => pane.activeTabId)"
PANES = "orden.workspace.panes.all.length"
def tabs():
    return run(TABS) or []
def shown_paths():
    return run(f"(() => {{ const fronts = {FRONTS}; return orden.workspace.tabs.filter((tab) => fronts.includes(tab.id)).map((tab) => tab.path) }})()") or []
def described(found):
    return [f"{one['kind']} {one['name']!r}" + (f" at {Path(one['path']).name}" if one["path"] else "") for one in found]
threading.Thread(target=Serving(("127.0.0.1", PORT_PAGES), Pages).serve_forever, daemon=True).start()
if not until("1 + 1 === 2", 60):
    fail("the window never answered")
if not until("orden.workspace.restored", 60):
    fail("the workspace never came back")
if PHASE == "open":
    root = until("orden.workspace.activeSpace && orden.workspace.activeSpace.root")
    if not root:
        run("orden.workspace.addSpace('Tidy').then(() => 'added')", 30)
        root = until("orden.workspace.activeSpace && orden.workspace.activeSpace.root")
    if not root:
        fail("no space is open")
    before = tabs()
    saved_before = [one["id"] for one in before if one["path"]]
    run(f"(orden.workspace.closeEach({json.dumps(saved_before)}, false), 'closed')")
    run("(orden.workspace.openBlank(), 'opened')")
    typed = None
    for _ in range(40):
        time.sleep(0.25)
        typed = run(
            "(() => { const field = document.querySelector('.cm-content[contenteditable=true]');"
            " if (!field) return false; field.focus();"
            " return document.execCommand('insertText', false, " + json.dumps(WORDS) + ") })()"
        )
        if typed:
            break
    if not until(f"orden.workspace.tabs.some((tab) => tab.path === null && (tab.doc ?? '').includes({json.dumps(WORDS)}))", 10):
        fail(f"the words did not go into a draft ({typed})")
    run("(orden.workspace.openWebsite(), 'opened')")
    time.sleep(0.5)
    run(f"(orden.pages.go(orden.workspace.activeTabId, {json.dumps(SITE)}), 'sent')")
    terminal = run(
        "(async () => { const shells = await orden.invoke('terminal_shells').catch(() => []);"
        " const shell = Array.isArray(shells) ? shells[0] : null; if (!shell) return null;"
        " const root = orden.workspace.activeSpace.root;"
        " return orden.workspace.openUnsaved('terminal', JSON.stringify({ shell: shell.id, folder: root, key: 'auto-tidy-drive' }), shell.name).id })()",
        20,
    )
    paths = {}
    for letter in ("A", "D", "B", "C"):
        text = f"# {NOTES[letter]}\n\nsaved words\n"
        path = run(f"orden.workspace.noteFrom({json.dumps(text)}, {json.dumps(root)})", 20)
        if not path:
            fail(f"note {letter} was not saved")
        run(f"orden.workspace.open({json.dumps(path)}).then(() => 'opened')", 20)
        if not until(f"orden.workspace.active && orden.workspace.active.path === {json.dumps(path)}", 10):
            fail(f"note {letter} did not open in front")
        paths[letter] = path
        time.sleep(0.5)
    b = run(f"orden.workspace.tabs.find((tab) => tab.path === {json.dumps(paths['B'])}).id")
    run(f"(orden.workspace.split('row', {json.dumps(b)}), 'split')")
    time.sleep(1)
    panes = run(PANES)
    if panes != 2:
        fail(f"the split left {panes} panes, not 2")
    shown = shown_paths()
    if paths["B"] not in shown or paths["C"] not in shown:
        fail(f"B and C are not both shown after the split: {[Path(one).name if one else one for one in shown]}")
    if paths["A"] in shown or paths["D"] in shown:
        fail("A or D is shown after the split")
    found = tabs()
    kinds = {one["kind"] for one in found}
    if "web" not in kinds:
        fail("no web tab is open")
    if not any(one["draft"] and one["path"] is None for one in found):
        fail("no draft without a path is open")
    print(f"open: {len(found)} tabs in {panes} panes:")
    for one in described(found):
        print(f"open:   {one}")
    if not terminal:
        print("open: no terminal was started, there is no shell to start")
    run(f"(localStorage.setItem('orden:auto-tidy', 'yes'), localStorage.setItem('orden:auto-tidy-hours', {json.dumps(HOURS)}), 'set')")
    run("orden.workspace.writesSettled().then(() => 'settled')", 20)
    SAID.write_text(json.dumps({"paths": paths, "tabs": found, "panes": panes, "terminal": bool(terminal)}))
    print(f"open: Auto-tidy turned on for {float(HOURS) * 3600:.0f} s, to be read when the app starts again")
    sys.exit(0)
said = json.loads(SAID.read_text())
restarted = time.time()
paths, panes, kept_before = said["paths"], said["panes"], said["tabs"]
if run("localStorage.getItem('orden:auto-tidy')") != "yes":
    fail("Auto-tidy is not on after the restart")
def open_paths():
    return {one["path"] for one in tabs() if one["path"]}
first = open_paths()
missing = [letter for letter in NOTES if paths[letter] not in first]
if missing:
    fail(f"{', '.join(missing)} did not come back open after the restart, or closed before the timeout")
print(f"check: A, B, C and D came back open after the restart, Auto-tidy closes after {float(HOURS) * 3600:.0f} s")
TIMEOUT = float(HOURS) * 3600
FOCUS = "(window.dispatchEvent(new Event('focus')), 'focused')"
def tidied(letters, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not {paths[one] for one in letters} & open_paths():
            return True
        time.sleep(0.5)
    return False
time.sleep(max(0.0, restarted + TIMEOUT + 1 - time.time()))
run(FOCUS)
focused = time.monotonic()
gone_at = time.monotonic() - focused if tidied(("A", "D"), 8) else None
if gone_at is None:
    left = [letter for letter in ("A", "D") if paths[letter] in open_paths()]
    fail(f"{', '.join(left)} still open 8 s after a focus {TIMEOUT:.0f} s past their last look")
time.sleep(2)
print(f"check: A and D closed {gone_at:.1f} s after a focus {time.time() - restarted - gone_at:.0f} s after the restart, with {TIMEOUT:.0f} s allowed")
failures = []
found = tabs()
open_now = {one["path"] for one in found if one["path"]}
for letter in ("B", "C"):
    if paths[letter] not in open_now:
        failures.append(f"{letter}, shown in a pane, was closed")
for letter in ("A", "D"):
    if run(f"orden.invoke('path_exists', {{ path: {json.dumps(paths[letter])} }})") is not True:
        failures.append(f"{letter}'s file is gone from the disk")
shown = shown_paths()
if paths["B"] not in shown or paths["C"] not in shown:
    failures.append(f"B and C are no longer both shown: {[Path(one).name if one else one for one in shown]}")
if not any(one["draft"] and one["path"] is None for one in found):
    failures.append("the draft was closed")
if not any(one["kind"] == "web" and one["path"] is None for one in found):
    failures.append("the unsaved web tab was closed")
if said["terminal"] and not any(one["kind"] == "terminal" for one in found):
    failures.append("the terminal was closed")
closed = {paths["A"], paths["D"]}
def key(one):
    return (one["kind"], one["path"], one["draft"])
expected = sorted(str(key(one)) for one in kept_before if one["path"] not in closed)
now_keys = sorted(str(key(one)) for one in found)
if expected != now_keys:
    failures.append(f"the tabs left are not those before less A and D: {described(found)}")
now_panes = run(PANES)
if now_panes != panes:
    failures.append(f"{now_panes} panes, not the {panes} before")
print(f"check: {len(found)} tabs left in {now_panes} panes:")
for one in described(found):
    print(f"check:   {one}")
order = []
for _ in range(2):
    run("orden.workspace.reopenClosed().then(() => 'reopened')", 20)
    time.sleep(0.5)
    order.append(run("orden.workspace.active && orden.workspace.active.path"))
names = {path: letter for letter, path in paths.items()}
told = [names.get(one, one) for one in order]
print(f"check: Reopen closed tab brought back {told[0]}, then {told[1]}")
if order != [paths["D"], paths["A"]]:
    failures.append(f"Reopen closed tab brought back {told}, not D then A")
x = run("orden.workspace.activeSpaceId")
root = run("orden.workspace.activeSpace.root")
aside = {}
for letter, words in (("E", "Tidy E"), ("F", "Tidy F")):
    text = f"# {words}\n\naside words\n"
    path = run(f"orden.workspace.noteFrom({json.dumps(text)}, {json.dumps(root)})", 20)
    run(f"orden.workspace.open({json.dumps(path)}).then(() => 'opened')", 20)
    until(f"orden.workspace.active && orden.workspace.active.path === {json.dumps(path)}", 10)
    aside[letter] = path
paths.update(aside)
if aside["E"] in shown_paths():
    failures.append("E is still shown after F opened over it")
fronts = [one for one in shown_paths() if one]
run("orden.workspace.addSpace('Tidy Y').then(() => 'added')", 30)
y = until(f"(() => {{ const one = orden.workspace.spaces.find((space) => space.name === 'Tidy Y'); return one ? one.id : null }})()", 20)
if not y:
    fail("the second space was not made")
run(f"orden.workspace.selectSpace({json.dumps(y)}).then(() => 'away')", 20)
if not until(f"orden.workspace.activeSpaceId === {json.dumps(y)}", 10):
    fail("the window did not switch to the second space")
time.sleep(TIMEOUT + 2)
run(f"orden.workspace.selectSpace({json.dumps(x)}).then(() => 'back')", 20)
if not until(f"orden.workspace.activeSpaceId === {json.dumps(x)}", 10):
    fail("the window did not switch back")
back = time.monotonic()
if tidied(("E",), 6):
    print(f"check: E, aside in a space left for {TIMEOUT + 2:.0f} s, closed {time.monotonic() - back:.1f} s after switching back")
else:
    failures.append(f"E, aside in a space left for {TIMEOUT + 2:.0f} s, was still open 6 s after switching back")
kept = open_paths()
names = {path: letter for letter, path in paths.items()}
for one in fronts:
    if one not in kept:
        failures.append(f"{names.get(one, one)}, shown when the space was left and when it came back, was closed")
print(f"check: {', '.join(sorted(names.get(one, one) for one in fronts))}, shown in the space, stayed open on switching back")
for one in failures:
    print(f"::error::check: {one}")
if failures:
    sys.exit(1)
print("check: Auto-tidy closed A and D and, on switching back, E; it kept what panes show, the draft, the web tab and the terminal")
