"""How fast does a tab switch show its tab and take keys? Windows and macOS.

#2290. One space holds two notes, a terminal with a long scrollback and three web tabs on
the overview drive's heavy local site. Each switch, note to note, to and from the terminal,
to and from a web tab and between web tabs, is made by a click on the tab, by Ctrl+Tab and once by Ctrl+PageDown,
three times each, while the pane is filmed. The app has no Ctrl+number for tabs.

It fails when a key typed right after a switch to a note or a terminal lands anywhere but
in the new tab, when a switch calls pages.shoot for the tab it shows or web_shot for any page,
when a tab does not arrive and, given --fail-over, when a switch's median first frame is later
than that. Every fetch in a switch is kept with its reply's size and parse time, and the table
names the reply that cost the most.

* first frame: the press to the first change on screen;
* settled: the press to the last change;
* keys: a key is sent right after the press, and the drive reads where it landed;
* long animation frames, web_* invokes and pages.shoot calls in that second.

    python scripts/tab-switch-drive.py --exe <orden> --identifier <id> --out <folder> [--rounds N] [--fail-over MS]
"""
from __future__ import annotations
import argparse
import importlib
import json
import os
import pathlib
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import App, config_of, endpoint  # noqa: E402

perf = importlib.import_module("overview-perf-drive")
MAC = sys.platform == "darwin"
WATCH = 1.2
MARK = "q"
TABS = """
const ws = orden.workspace
return ws.tabs.filter((one) => ws.panes.at(one.paneId)).map((one) => ({ id: one.id, kind: one.kind, name: one.name, active: one.id === ws.activeTabId }))
"""
LOOK = """
const ws = orden.workspace
const shown = [...document.querySelectorAll('.xterm')].find((one) => one.offsetParent !== null)
const rows = shown ? [...shown.querySelectorAll('.xterm-rows > div')].map((row) => row.textContent) : []
return {
  active: ws.activeTabId,
  notes: Object.fromEntries(ws.tabs.filter((one) => one.kind === 'note').map((one) => [one.id, (one.doc || '').split('MARK').length - 1])),
  terminal: rows.join('\\n').split('MARK').length - 1,
  focus: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className || '').split(' ')[0] : '',
}
""".replace("MARK", MARK)
PANE = """
const pane = document.querySelector(`[data-pane="${orden.workspace.panes.all[0].id}"]`) || document.querySelector('[data-pane]')
const r = pane.getBoundingClientRect()
return { x: r.x, y: r.y, w: r.width, h: r.height }
"""
IPC = """
(() => {
  const perf = window.__perf
  if (!perf || perf.__ipc) return true
  perf.__ipc = true
  perf.ipc = []
  perf.replies = []
  perf.focusAtKey = []
  const named = (url) => { const found = /(?:ipc[.:\\/]+localhost\\/)([^?#]+)/.exec(String(url)); return found ? decodeURIComponent(found[1]) : null }
  const was = window.fetch
  window.fetch = function (input, ...rest) {
    const name = named(typeof input === 'string' ? input : input && input.url)
    const start = performance.timeOrigin + performance.now()
    const said = was.call(this, input, ...rest)
    if (perf.on) {
      const reply = { name: name || String(typeof input === 'string' ? input : input && input.url).slice(0, 80), start, size: 0, read: 0, parse: 0, done: 0 }
      perf.replies.push(reply)
      Promise.resolve(said).then((res) => {
        reply.done = performance.timeOrigin + performance.now()
        if (!res || typeof res.text !== 'function') return
        res.json = function () {
          const asked = performance.now()
          return Response.prototype.text.call(this).then((text) => {
            const read = performance.now()
            const value = JSON.parse(text)
            reply.size = text.length
            reply.read = Math.round((read - asked) * 10) / 10
            reply.parse = Math.round((performance.now() - read) * 10) / 10
            return value
          })
        }
        const buffer = res.arrayBuffer
        res.arrayBuffer = function () { return buffer.call(this).then((one) => { reply.size = one.byteLength; return one }) }
      }, () => (reply.done = -1))
    }
    if (perf.on && name && name.startsWith('web_')) {
      const row = [name, start, 0]
      perf.ipc.push(row)
      Promise.resolve(said).then(() => (row[1] = start, row[2] = performance.timeOrigin + performance.now()), () => (row[2] = -1))
    }
    return said
  }
  const inner = window.__TAURI_INTERNALS__
  const post = inner && Object.getOwnPropertyDescriptor(inner, 'postMessage')
  if (post && (post.writable || post.configurable)) {
    const sent = inner.postMessage
    const wrapped = function (message, ...rest) {
      const name = message && (message.cmd || message.command)
      if (perf.on && typeof name === 'string' && name.startsWith('web_')) perf.ipc.push([name, performance.timeOrigin + performance.now(), 0])
      return sent.call(this, message, ...rest)
    }
    if (post.writable) inner.postMessage = wrapped
    else Object.defineProperty(inner, 'postMessage', { ...post, value: wrapped })
  }
  addEventListener('keydown', (event) => {
    if (!perf.on || event.key !== 'MARK') return
    const one = document.activeElement
    perf.focusAtKey.push(one ? one.tagName + '.' + String(one.className || '').split(' ')[0] : 'none')
  }, { capture: true })
  return true
})()
""".replace("MARK", MARK)
TAB_AT = """
const tab = document.querySelector(`.pick[data-tab="${ID}"]`)
if (!tab) return null
const r = tab.getBoundingClientRect()
return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
"""
def press(keys: list[str]) -> None:
    if sys.platform == "win32":
        codes = {"ctrl": 0x11, "tab": 0x09, "pagedown": 0x22, MARK: ord(MARK.upper())}
        for one in keys:
            perf.hover.u32.keybd_event(codes[one], 0, 0, 0)
            time.sleep(0.02)
        for one in reversed(keys):
            perf.hover.u32.keybd_event(codes[one], 0, 2, 0)
            time.sleep(0.02)
    elif MAC:
        import Quartz
        codes = {"tab": 48, "]": 30, MARK: 12}
        flags = {"ctrl": Quartz.kCGEventFlagMaskControl, "cmd": Quartz.kCGEventFlagMaskCommand, "shift": Quartz.kCGEventFlagMaskShift}
        held = 0
        for one in keys:
            if one in flags:
                held |= flags[one]
        last = keys[-1]
        for down in (True, False):
            made = Quartz.CGEventCreateKeyboardEvent(None, codes[last], down)
            Quartz.CGEventSetFlags(made, held)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, made)
            time.sleep(0.02)
    else:
        subprocess.run(["xdotool", "key", "+".join({"tab": "Tab", "pagedown": "Next"}.get(one, one) for one in keys)], check=False)
