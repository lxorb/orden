from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SCRIPT = (Path(__file__).resolve().parents[2] / "src-tauri" / "src" / "web_swipe.js").read_text(
    encoding="utf-8"
)

TRAIL = """async () => {
  const ws = window.nibApp.workspace
  const path = (starts) => ws.notes.find((one) => one.name.startsWith(starts)).path
  await ws.open(path('Alpha'), { preview: true })
  await ws.open(path('Beta'), { preview: true })
}"""

HOLD = """(across) => {
  const at = document.querySelector('.cm-content')
  const step = (dx) => at.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaMode: 0, bubbles: true }))
  for (let one = 0; one < 30; one++) step(-across)
  window.__holding = setInterval(() => step(-0.001), 30)
}"""

def front(page: Page) -> str:
    return str(page.evaluate("window.nibApp.workspace.active?.note?.name ?? ''"))

def on(page: Page, starts: str, what: str) -> None:
    wait_for(page, f"window.nibApp.workspace.active?.note?.name.startsWith({json.dumps(starts)})", what)

def sweep(page: Page, x: float, y: float, across: float, down: float = 0) -> None:
    tools = page.context.new_cdp_session(page)
    tools.send(
        "Input.synthesizeScrollGesture",
        {
            "x": x,
            "y": y,
            "xDistance": across,
            "yDistance": down,
            "gestureSourceType": "mouse",
            "speed": 1200,
            "preventFling": True,
        },
    )
    tools.detach()

def lifted(page: Page) -> None:
    time.sleep(0.6)
    DRIVE.settled(page)

def opened(
    browser: Browser, scheme: str = "light", off: bool = False, scale: float = 1
) -> tuple[Page, float, float]:
    page = DRIVE.page(
        browser,
        viewport={"width": 1180, "height": 820},
        color_scheme=scheme,
        device_scale_factor=scale,
    )
    if off:
        page.add_init_script("localStorage.setItem('orden:swipe', 'off')")
    page.add_init_script("performance.setResourceTimingBufferSize(10000)")
    DRIVE.open(page)
    DRIVE.seed(page, "# Alpha\n\nThe first note.\n", "# Beta\n\nThe second note.\n")
    page.evaluate(TRAIL)
    wait_for(page, "window.nibApp.workspace.active?.canGoBack", "a tab with somewhere to go back to")
    wait_for(
        page,
        "performance.getEntriesByType('resource').some((one) => /\\/swipes-[^/]*\\.js$/.test(one.name))",
        "what hears a swipe",
    )
    DRIVE.settled(page)
    box = page.locator(".cm-content").first.bounding_box()
    if box is None:
        raise SystemExit("no note on screen")
    return page, box["x"] + box["width"] / 2, box["y"] + 120

def notes(browser: Browser, scheme: str) -> None:
    page, x, y = opened(browser, scheme)

    for across, name in ((7, "half"), (14, "armed")):
        page.evaluate(HOLD, across)
        DRIVE.settled(page)
        if page.locator(".orden-swipe").count() != 1:
            wrong(f"{scheme}: no arrow {name} way along a sweep")
        if (page.locator(".orden-swipe.armed").count() == 1) != (name == "armed"):
            wrong(f"{scheme}: the arrow {name} way along is armed wrong")
        shot(page, f"{scheme}-{name}")
        page.evaluate("clearInterval(window.__holding)")
        lifted(page)
        if front(page).startswith("Alpha"):
            page.evaluate("window.nibApp.workspace.goForward()")
        on(page, "Beta", "Beta again")

    sweep(page, x, y, 120)
    lifted(page)
    if not front(page).startswith("Beta"):
        wrong(f"{scheme}: a short sweep went somewhere: {front(page)}")
    else:
        say(f"ok   {scheme}: a short sweep stays")

    sweep(page, x, y, 700)
    lifted(page)
    on(page, "Alpha", "back on Alpha")
    say(f"ok   {scheme}: a long sweep to the right goes back")
    if page.locator(".orden-swipe").count() != 0:
        wrong(f"{scheme}: the arrow stayed after it went")

    sweep(page, x, y, -700)
    lifted(page)
    on(page, "Beta", "forward on Beta")
    say(f"ok   {scheme}: a long sweep to the left goes forward")

    sweep(page, x, y, 0, -300)
    lifted(page)
    sweep(page, x, y, 700)
    lifted(page)
    on(page, "Alpha", "back on Alpha after a scroll down")
    page.close()

WHERE = """() => {
  const circle = document.querySelector('.orden-swipe')
  const arrow = circle?.querySelector('.arrow')
  if (!circle || !arrow) return null
  const at = (box) => [box.x, box.y, box.width, box.height].map((one) => one * devicePixelRatio)
  return { circle: at(circle.getBoundingClientRect()), arrow: at(arrow.getBoundingClientRect()) }
}"""

