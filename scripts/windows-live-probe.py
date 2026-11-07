from __future__ import annotations

import argparse
import importlib
import json
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

probe = importlib.import_module("sync-engine-probe")
say = probe.say
wrong = probe.wrong

CANVAS = "board.canvas"
BOARD = {"nodes": [{"id": "seed", "type": "text", "x": 0, "y": 0, "width": 200, "height": 60, "text": "seed"}], "edges": []}

BRIDGE = r"""(() => {
  const me = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? '?'
  if (window.__b8) return me
  const line = new BroadcastChannel('b8probe')
  const waits = new Map()
  const run = async (code) => await (new Function('return (async () => { ' + code + ' })()'))()
  line.onmessage = async (event) => {
    const m = event.data
    if (m.to === me && typeof m.code === 'string') {
      let value = null, error = null
      try { value = await run(m.code) } catch (x) { error = String(x) }
      line.postMessage({ answer: m.id, value: JSON.parse(JSON.stringify(value ?? null)), error })
    } else if (m.answer !== undefined) waits.get(m.answer)?.(m)
  }
  let n = 0
  window.__b8 = { me, ask: (to, code) => {
    if (to === me) return run(code)
    const id = me + ':' + (n += 1)
    return new Promise((resolve) => {
      const late = setTimeout(() => { waits.delete(id); resolve({ b8error: 'no answer from ' + to }) }, 20000)
      waits.set(id, (m) => { clearTimeout(late); waits.delete(id); resolve(m.error ? { b8error: m.error } : m.value) })
      line.postMessage({ to, id, code })
    })
  } }
  return me
})()"""


class Windows:
    def __init__(self, app) -> None:
        self.app = app
        self.labels: dict[str, str] = {}

    def at(self, who: str, code: str, seconds: float = 30) -> object:
        label = self.labels[who]
        return self.app.ask(f"window.__b8.ask({json.dumps(label)}, {json.dumps(code)})", seconds)

    def wait(self, who: str, code: str, what: str, seconds: float = 60) -> object:
        until = time.perf_counter() + seconds
        said: object = None
        while time.perf_counter() < until:
            said = self.at(who, code)
            if said and not (isinstance(said, dict) and ("error" in said or "b8error" in said)):
                return said
            time.sleep(0.3)
        wrong(f"gave up waiting for {who}: {what} (last {said!r})")
        return None


OPEN_NOTE = """const ws = window.nibApp.workspace
const space = ws.spaces.find((one) => one.name === %s)
if (ws.activeSpaceId !== space.id) await ws.selectSpace(space.id)
await ws.loadTree()
const note = ws.notes.find((one) => one.name === %s)
await ws.openEntry(note.path, { activate: true })
return ws.active?.path ?? null""" % (json.dumps(probe.SPACE), json.dumps(probe.NOTE))

OPEN_CANVAS = """const ws = window.nibApp.workspace
const space = ws.spaces.find((one) => one.name === %s)
if (ws.activeSpaceId !== space.id) await ws.selectSpace(space.id)
await ws.openCanvas(space.root + '/' + %s)
return window.nibApp.rooms.planes.size""" % (json.dumps(probe.SPACE), json.dumps(CANVAS))

TEXT = "const app = window.nibApp; const view = app.views.of(app.workspace.panes.focusedId); return view ? view.state.doc.toString() : null"


def typing(words: str) -> str:
    return (
        "const app = window.nibApp; const view = app.views.of(app.workspace.panes.focusedId)\n"
        "if (!view) return 'no editor'\n"
        "const at = view.state.doc.length\n"
        f"view.dispatch({{ changes: {{ from: at, insert: {json.dumps(words)} }}, selection: {{ anchor: at + {len(words)} }}, userEvent: 'input.type' }})\n"
        "return 'typed'"
    )


CARETS = "return document.querySelectorAll('.cm-orden-caret, .cm-nib-caret').length"

NODES = "const s = [...window.nibApp.rooms.planes.values()][0]; return s ? s.canvas.nodes.map((n) => n.id).sort().join(',') : null"


def card(id: str) -> str:
    return (
        "const s = [...window.nibApp.rooms.planes.values()][0]\n"
        f"s.edit({{ ...s.canvas, nodes: [...s.canvas.nodes, {{ id: {json.dumps(id)}, type: 'text', x: 10, y: 10, width: 200, height: 60, text: {json.dumps(id)} }}] }})\n"
        "return 'drawn'"
    )


