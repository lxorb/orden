from __future__ import annotations

import json
import time

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
EMAIL = "tree-live@example.com"
SPACE = "Live"
ROOT = f"/{SPACE}"
NOTES = [f"Note {index:02d}.md" for index in range(1, 61)]

wrong: list[str] = []

def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)

class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)

def wait_for(page: Page, script: str, what: str, arg: object = None, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")

LISTED = """(path) => {
  const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : [])
  return walk(window.nibApp.workspace.tree).includes(path)
}"""

ROW = """(path) => document.querySelector(`.row[data-path="${CSS.escape(path)}"]`)"""

BOX = """() => {
  let at = document.querySelector('[role=tree]')
  while (at && !(at.scrollHeight > at.clientHeight && /auto|scroll/.test(getComputedStyle(at).overflowY))) at = at.parentElement
  return at
}"""

WATCH = (
    """(paths) => {
  const row = """
    + ROW
    + """
  const box = ("""
    + BOX
    + """)()
  const held = paths.map((path) => row(path))
  window.__frames = []
  const loop = () => {
    window.__frames.push({
      t: performance.now(),
      scroll: box.scrollTop,
      rows: held.map((one) => one && one.isConnected ? { path: one.dataset.path, top: one.getBoundingClientRect().top } : null),
      moving: document.getAnimations().filter((one) => one.effect?.target?.closest?.('[role=tree]')).length,
    })
    if (window.__frames.length < 3000) window.__raf = requestAnimationFrame(loop)
  }
  window.__raf = requestAnimationFrame(loop)
  return held.every(Boolean)
}"""
)

FRAMES = "() => { cancelAnimationFrame(window.__raf); return window.__frames }"

def window_for(context, label: str, paths: list[str] | None = None) -> Page:
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp?.account.user", f"[{label}] the account")
    wait_for(
        page,
        "(name) => window.nibApp.workspace.spaces.some((one) => one.name === name)",
        f"[{label}] the space",
        SPACE,
    )
    page.evaluate(
        "(name) => { const ws = window.nibApp.workspace;"
        " ws.showSpace(ws.spaces.find((one) => one.name === name).id) }",
        SPACE,
    )
    wait_for(
        page,
        """(paths) => {
          const ws = window.nibApp.workspace
          return window.nibApp.arriving.coming.size === 0 && paths.every((one) => ws.entryAt(one))
        }""",
        f"[{label}] every note listed",
        paths or [f"{ROOT}/{name}" for name in NOTES],
    )
    wait_for(page, "() => !!window.nibApp.sync.engine?.engine", f"[{label}] the engine")
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    wait_for(page, "() => !!document.querySelector('[role=tree] .row')", f"[{label}] the file list")
    return page

def scroll_to(page: Page, path: str) -> None:
    page.evaluate(
        f"""async (path) => {{
          const box = ({BOX})()
          const row = {ROW}
          const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
          for (let step = 0; step < 200 && !row(path); step++) {{
            box.scrollTop += box.clientHeight / 2
            await frame()
          }}
          const one = row(path)
          box.scrollTop += one.getBoundingClientRect().top - box.getBoundingClientRect().top
          await frame()
          await frame()
        }}""",
        path,
    )
    page.wait_for_timeout(300)

def state(page: Page) -> dict:
    return page.evaluate(
        """() => ({
          picked: window.nibApp.workspace.selection,
          focused: document.activeElement?.dataset?.path ?? null,
          open: window.nibApp.workspace.active?.path ?? null,
        })"""
    )

def heard(a: Page, path: str, what: str, started: float) -> float:
    wait_for(a, LISTED, what, path)
    took = time.monotonic() - started
    a.wait_for_timeout(500)
    return took

def jumps(frames: list[dict], index: int, height: float) -> list[str]:
    out = []
    last = None
    for frame in frames:
        one = frame["rows"][index]
        if one is None:
            last = None
            continue
        if last is not None and abs(one["top"] - last) >= height * 0.75:
            out.append(f"{one['path']} jumped {one['top'] - last:+.1f}px in one frame")
        last = one["top"]
    return out

def tops(frames: list[dict], index: int) -> list[float]:
    return [frame["rows"][index]["top"] for frame in frames if frame["rows"][index] is not None]

def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        for name in [*NOTES, "Archive/Old.md"]:
            worker.request(
                f"/v1/spaces/{space['id']}/notes",
                token=token,
                body={"path": name, "content": f"# {name}\n"},
            )

        def device(motion: str = "no-preference"):
            context = browser.new_context(viewport={"width": 1100, "height": 560}, reduced_motion=motion)
            context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
            return context

        a = window_for(device(), "A")
        b = window_for(device(), "B")
        a.bring_to_front()

        scroll_to(a, f"{ROOT}/Note 30.md")
        reading = f"{ROOT}/Note 35.md"
        a.evaluate("(p) => window.nibApp.workspace.select(p)", reading)
        a.locator(f'.row[data-path="{reading}"]').focus()
        height = a.evaluate(f"() => ({ROW})({json.dumps(reading)}).getBoundingClientRect().height")
        before = state(a)
        say(f"A reads Note 35, scrolled to Note 30; rows are {height}px: {before}")
        if before["picked"] != [reading] or before["focused"] != reading:
            failed(f"A did not start on Note 35: {before}")

        watched = [reading, f"{ROOT}/Note 31.md", f"{ROOT}/Note 38.md"]
        if not a.evaluate(WATCH, watched):
            failed("the rows to watch are not drawn")
        started = time.monotonic()
        b.evaluate("(p) => window.nibApp.workspace.rename(p, 'Zed 05.md')", f"{ROOT}/Note 05.md")
        took = heard(a, f"{ROOT}/Zed 05.md", "[A] Note 05 renamed in B", started)
        frames = a.evaluate(FRAMES)
        say(f"a rename above the view reached A in {took:.1f}s")
        held = tops(frames, 0)
        if not held or max(held) - min(held) > 1:
            failed(f"Note 35 moved on A's screen when a row above the view left: {min(held, default=0)}..{max(held, default=0)}")
        now = state(a)
        if now != before:
            failed(f"a rename elsewhere changed what A had: {before} -> {now}")

        if not a.evaluate(WATCH, watched):
            failed("the rows to watch are not drawn")
        started = time.monotonic()
        b.evaluate(
            "(p) => window.nibApp.workspace.move(p, p.slice(0, p.lastIndexOf('/')) + '/Archive')",
            f"{ROOT}/Note 33.md",
        )
        took = heard(a, f"{ROOT}/Archive/Note 33.md", "[A] Note 33 moved in B", started)
        frames = a.evaluate(FRAMES)
        say(f"a move out of the view reached A in {took:.1f}s")
        held = tops(frames, 0)
        for one in jumps(frames, 0, height) + jumps(frames, 2, height):
            failed(one)
        if held and abs((held[0] - held[-1]) - height) > 1:
            failed(f"Note 35 did not end one row up: {held[0]} -> {held[-1]}")
        if not [top for top in held if held[-1] + 1 < top < held[0] - 1]:
            failed("Note 35 did not slide: no frame between where it was and where it went")
        if max(frame["moving"] for frame in frames) == 0:
            failed("nothing in the list animated for a move out of the view")
        steady = tops(frames, 1)
        if steady and max(steady) - min(steady) > 1:
            failed(f"Note 31, above the move, moved: {min(steady)}..{max(steady)}")
        now = state(a)
        if now != before:
            failed(f"a move elsewhere changed what A had: {before} -> {now}")

        renamed = f"{ROOT}/Note 35b.md"
        if not a.evaluate(WATCH, watched):
            failed("the rows to watch are not drawn")
        started = time.monotonic()
        b.evaluate("(p) => window.nibApp.workspace.rename(p, 'Note 35b.md')", reading)
        took = heard(a, renamed, "[A] the note A reads renamed in B", started)
        frames = a.evaluate(FRAMES)
        say(f"a rename of the note A reads reached A in {took:.1f}s")
        now = state(a)
        if now != {"picked": [renamed], "focused": renamed, "open": before["open"]}:
            failed(f"the row A reads, renamed in B, lost what A had on it: {now}")
        if frames[-1]["rows"][0] is None or frames[-1]["rows"][0]["path"] != renamed:
            failed("the row A reads was drawn again as another element")
        for one in jumps(frames, 0, height):
            failed(one)

        for page in (a, b):
            page.evaluate("() => window.nibApp.workspace.setSort('manual')")
        wait_for(b, "() => !!window.nibApp.sync.engine?.engine?.core", "[B] the engine")
        a.wait_for_timeout(500)
        if not a.evaluate(WATCH, [renamed, f"{ROOT}/Note 31.md", f"{ROOT}/Note 40.md"]):
            failed("the rows to watch are not drawn")
        started = time.monotonic()
        order = b.evaluate(
            """(root) => {
              const ws = window.nibApp.workspace
              const names = ws.shownTree.children.map((one) => one.name).filter((one) => one !== 'Note 40.md')
              names.splice(names.indexOf('Note 31.md') + 1, 0, 'Note 40.md')
              ws.arranged.set(root, names)
              return names
            }""",
            ROOT,
        )
        say(f"B put Note 40 after Note 31: {order[:6]}...")
        wait_for(
            a,
            """() => {
              const names = window.nibApp.workspace.shownTree.children.map((one) => one.name)
              return names.indexOf('Note 40.md') === names.indexOf('Note 31.md') + 1
            }""",
            "[A] B's order",
        )
        took = time.monotonic() - started
        a.wait_for_timeout(500)
        frames = a.evaluate(FRAMES)
        say(f"a row B dragged reached A in {took:.1f}s")
        held = tops(frames, 0)
        for one in jumps(frames, 0, height):
            failed(one)
        if held and abs((held[-1] - held[0]) - height) > 1:
            failed(f"Note 35b did not end one row down: {held[0]} -> {held[-1]}")
        if not [top for top in held if held[0] + 1 < top < held[-1] - 1]:
            failed("Note 35b did not slide down: no frame between")
        now = state(a)
        if now != {"picked": [renamed], "focused": renamed, "open": before["open"]}:
            failed(f"B's drag changed what A had: {now}")

        listed = a.evaluate(
            "() => window.nibApp.workspace.tree.children.filter((one) => !one.is_dir).map((one) => one.path)"
        )
        still = window_for(device("reduce"), "C", listed)
        still.bring_to_front()
        scroll_to(still, f"{ROOT}/Note 30.md")
        if not still.evaluate(WATCH, [f"{ROOT}/Note 38.md", f"{ROOT}/Note 31.md", f"{ROOT}/Note 39.md"]):
            failed("[C] the rows to watch are not drawn")
        b.evaluate("(p) => window.nibApp.workspace.rename(p, 'Note 39b.md')", f"{ROOT}/Note 37.md")
        wait_for(still, LISTED, "[C] Note 37 renamed in B", f"{ROOT}/Note 39b.md")
        still.wait_for_timeout(500)
        frames = still.evaluate(FRAMES)
        if max(frame["moving"] for frame in frames) != 0:
            failed("the list moved for a reader who asked for as little movement as possible")
        say("C, which asked for less movement, took the rename with nothing moving")
        wait_for(a, LISTED, "[A] Note 37 renamed in B", f"{ROOT}/Note 39b.md")
        say(f"A at the end: {state(a)}")
        DRIVE.shot(a, "01-after")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