class Switches:
    def __init__(self, app: App, desk: Any, out: pathlib.Path) -> None:
        self.app, self.desk, self.out = app, desk, out
    def tabs(self) -> list[dict[str, Any]]:
        said = self.app.eval(TABS)
        return said if isinstance(said, list) else []
    def screen(self, x: float, y: float) -> tuple[int, int]:
        box = self.desk.box()
        scale = 1.0 if MAC else float(self.app.eval("devicePixelRatio") or 1)
        return box[0] + round(x * scale), box[1] + round(y * scale)
    def activate(self, tab: dict[str, Any]) -> None:
        self.app.eval(f"orden.workspace.activate({json.dumps(tab['id'])}); return true")
        time.sleep(1.0)
    def band(self) -> tuple[int, int, int, int]:
        pane = self.app.eval(PANE)
        left, top = self.screen(pane["x"], pane["y"])
        right, bottom = self.screen(pane["x"] + pane["w"], pane["y"] + pane["h"])
        return perf.watched_box(left, top, right - left, bottom - top)
    def aim(self, how: str, to: dict[str, Any]) -> bool:
        if how != "click":
            return True
        at = self.app.eval(TAB_AT.replace("${ID}", to["id"]))
        if not isinstance(at, dict):
            return False
        perf.point(*self.screen(at["x"], at["y"]))
        time.sleep(0.3)
        return True
    def go(self, how: str) -> None:
        if how == "click":
            perf.button(True)
            time.sleep(0.03)
            perf.button(False)
        elif how == "ctrl+pagedown":
            press(["cmd", "shift", "]"] if MAC else ["ctrl", "pagedown"])
        else:
            press(["ctrl", "tab"])
    def one(self, how: str, start: dict[str, Any], to: dict[str, Any], strip: list[dict[str, Any]]) -> dict[str, Any]:
        self.activate(start)
        self.desk.forward()
        away = self.screen(*self.rest())
        perf.point(*away)
        time.sleep(0.4)
        if not self.aim(how, to):
            return {"error": "could not find the tab"}
        before = self.app.eval(LOOK)
        band = perf.Band(self.band())
        self.app.eval("window.__perf.start(); window.__perf.ipc = []; window.__perf.replies = []; window.__perf.focusAtKey = []; return true")
        pressed = time.time() * 1000
        self.go(how)
        press([MARK])
        if how == "click":
            perf.point(*away)
        time.sleep(WATCH)
        frames = band.stop()
        extra = self.app.eval("return { ipc: window.__perf.ipc || [], focus: window.__perf.focusAtKey || [], replies: window.__perf.replies || [] }") or {}
        page = self.app.eval("return window.__perf.stop()", 60) or {}
        after = self.app.eval(LOOK)
        film = perf.filmed(frames, pressed, pressed + WATCH * 1000)
        arrived = after.get("active") != start["id"] if how != "click" else after.get("active") == to["id"]
        if how != "click":
            to = next((one for one in strip if one["id"] == after.get("active")), to)
        landed = self.landed(before, after, to)
        loaf = [one for one in page.get("loaf", []) if one["start"] >= pressed - 50]
        return {
            "first": film["first"],
            "settled": film["settled"],
            "arrived": arrived,
            "to": to["kind"],
            "landed": landed,
            "focus": after.get("focus"),
            "loaf_ms": round(sum(one["duration"] for one in loaf), 1),
            "loaf_top": sorted(loaf, key=lambda one: -one["duration"])[:3],
            "invokes": len(page.get("invokes", [])) + len(extra.get("ipc", [])),
            "web": sorted({one[0] for one in [*page.get("invokes", []), *extra.get("ipc", [])]}),
            "web_ms": round(sum(one[2] - one[1] for one in [*page.get("invokes", []), *extra.get("ipc", [])] if one[2] > 0), 1),
            "focus_at_key": extra.get("focus", []),
            "shoots": sum(1 for one in page.get("calls", []) if one[0] == "shoot"),
            "shoots_to": sum(1 for one in page.get("calls", []) if one[0] == "shoot" and len(one) > 3 and one[3] == after.get("active")),
            "pictures": sum(1 for one in [*page.get("invokes", []), *extra.get("ipc", [])] if one[0] == "web_shot"),
            "replies": sorted(([one["name"], one["size"], one["read"], one["parse"]] for one in extra.get("replies", [])), key=lambda one: -one[3]),
        }
    def rest(self) -> tuple[float, float]:
        pane = self.app.eval(PANE)
        return pane["x"] + pane["w"] * 0.6, pane["y"] + pane["h"] * 0.6
    @staticmethod
    def landed(before: dict[str, Any], after: dict[str, Any], to: dict[str, Any]) -> str:
        grew = [one for one, count in after.get("notes", {}).items() if count > before.get("notes", {}).get(one, 0)]
        typed_terminal = after.get("terminal", 0) > before.get("terminal", 0)
        if to["kind"] == "note":
            if grew == [to["id"]] and not typed_terminal:
                return "in the new tab"
            return "nowhere seen" if not grew and not typed_terminal else "outside the new tab"
        if to["kind"] == "terminal":
            if typed_terminal and not grew:
                return "in the new tab"
            return "outside the new tab" if grew else "nowhere seen"
        return "outside the new tab" if grew or typed_terminal else "not in the app, so in the page or lost"
