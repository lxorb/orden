from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import LANDED

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 40

HINTS = "try { localStorage.setItem('orden:hints', JSON.stringify(['graph', 'palette'])) } catch {}"

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.noteFrom('# Goal\\n\\nthe goal\\n', at('Work'))
  await ws.noteFrom('# Ideas\\n\\nsome ideas\\n', at('Work'))
  await ws.loadTree()
  return at('Work')
}
"""

ROW = "aside .row[data-path$='/Work']"

BOXES = f"""
() => {{
  const row = document.querySelector("{ROW}")
  const twist = row?.querySelector('.twist')
  const mark = twist?.querySelector('svg')
  if (!row || !mark) return null
  const box = (el) => {{ const r = el.getBoundingClientRect(); return {{ x: r.x, y: r.y, w: r.width, h: r.height }} }}
  const strip = getComputedStyle(twist, '::before')
  return {{ row: box(row), mark: box(mark), twist: box(twist), strip: parseFloat(strip.width) }}
}}
"""

OPEN = f"() => document.querySelector(\"{ROW}\")?.getAttribute('aria-expanded')"
FRONT = "() => window.ordenApp.workspace.active?.path ?? null"

def settled(page: Page, what: str) -> dict:
    wait_for(page, LANDED, "the sheets")
    seen = None
    for _ in range(40):
        now = page.evaluate(BOXES)
        if now is not None and json.dumps(now) == json.dumps(seen):
            return now
        seen = now
        page.wait_for_timeout(150)
    wrong(f"{what}: the row never stood still")
    return seen or {}

def landing_on(page: Page, at: tuple[float, float], what: str, said: str) -> None:
    wait_for(page, f"() => !!document.elementFromPoint({at[0]}, {at[1]})?.closest({what!r})", f"{said}: the press to land there")

def turned(page: Page, at: tuple[float, float], what: str) -> None:
    was = page.evaluate(OPEN)
    front = page.evaluate(FRONT)
    landing_on(page, at, ".twist", what)
    page.mouse.click(*at)
    try:
        wait_for(page, f"() => ({OPEN})() !== {json.dumps(was)}", what, 10)
    except BaseException:
        wrong(f"{what}: the row did not turn")
    page.wait_for_timeout(300)
    if page.evaluate(FRONT) != front:
        wrong(f"{what}: it opened {page.evaluate(FRONT)} as well")
    say(f"{what}: {was} -> {page.evaluate(OPEN)}")

def desk(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    page = context.new_page()
    page.add_init_script(HINTS)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        say(f"the folder is {page.evaluate(SEED)}")
        wait_for(page, f"() => !!document.querySelector(\"{ROW} .twist svg\")", "the folder's twist")
        if page.evaluate(OPEN) == "true":
            page.locator(f"{ROW} .twist").click()
            wait_for(page, f"() => ({OPEN})() === 'false'", "the folder shut")

        boxes = settled(page, "the folder's row")
        say(f"row, twist and mark: {boxes}")
        row, mark = boxes["row"], boxes["mark"]
        middle = mark["y"] + mark["h"] / 2
        turned(page, (mark["x"] - 3, middle), "3px before the mark")
        turned(page, (mark["x"] + mark["w"] + 3, middle), "3px after the mark")
        turned(page, (mark["x"] + mark["w"] / 2, row["y"] + 2), "at the top of the row")
        turned(page, (mark["x"] + mark["w"] / 2, row["y"] + row["h"] - 2), "at the foot of the row")

        front = page.evaluate(FRONT)
        was = page.evaluate(OPEN)
        page.mouse.dblclick(mark["x"] - 2, middle)
        page.wait_for_timeout(500)
        if page.evaluate(FRONT) != front:
            wrong(f"a double press on the twist opened {page.evaluate(FRONT)}")
        if page.evaluate(OPEN) != was:
            wrong("a double press on the twist did not turn the row there and back")

        after = page.evaluate(BOXES)
        if after["row"] != row or after["mark"] != mark:
            wrong(f"the row or its mark moved: {after}")

        page.locator(f"{ROW} .orden-row-label").click()
        try:
            wait_for(page, "() => (window.ordenApp.workspace.active?.path ?? '').includes('/Work')", "the folder opened", 10)
        except BaseException:
            wrong(f"pressing the name did not open the row; in front is {page.evaluate(FRONT)}")
        DRIVE.shot(page, "tree-caret", clip={"x": row["x"], "y": row["y"] - 4, "width": row["w"], "height": row["h"] + 8})
    finally:
        context.close()

def thumb(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 420, "height": 880},
        has_touch=True,
        is_mobile=True,
        user_agent="Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    )
    page = context.new_page()
    page.add_init_script(HINTS)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        if not page.evaluate("() => document.documentElement.hasAttribute('data-touch')"):
            say("this page is not a touch page; the thumb's half is left out")
            return
        page.evaluate(SEED)
        page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
        wait_for(page, f"() => !!document.querySelector(\"{ROW} .twist svg\")", "the folder's twist under a thumb")
        boxes = settled(page, "the folder's row under a thumb")
        say(f"under a thumb: {boxes}")
        target = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--touch-target'))")
        if boxes["strip"] < target - 0.5:
            wrong(f"the strip is {boxes['strip']}px wide under a thumb, short of {target}")
        if boxes["twist"]["h"] < target - 0.5:
            wrong(f"the strip is {boxes['twist']['h']}px tall under a thumb, short of {target}")
    finally:
        context.close()

TAGS = """
async () => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom('# Tagged\\n\\n#work/plan #work/ideas\\n', ws.activeSpace.root)
  window.ordenApp.search.text = ''
  ws.showPanel('search')
}
"""

TAG = "aside .line:has(.twist) .twist"
TAG_OPEN = f"() => document.querySelector(\"{TAG}\")?.getAttribute('aria-expanded')"
SEARCHED = "() => window.ordenApp.search.text"

def tags(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    page = context.new_page()
    page.add_init_script(HINTS)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        page.evaluate(TAGS)
        wait_for(page, f"() => !!document.querySelector(\"{TAG}\")", "the tag that holds tags")
        wait_for(page, LANDED, "the sheets")
        seen = None
        for _ in range(40):
            now = page.evaluate(f"() => JSON.stringify(document.querySelector(\"{TAG}\").getBoundingClientRect())")
            if now == seen:
                break
            seen = now
            page.wait_for_timeout(150)
        box = json.loads(seen or "{}")
        say(f"the tag's twist: {box}")
        middle = box["y"] + box["height"] / 2
        for x, what in ((box["x"] - 3, "3px before the tag's twist"), (box["x"] + box["width"] + 2, "2px after the tag's twist")):
            was = page.evaluate(TAG_OPEN)
            landing_on(page, (x, middle), ".twist", what)
            page.mouse.click(x, middle)
            try:
                wait_for(page, f"() => ({TAG_OPEN})() !== {json.dumps(was)}", what, 10)
            except BaseException:
                wrong(f"{what}: the tag did not turn")
            if page.evaluate(SEARCHED):
                wrong(f"{what}: it searched for {page.evaluate(SEARCHED)!r} as well")
            say(f"{what}: {was} -> {page.evaluate(TAG_OPEN)}")
        page.locator("aside .line:has(.twist) .orden-row-label").first.click()
        try:
            wait_for(page, f"() => ({SEARCHED})().includes('tag:work')", "the tag searched for", 10)
        except BaseException:
            wrong(f"pressing the tag's name searched for {page.evaluate(SEARCHED)!r}")
    finally:
        context.close()

def drive(browser: Browser) -> None:
    desk(browser)
    thumb(browser)
    tags(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a press a few pixels off the twist turns the row and opens nothing"))
