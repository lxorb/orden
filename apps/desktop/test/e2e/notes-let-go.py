import json
from typing import Any
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
HERON = "# Heron\n\nA heron stands in the reeds.\n\n" + "\n\n".join(
    f"Reed {at} bends over the water by [[Other]] #reeds." for at in range(1, 90)
)
PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36"
WARM = 10
SOME = 15
TIMES = 4
WORST = 3
FLOORS = {"heap": 512 * 1024, "nodes": 200, "listeners": 50}
CYCLE = """async (times) => {
  const ws = window.ordenApp.workspace
  const note = ws.notes.find((one) => one.name.startsWith('Heron'))
  const until = async (done) => {
    for (let at = 0; at < 500 && !done(); at++) await new Promise((go) => setTimeout(go, 10))
    if (!done()) throw new Error('the note did not open or close in time')
  }
  window.__gone ??= []
  for (let at = 0; at < times; at++) {
    await ws.openEntry(note.path, { activate: true })
    await until(() => ws.active?.doc?.includes('heron') && window.orden?.dom.isConnected && window.orden.state.doc.length > 1000)
    await new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(go)))
    window.__gone.push(new WeakRef(window.orden))
    await ws.closeActive()
    await until(() => ws.active?.note?.path !== note.path)
  }
  return ws.tabs.length
}"""
def held(page: Page, cdp: Any) -> dict[str, int]:
    for _ in range(3):
        cdp.send("HeapProfiler.collectGarbage")
    counted = cdp.send("Memory.getDOMCounters")
    return {
        "heap": int(cdp.send("Runtime.getHeapUsage")["usedSize"]),
        "nodes": int(counted["nodes"]),
        "listeners": int(counted["jsEventListeners"]),
        "views": int(page.evaluate("window.__gone.filter((one) => one.deref()).length")),
    }
def lets_go(page: Page, where: str) -> None:
    DRIVE.open(page)
    DRIVE.seed(page, HERON, "# Other\n\nSomething else.\n")
    DRIVE.open_note(page, "Other")
    cdp = page.context.new_cdp_session(page)
    page.evaluate(CYCLE, WARM)
    start = held(page, cdp)
    page.evaluate(CYCLE, SOME)
    some = held(page, cdp)
    page.evaluate(CYCLE, SOME * (TIMES - 1))
    more = held(page, cdp)
    say(f"{where}: after {WARM} {json.dumps(start)}, {SOME} more {json.dumps(some)}, {SOME * TIMES} more {json.dumps(more)}")
    if more["views"]:
        wrong(f"{where}: {more['views']} of {WARM + SOME * TIMES} closed notes still hold their editor")
    for what, floor in FLOORS.items():
        few = max(some[what] - start[what], floor)
        many = more[what] - start[what]
        if many > WORST * few:
            wrong(
                f"{where}: {what} grew by {many} over {SOME * TIMES} opens and closes against {some[what] - start[what]}"
                f" over {SOME}, so every closed note keeps some"
            )
def drive(browser: Browser) -> None:
    lets_go(DRIVE.page(browser, viewport={"width": 1200, "height": 800}), "laptop")
    phone = DRIVE.context(browser, viewport={"width": 360, "height": 720}, user_agent=PHONE, has_touch=True, is_mobile=True)
    page = phone.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    lets_go(page, "phone")
raise SystemExit(DRIVE.run(drive, "a note opened and closed again and again lets go of its editor, its nodes and its memory"))