def content(app: App, url: str) -> None:
    app.eval(
        "for (const one of document.querySelectorAll('button')) if (one.textContent.trim() === 'Keep running') one.click();"
        " for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true"
    )
    time.sleep(1)
    app.eval(perf.NOTE + "for (let i = 1; i <= 2; i++) orden.workspace.openBlank('Note ' + i, note('Note ' + i, 31 * i)); return true")
    time.sleep(1)
    shell = "powershell" if sys.platform == "win32" else os.environ.get("SHELL") or "/bin/zsh"
    app.eval(
        "const ws = orden.workspace; const root = ws.activeSpace ? ws.activeSpace.root : null;"
        f" ws.openUnsaved('terminal', JSON.stringify({{ shell: {json.dumps(shell)}, folder: root, key: 'tabs-terminal' }}), 'Terminal'); return true"
    )
    time.sleep(4)
    lines = "1..3000 | % { \"scrollback line $_\" }" if sys.platform == "win32" else "for i in $(seq 1 3000); do echo scrollback line $i; done"
    app.eval(
        "const field = [...document.querySelectorAll('.xterm-helper-textarea')].find((one) => one.closest('.xterm')?.offsetParent !== null);"
        f" field && field.dispatchEvent(new InputEvent('input', {{ data: {json.dumps(lines + chr(13))}, inputType: 'insertText', bubbles: true }})); return !!field"
    )
    time.sleep(6)
    for page in range(1, 4):
        app.eval(f"orden.workspace.openPage({json.dumps(f'{url}page/{page}')}); return true")
        time.sleep(2)
    app.until("return orden.pages.each().filter(([, page]) => page.live).length >= 3 ? true : null", 60)
    time.sleep(4)