def close_up(browser: Browser, scale: float) -> None:
    page, _, _ = opened(browser, scale=scale)
    for across, name in ((7.3, "half"), (14.3, "armed")):
        page.evaluate(HOLD, across)
        DRIVE.settled(page)
        where = page.evaluate(WHERE)
        if where is None:
            wrong(f"at {scale}x: no arrow {name} way along a sweep")
        else:
            off = [abs(value - round(value)) for value in where["circle"][:2] + where["arrow"][:2]]
            if name == "half" and max(off) > 0.01:
                wrong(f"at {scale}x: the arrow sits between pixels of the screen: {where}")
            else:
                say(f"ok   at {scale}x: the arrow {name} way along is on whole pixels")
            box = page.locator(".orden-swipe").bounding_box()
            if box is not None:
                shot(
                    page,
                    f"close/{scale:g}x-{name}",
                    clip={
                        "x": max(0, box["x"] - 16),
                        "y": box["y"] - 16,
                        "width": box["width"] + 32,
                        "height": box["height"] + 32,
                    },
                )
        page.evaluate("clearInterval(window.__holding)")
        lifted(page)
        if front(page).startswith("Alpha"):
            page.evaluate("window.nibApp.workspace.goForward()")
        on(page, "Beta", "Beta again")
    page.close()

def turned_off(browser: Browser) -> None:
    page, x, y = opened(browser, off=True)
    sweep(page, x, y, 700)
    lifted(page)
    if not front(page).startswith("Beta"):
        wrong(f"switched off, a sweep went back: {front(page)}")
    else:
        say("ok   switched off, a sweep is a scroll")
    page.close()

PAGE = f"""<!doctype html>
<meta charset="utf-8">
<style>
  body {{ margin: 0; font: 16px system-ui }}
  #row {{ width: 400px; overflow-x: auto; white-space: nowrap }}
  #row div {{ display: inline-block; width: 300px; height: 80px; background: #ccd }}
  #map {{ width: 400px; height: 120px; background: #dfd }}
  #short {{ width: 400px; overflow-x: auto; white-space: nowrap }}
  #short div {{ display: inline-block; width: 430px; height: 60px; background: #edc }}
</style>
<p id="words">Words.</p>
<div id="row"><div></div><div></div><div></div></div>
<div id="map">A map.</div>
<div id="short"><div></div></div>
<script>
  window.said = []
  window.open = (url, name) => {{
    if (String(name).startsWith('orden-swipe:')) window.said.push(JSON.parse(String(name).slice('orden-swipe:'.length)))
    return null
  }}
  document.getElementById('row').scrollLeft = 200
  document.getElementById('short').scrollLeft = 4
  document.getElementById('map').addEventListener('wheel', (event) => event.preventDefault(), {{ passive: false }})
</script>
<script>{SCRIPT}</script>
"""

def page_script(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 800, "height": 600})
    page.set_content(PAGE)

    def heard(selector: str, across: float, down: float = 0, notch: bool = False) -> list[dict[str, object]]:
        page.evaluate("window.said = []")
        box = page.locator(selector).bounding_box()
        assert box is not None
        x, y = box["x"] + 20, box["y"] + box["height"] / 2
        if notch:
            page.mouse.move(x, y)
            page.mouse.wheel(-across, -down)
        else:
            sweep(page, x, y, across, down)
        time.sleep(0.2)
        return list(page.evaluate("window.said"))

    plain = heard("#words", 100)
    if not plain or any(one.get("k") != "w" or one.get("l") or one.get("r") for one in plain):
        wrong(f"a sideways scroll over plain words: {json.dumps(plain)}")
    elif sum(float(str(one["dx"])) for one in plain) >= 0:
        wrong(f"a scroll towards the left was not said as one: {json.dumps(plain)}")
    else:
        say(f"ok   the page says a scroll it left over ({len(plain)} frames)")

    row = heard("#row", 100)
    if not row or not all(one.get("l") for one in row):
        wrong(f"a scroller with room to the left did not take the scroll: {json.dumps(row)}")
    else:
        say("ok   a scroller in the page takes what it can")

    kept = heard("#map", 100)
    if not kept or not all(one.get("l") and one.get("r") for one in kept):
        wrong(f"a map that took the wheel did not keep it: {json.dumps(kept)}")
    else:
        say("ok   a handler that took the wheel keeps it")

    def once_down(said: list[dict[str, object]]) -> bool:
        if len(said) != 1:
            return False
        across, down = abs(float(str(said[0]["dx"]))), abs(float(str(said[0]["dy"])))
        return down > 60 and down > across * 2.5

    straight = heard("#words", 0, 100)
    if not once_down(straight):
        wrong(f"a scroll down was not said once, as a scroll down: {json.dumps(straight)}")
    drifting = heard("#words", 60, 400)
    if not once_down(drifting):
        wrong(f"a scroll down that drifted sideways was not said once, down: {json.dumps(drifting)}")
    else:
        say("ok   a scroll down, drifting sideways or not, is said once as a scroll down")
    if heard("#words", 100, notch=True):
        wrong("a tilted wheel's notch was said")
    page.evaluate("document.documentElement.style.overscrollBehaviorX = 'none'")
    contained = heard("#words", 100)
    if not contained or not all(one.get("l") and one.get("r") for one in contained):
        wrong(f"a page that keeps its overscroll did not keep it: {json.dumps(contained)}")
    else:
        say("ok   overscroll-behavior-x: none keeps the swipe out")
    page.close()
    page = DRIVE.page(browser, viewport={"width": 800, "height": 600})
    page.set_content(PAGE.replace("<script>window.said", "<script>window.requestAnimationFrame = () => 0\n  window.said", 1))
    unpainted = heard("#words", 100)
    if not unpainted:
        wrong("a page that draws no frames, hidden behind its picture, said nothing of a sweep")
    else:
        say(f"ok   a page that draws no frames still says a sweep ({len(unpainted)} reports)")
    page.close()
    page = DRIVE.page(browser, viewport={"width": 800, "height": 600})
    page.set_content(PAGE)
    short = heard("#short", 150)
    DRIVE.waited(
        page,
        "document.getElementById('short').scrollLeft <= 0.5",
        "the short scroller to scroll to its edge",
        5,
    )
    if not short or not all(one.get("l") and one.get("r") for one in short):
        wrong(f"a scroll that moved a scroller to its edge was said as left over: {json.dumps(short)}")
    else:
        say("ok   a stream that moved a scroller is the scroller's, to its edge and past it")
    page.close()