def reaches(windows: Windows, reader: str, mark: str, read: str, what: str) -> None:
    started = time.perf_counter()
    until = started + 5
    while time.perf_counter() < until:
        said = windows.at(reader, read)
        if isinstance(said, str) and mark in said:
            say(f"{what} in {time.perf_counter() - started:.2f} s")
            return
        time.sleep(0.1)
    wrong(f"{what}: not within 5 s (last {windows.at(reader, read)!r})")


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives Windows builds")
        return 0
    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", type=pathlib.Path, required=True)
    parsed.add_argument("--log", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / "windows-live-worker.log")
    options = parsed.parse_args()

    worker = probe.Worker(options.log)
    computer = None
    try:
        worker.start()
        token, _ = worker.account()
        computer = probe.Computer("A", options.exe, token, seeded=True)
        (computer.root() / CANVAS).write_text(json.dumps(BOARD), encoding="utf-8")
        say("the app starts with a note and a canvas, signs in on sync v2")
        computer.launch()
        computer.ask(f"localStorage.setItem('orden:session', {json.dumps(token)}); location.reload(); true")
        until = time.perf_counter() + 150
        state = None
        while time.perf_counter() < until:
            time.sleep(5)
            state = computer.ask("JSON.stringify({ o: !!window.ordenApp, n: !!window.nibApp, user: !!window.nibApp?.account?.user, v: window.nibApp?.sync?.version, e: !!window.nibApp?.sync?.engine, s: window.nibApp?.sync?.status, err: window.nibApp?.sync?.lastError ?? null })")
            say(f"signing in: {state}")
            if isinstance(state, str) and '"v":2' in state and '"e":true' in state:
                break
        else:
            wrong(f"the app never ran sync v2: {state}")
            return 1
        computer.wait(
            f"!!window.nibApp.sync.remoteIdFor(window.nibApp.workspace.spaces.find((one) => one.name === {json.dumps(probe.SPACE)})?.root ?? '')",
            "the space on the account",
        )
        computer.settled()
        main_label = computer.ask(BRIDGE)
        say(f"the first window is {main_label!r}, engine {computer.ask('!!window.nibApp.sync.engine?.engine')}")
        opened = computer.ask(f"(async () => {{ {OPEN_NOTE} }})()")
        say(f"the first window opened {opened!r}")
        computer.ask("(async () => { await window.__TAURI_INTERNALS__.invoke('new_window'); return true })()")
        time.sleep(10)
        computer.ask("(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 2500) {} }, 50); return true })()")
        time.sleep(0.3)
        other_label = None
        until = time.perf_counter() + 60
        while time.perf_counter() < until:
            said = computer.ask("window.__TAURI_INTERNALS__.metadata.currentWindow.label")
            if isinstance(said, str) and said != main_label:
                other_label = said
                break
            time.sleep(1)
        if not other_label:
            wrong("the second window never answered")
            return 1
        computer.wait("!!window.nibApp?.account.user && !!window.nibApp.workspace", "the second window's account")
        computer.ask(BRIDGE)
        windows = Windows(computer)
        windows.labels = {"leader": str(main_label), "follower": other_label}
        say(f"the second window is {other_label!r}, engine {windows.at('follower', 'return !!window.nibApp.sync.engine?.engine')}, the first's engine {windows.at('leader', 'return !!window.nibApp.sync.engine?.engine')}")
        if windows.at("follower", "return !!window.nibApp.sync.engine?.engine") is not False:
            wrong("the second window holds the engine too")

        say("both windows on the note")
        windows.wait("follower", OPEN_NOTE, "the second window opening the note")
        windows.wait("follower", "return Object.values(window.nibApp.rooms.present).some((n) => n > 0) || null", "the second window seeing the first", 30)
        windows.at("leader", typing(" LEAD0"))
        windows.at("follower", typing(" FOLLOW0"))
        reaches(windows, "leader", "FOLLOW0", TEXT, "the second window's typing reached the first")
        reaches(windows, "follower", "LEAD0", TEXT, "the first window's typing reached the second")
        time.sleep(1)
        say(f"carets: first draws {windows.at('leader', CARETS)}, second draws {windows.at('follower', CARETS)}")
        if not windows.at("leader", CARETS):
            wrong("the first window draws no caret for the second")
        if not windows.at("follower", CARETS):
            wrong("the second window draws no caret for the first")
        for turn in range(1, 6):
            windows.at("leader", typing(f" L{turn}"))
            windows.at("follower", typing(f" F{turn}"))
        time.sleep(3)
        texts = [windows.at("leader", TEXT), windows.at("follower", TEXT)]
        if texts[0] != texts[1]:
            wrong(f"the windows never agreed: {texts!r}")
        for name in ("L", "F"):
            for turn in range(1, 6):
                count = str(texts[0]).count(f"{name}{turn}")
                if count != 1:
                    wrong(f"{name}{turn} is there {count} times: {texts[0]!r}")
        say(f"the note: {str(texts[0])[-80:]!r}")

        say("both windows on the canvas")
        windows.wait("leader", f"const n = await (async () => {{ {OPEN_CANVAS} }})(); return n > 0 || null", "the first window's canvas")
        windows.wait("follower", f"const n = await (async () => {{ {OPEN_CANVAS} }})(); return n > 0 || null", "the second window's canvas")
        windows.wait("follower", "const s = [...window.nibApp.rooms.planes.values()][0]; return s?.shared != null || null", "the second window's canvas going live", 30)
        windows.at("follower", card("from-follower"))
        reaches(windows, "leader", "from-follower", NODES, "the second window's card reached the first")
        windows.at("leader", card("from-leader"))
        reaches(windows, "follower", "from-leader", NODES, "the first window's card reached the second")
        windows.at("follower", "[...window.nibApp.rooms.planes.values()][0].shared.hand({ x: 33, y: 44 }, null); return true")
        windows.wait("leader", "return [...window.nibApp.rooms.planes.values()][0]?.hands.some((h) => h.at.x === 33) || null", "the second window's hand on the first", 10)
        say(f"canvases: {windows.at('leader', NODES)!r} / {windows.at('follower', NODES)!r}")
    finally:
        if computer:
            computer.quit()
        worker.stop()

    for one in probe.failures:
        print(f"::error::{one}", flush=True)
    print("RESULT " + ("FAIL" if probe.failures else "PASS"), flush=True)
    return 1 if probe.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