def cases(strip: list[dict[str, Any]]) -> list[tuple[str, str, dict[str, Any], dict[str, Any]]]:
    by = lambda kind: [one for one in strip if one["kind"] == kind]
    notes, terms, webs = by("note"), by("terminal"), by("web")
    pairs = []
    if len(notes) >= 2:
        pairs.append(("note to note", notes[0], notes[1]))
    if notes and terms:
        pairs += [("note to terminal", notes[0], terms[0]), ("terminal to note", terms[0], notes[0])]
    if notes and webs:
        pairs += [("note to web", notes[0], webs[0]), ("web to note", webs[0], notes[0])]
    if len(webs) >= 2:
        pairs.append(("web to web", webs[0], webs[1]))
    if terms and webs:
        pairs += [("terminal to web", terms[0], webs[0]), ("web to terminal", webs[0], terms[0])]
    found = []
    for name, start, to in pairs:
        found.append(("click", name, start, to))
    for start in strip:
        found.append(("ctrl+tab", f"from {start['kind']} {start['name'][:12]}", start, start))
    if notes:
        found.append(("ctrl+pagedown", f"from note {notes[0]['name'][:12]}", notes[0], notes[0]))
    seen, kept = set(), []
    for how, name, start, to in found:
        if (how, start["id"], to["id"]) not in seen:
            seen.add((how, start["id"], to["id"]))
            kept.append((how, name, start, to))
    return kept
def heaviest(got: list[dict[str, Any]]) -> str:
    by: dict[str, list[list[Any]]] = {}
    for one in got:
        for reply in one.get("replies", []):
            by.setdefault(reply[0], []).append(reply)
    if not by:
        return ""
    name, replies = max(by.items(), key=lambda item: sum(one[2] + one[3] for one in item[1]))
    return f"{name.replace('|', ' ')}: {len(replies)} in {len(got)} switches, up to {round(max(one[1] for one in replies) / 1024, 1)} KB, read and parsed in {round(sum(one[2] + one[3] for one in replies) / len(got), 1)} ms a switch"