SHORT_OF_THE_EDGE = """() => {
  const table = document.querySelector('.orden-table-scroll')
  if (!table) return null
  table.scrollLeft = 4
  return { left: table.scrollLeft, x: document.querySelector('.cm-content').getBoundingClientRect().x }
}"""

ARROW_SEEN = """() => {
  window.__arrow = false
  const look = () => {
    if (document.querySelector('.orden-swipe')) window.__arrow = true
    window.__looking = requestAnimationFrame(look)
  }
  look()
}"""

def latched(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    page.add_init_script("performance.setResourceTimingBufferSize(10000)")
    DRIVE.open(page)
    wide = "| a | b |\n|---|---|\n| " + "longword" * 60 + " | y |\n"
    DRIVE.seed(page, "# Alpha\n\nThe first note.\n", f"# Beta\n\nThe second note.\n\n{wide}")
    page.evaluate(TRAIL)
    wait_for(page, "window.nibApp.workspace.active?.canGoBack", "a tab with somewhere to go back to")
    wait_for(
        page,
        "performance.getEntriesByType('resource').some((one) => /\\/swipes-[^/]*\\.js$/.test(one.name))",
        "what hears a swipe",
    )
    wait_for(page, "document.querySelector('.orden-table-scroll')", "the wide table")
    DRIVE.settled(page)

    before = page.evaluate(SHORT_OF_THE_EDGE)
    box = page.locator(".orden-table-scroll").first.bounding_box()
    if before is None or box is None:
        wrong("no wide table on screen")
        page.close()
        return
    page.evaluate(ARROW_SEEN)
    sweep(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, 400)
    lifted(page)
    after = page.evaluate(
        """() => ({
          left: document.querySelector('.orden-table-scroll').scrollLeft,
          x: document.querySelector('.cm-content').getBoundingClientRect().x,
          arrow: window.__arrow,
        })"""
    )
    page.evaluate("cancelAnimationFrame(window.__looking)")
    say(f"the table from {before} to {after}, the note {front(page)!r}")
    if after["left"] > 0.5:
        wrong(f"the table did not scroll to its edge: {after['left']}")
    if after["arrow"]:
        wrong("the arrow came in over a table the sweep was scrolling")
    if not front(page).startswith("Beta"):
        wrong(f"a sweep that scrolled the table went back: {front(page)}")
    if after["x"] != before["x"]:
        wrong(f"the note moved with the sweep: {before['x']} to {after['x']}")
    shot(page, "latched-table")

    words = page.locator(".cm-content .cm-line").first.bounding_box()
    assert words is not None
    page.evaluate(ARROW_SEEN)
    sweep(page, words["x"] + 40, words["y"] + words["height"] / 2, 700)
    lifted(page)
    arrow = page.evaluate("window.__arrow")
    page.evaluate("cancelAnimationFrame(window.__looking)")
    if not arrow:
        wrong("over words that do not scroll sideways, the arrow never came in")
    on(page, "Alpha", "back on Alpha from the words")
    say("ok   a table scrolled is the table's; the words beside it go back")
    page.close()

def drive(browser: Browser) -> None:
    page_script(browser)
    latched(browser)
    for scheme in ("light", "dark"):
        notes(browser, scheme)
    for scale in (1, 1.25, 1.5, 2):
        close_up(browser, scale)
    turned_off(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "swipes go back and forward, and only where they should"))