def median(values: list[Any]) -> float | None:
    got = [one for one in values if isinstance(one, (int, float))]
    return round(statistics.median(got), 1) if got else None
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", default=pathlib.Path("out-tabs"), type=pathlib.Path)
    parser.add_argument("--fail-over", type=float, help="fail when a switch's median first frame is later than this many ms")
    parser.add_argument("--rounds", type=int, default=3, help="how many times each switch is made")
    args = parser.parse_args()
    if "probe" not in args.identifier and os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    perf.calm()
    site = perf.site_of()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-tab-switch-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    desk = perf.drive.Desk(process.pid)
    rows: list[dict[str, Any]] = []
    try:
        app = endpoint(config, process.pid, secret, 30)
        desk.app = app
        if app.until("return orden.workspace ? true : null", 90) is not True:
            raise SystemExit("the app's interface never came up")
        until = time.monotonic() + 60
        while time.monotonic() < until and not desk.found():
            time.sleep(0.25)
        desk.placed()
        desk.forward()
        time.sleep(3)
        content(app, url)
        if app.eval(perf.PROBE) is not True:
            raise SystemExit("the page probe was not put in")
        app.eval(IPC)
        runner = Switches(app, desk, args.out)
        strip = runner.tabs()
        print(f"tabs: {[(one['kind'], one['name']) for one in strip]}", flush=True)
        for how, name, start, to in cases(strip):
            got = []
            for _ in range(args.rounds):
                one = runner.one(how, start, to, strip)
                if not one.get("arrived") and not one.get("focus_at_key"):
                    print(f"{how} {name}: the app saw neither the switch nor the key, so the round is made again", flush=True)
                    one = runner.one(how, start, to, strip)
                got.append(one)
            row = {
                "how": how, "switch": name if how == "click" else f"{name} to {sorted({one.get('to', '?') for one in got})}",
                "first": median([one.get("first") for one in got]),
                "firsts": [one.get("first") for one in got],
                "settled": median([one.get("settled") for one in got]),
                "arrived": sum(1 for one in got if one.get("arrived")),
                "landed": sorted({one.get("landed", one.get("error", "")) for one in got}),
                "focus": sorted({one.get("focus") or "" for one in got}),
                "loaf_ms": median([one.get("loaf_ms") for one in got]),
                "invokes": median([one.get("invokes") for one in got]),
                "web": sorted({name for one in got for name in one.get("web", [])}),
                "web_ms": median([one.get("web_ms") for one in got]),
                "focus_at_key": sorted({focus for one in got for focus in one.get("focus_at_key", []) or ["no keydown seen"]}),
                "shoots": median([one.get("shoots") for one in got]),
                "heaviest": heaviest(got),
                "rounds": got,
            }
            rows.append(row)
            print(f"{how:12} {name:28} first {row['first']} settled {row['settled']} arrived {row['arrived']}/{args.rounds} key {row['landed']} loaf {row['loaf_ms']} invokes {row['invokes']} shoots {row['shoots']}", flush=True)
    finally:
        ended(process)
        log.close()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "tabs.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    lines = [
        "| how | switch | first ms | each first ms | settled ms | arrived | key landed | focus at the key | LoAF ms | web_* calls | web_* ms | shoots | heaviest IPC reply |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(f"| {row['how']} | {row['switch']} | {row['first']} | {' '.join(str(one) for one in row['firsts'])} | {row['settled']} | {row['arrived']}/{args.rounds} | {'; '.join(row['landed'])} | {'; '.join(row['focus_at_key'])} | {row['loaf_ms']} | {row['invokes']} {' '.join(row['web'])} | {row['web_ms']} | {row['shoots']} | {row['heaviest']} |")
    table = "\n".join(lines) + "\n"
    (args.out / "table.md").write_text(table, encoding="utf-8")
    print(table, flush=True)
    wrong = []
    for row in rows:
        named = f"{row['how']} {row['switch']}"
        strayed = sorted({one.get("landed", "") for one in row["rounds"] if one.get("to") in ("note", "terminal") and one.get("landed") != "in the new tab"})
        if strayed:
            wrong.append(f"{named}: a key typed right after the switch landed {', '.join(strayed)}")
        shot = sum(one.get("shoots_to") or 0 for one in row["rounds"])
        if shot:
            wrong.append(f"{named}: the switch called pages.shoot for the tab it shows {shot} times")
        behind = sum(one.get("pictures") or 0 for one in row["rounds"])
        if behind:
            wrong.append(f"{named}: web_shot pictured a page {behind} times")
        if row["arrived"] < args.rounds:
            wrong.append(f"{named}: the tab arrived {row['arrived']} of {args.rounds} times")
        if args.fail_over is None:
            continue
        if row["first"] is None:
            print(f"::warning::{named}: no first frame was filmed, so it is not judged", flush=True)
        elif row["first"] > args.fail_over:
            wrong.append(f"{named}: median first frame {row['first']} ms, over {args.fail_over} ms")
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
