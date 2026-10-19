"""A note, a folder and a tab dragged onto the space switcher move to the space they are let
go of on (#303).

Emil: "drag a note onto the space switcher to move it". Held over the switcher's button the
list of spaces opens; let go of on a space, the row moves there, the same move and the same
Undo as the row's Move was; leaving the list, or Escape, closes it and nothing moves. The
row's right-click menu no longer offers Move, nor a tab's Move to space - the palette asks
where instead - and a finger, which has no drag, still has them.

What it checks, on the built web app in Chromium:

    a note of the file list dragged by the mouse onto the switcher opens its list after a
      hold, lights the other space's row, and let go of there moves to that space - the
      file there and gone from here - and one Ctrl+Z puts it back
    a folder the same, with what is in it
    a drag that leaves the list again, or is ended by Escape, closes it, and moves nothing
    a tab carried onto the switcher moves its file there, and the tab with it
    the right-click menus of a row and a tab say neither Move nor Move to space; on a
      phone a row's held press still offers Move, and in the Manual order a row lifted by
      a finger onto the switcher moves to the space it is let go of on

    python apps/desktop/test/e2e/drag-to-space.py
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
#: The hint that comes up under the space's name a few seconds in lies over the list.
HINTS_SEEN = "try { localStorage.setItem('nib:hints', JSON.stringify(['sign-in', 'graph', 'palette'])) } catch {}"

BUTTON = '[data-space-drop="switcher"]'
LIST = "!!document.querySelector('[data-spaces-open]')"
#: Longer than the hold that opens the list (SPRING in tab-strip/space-drop.ts).
HOLD = 900

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  await ws.addSpace('Work')
  const work = ws.spaces.find((one) => one.name === 'Work')
  if (ws.activeSpaceId !== home.id) await ws.showSpace(home.id)
  await ws.noteFrom('# Plan\\n\\nThe plan.\\n', home.root)
  await ws.noteFrom('# Draft\\n\\nA draft.\\n', home.root)
  await ws.noteFrom('# Map\\n\\nThe map.\\n', `${home.root.replace(/\\/+$/, '')}/Trip`)
  await ws.loadTree()
  if (ws.panel !== 'tree') ws.showPanel('tree')
  return { home: { id: home.id, root: home.root }, work: { id: work.id, root: work.root } }
}
"""

#: Whether a file is at a path, read off the disk.
THERE = "async (path) => (await window.nibApp.workspace.noteText(path).catch(() => null)) !== null"


def join(root: str, name: str) -> str:
    return f"{root.rstrip('/')}/{name}"


def there(page: Page, path: str) -> bool:
    return bool(page.evaluate(THERE, path))


def centre(page: Page, selector: str) -> tuple[float, float]:
    box = page.locator(selector).first.bounding_box()
    if box is None:
        raise SystemExit(f"nothing on screen for {selector}")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def row_of(path: str) -> str:
    return f".row[data-path={json.dumps(path)}]"


def glide(page: Page, x: float, y: float) -> None:
    page.mouse.move(x, y, steps=8)
    page.wait_for_timeout(60)


def carry_to_switcher(page: Page, start: str) -> tuple[float, float]:
    """The mouse down on `start` and held over the switcher's button until its list opens.
    Answers where the button is."""
    x, y = centre(page, start)
    page.mouse.move(x, y)
    page.mouse.down()
    glide(page, x + 12, y + 4)
    bx, by = centre(page, BUTTON)
    glide(page, bx, by)
    # The drag is the platform's, which hears the pointer move: a little, over the button.
    for step in range(6):
        glide(page, bx + (step % 2), by)
        page.wait_for_timeout(HOLD // 6)
    return bx, by


def lit(page: Page, space: str) -> bool:
    return bool(
        page.evaluate(
            "(id) => !!document.querySelector(`[data-space-drop=\"${id}\"].is-drop`)",
            space,
        )
    )


def drop_on(page: Page, space: str, label: str) -> None:
    if not page.evaluate(f"() => {LIST}"):
        wrong(f"[{label}] holding it over the switcher did not open the list of spaces")
    sx, sy = centre(page, f'[data-space-drop="{space}"]')
    glide(page, sx, sy)
    glide(page, sx + 2, sy)
    if not lit(page, space):
        wrong(f"[{label}] the space's row did not light under it")
    shot(page, f"{label}-over")
    page.mouse.up()
    DRIVE.settled(page)
    page.wait_for_timeout(600)


def moved(page: Page, label: str, ids: dict, name: str) -> None:
    home, work = join(ids["home"]["root"], name), join(ids["work"]["root"], name)
    if there(page, home):
        wrong(f"[{label}] {name} is still in Home")
    if not there(page, work):
        wrong(f"[{label}] {name} is not in Work")
    else:
        say(f"ok   [{label}] {name} moved to Work, and is not in Home")
    if page.evaluate(f"() => {LIST}"):
        wrong(f"[{label}] the list of spaces stayed open after the drop")


def desktop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    page.add_init_script(HINTS_SEEN)
    DRIVE.open(page)
    ids = page.evaluate(SEED)
    wait_for(page, f"document.querySelector('{BUTTON}')", "[desktop] the switcher")
    home = ids["home"]["root"]
    work = ids["work"]["id"]
    DRIVE.settled(page)

    # ── A note, and its Undo ─────────────────────────────────────────
    wait_for(page, f"document.querySelector({json.dumps(row_of(join(home, 'Plan.md')))})", "[desktop] Plan's row")
    carry_to_switcher(page, row_of(join(home, "Plan.md")))
    drop_on(page, work, "note")
    moved(page, "note", ids, "Plan.md")
    page.evaluate("async () => { await window.nibApp.workspace.undoFileAction() }")
    page.wait_for_timeout(600)
    if there(page, join(home, "Plan.md")) and not there(page, join(ids["work"]["root"], "Plan.md")):
        say("ok   [note] one Ctrl+Z put it back in Home")
    else:
        wrong("[note] Undo did not put Plan back in Home")
    page.evaluate("async () => { await window.nibApp.workspace.loadTree() }")
    DRIVE.settled(page)

    # ── A folder, with what is in it ─────────────────────────────────
    carry_to_switcher(page, row_of(join(home, "Trip")))
    drop_on(page, work, "folder")
    moved(page, "folder", ids, "Trip/Map.md")

    # ── Leaving the list, and Escape: nothing moves ──────────────────
    page.evaluate("async () => { await window.nibApp.workspace.loadTree() }")
    DRIVE.settled(page)
    plan = row_of(join(home, "Plan.md"))
    bx, by = carry_to_switcher(page, plan)
    if not page.evaluate(f"() => {LIST}"):
        wrong("[leaving] the list did not open under the hold")
    px, py = centre(page, row_of(join(home, "Draft.md")))
    glide(page, px, py)
    glide(page, px + 2, py)
    if page.evaluate(f"() => {LIST}"):
        wrong("[leaving] the list stayed open once the drag left it")
    else:
        say("ok   [leaving] leaving the list closes it")
    # Back to the button, the list open again, and Escape.
    glide(page, bx, by)
    page.wait_for_timeout(HOLD)
    glide(page, bx + 1, by)
    page.keyboard.press("Escape")
    page.mouse.up()
    DRIVE.settled(page)
    page.wait_for_timeout(400)
    if page.evaluate(f"() => {LIST}"):
        wrong("[escape] the list stayed open after Escape")
    if not there(page, join(home, "Plan.md")) or there(page, join(ids["work"]["root"], "Plan.md")):
        wrong("[escape] Plan moved, with no space let go of on")
    else:
        say("ok   [escape] Escape closes the list, and nothing moves")

    # ── A tab ────────────────────────────────────────────────────────
    page.evaluate(
        "async (path) => { await window.nibApp.workspace.open(path) }",
        join(home, "Draft.md"),
    )
    wait_for(page, "!!window.nibApp.workspace.active?.path?.endsWith('Draft.md')", "[tab] Draft open")
    tab = page.evaluate("() => window.nibApp.workspace.active.id")
    DRIVE.settled(page)
    carry_to_switcher(page, f'[data-tab="{tab}"]')
    drop_on(page, work, "tab")
    moved(page, "tab", ids, "Draft.md")
    path = page.evaluate("(id) => window.nibApp.workspace.tabs.find((one) => one.id === id)?.path ?? null", tab)
    if path != join(ids["work"]["root"], "Draft.md"):
        wrong(f"[tab] the tab did not go with its file: {path}")
    else:
        say("ok   [tab] the tab went with its file")

    # ── The menus ────────────────────────────────────────────────────
    page.locator(row_of(join(home, "Plan.md"))).first.click(button="right")
    page.wait_for_timeout(300)
    said = page.evaluate("() => [...document.querySelectorAll('.menu [role=menuitem]')].map((one) => one.textContent.trim())")
    page.keyboard.press("Escape")
    if not said:
        wrong("[menu] the row's menu did not open")
    elif any(one.startswith("Move") for one in said):
        wrong(f"[menu] the row's right-click menu still offers a move: {said}")
    else:
        say("ok   [menu] the row's right-click menu offers no Move")
    page.evaluate("async (path) => { await window.nibApp.workspace.open(path) }", join(home, "Plan.md"))
    wait_for(page, "!!window.nibApp.workspace.active?.path?.endsWith('Plan.md')", "[menu] Plan open")
    plan_tab = page.evaluate("() => window.nibApp.workspace.active.id")
    page.locator(f'[data-tab="{plan_tab}"]').first.click(button="right")
    page.wait_for_timeout(300)
    said = page.evaluate("() => [...document.querySelectorAll('.menu [role=menuitem]')].map((one) => one.textContent.trim())")
    page.keyboard.press("Escape")
    if not said:
        wrong("[menu] the tab's menu did not open")
    elif any("Move to space" in one for one in said):
        wrong(f"[menu] the tab's right-click menu still offers Move to space: {said}")
    else:
        say("ok   [menu] the tab's right-click menu offers no Move to space")
    page.close()


def phone(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE,
        has_touch=True,
        is_mobile=True,
    )
    page.add_init_script(HINTS_SEEN)
    DRIVE.open(page)
    ids = page.evaluate(SEED)
    page.evaluate("() => { window.nibApp.workspace.panel = 'tree' }")
    plan = row_of(join(ids["home"]["root"], "Plan.md"))
    wait_for(page, f"document.querySelector({json.dumps(plan)})", "[phone] Plan's row")
    DRIVE.settled(page)
    page.locator(plan).first.dispatch_event("contextmenu")
    page.wait_for_timeout(400)
    said = page.evaluate("() => [...document.querySelectorAll('.menu [role=menuitem], .sheet [role=menuitem]')].map((one) => one.textContent.trim())")
    if "Move" not in said:
        wrong(f"[phone] a row's held press no longer offers Move: {said}")
    else:
        say("ok   [phone] a row's held press still offers Move")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # In the Manual order a finger lifts a row; lifted onto the switcher, it opens the list
    # and moves to the space it is let go of on.
    page.evaluate("() => window.nibApp.workspace.setSort('manual')")
    page.wait_for_timeout(300)
    DRIVE.settled(page)
    cdp = page.context.new_cdp_session(page)

    def touch(kind: str, x: float, y: float) -> None:
        points = [] if kind == "touchEnd" else [{"x": x, "y": y}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    def slide(x0: float, y0: float, x1: float, y1: float, steps: int = 10) -> None:
        for step in range(1, steps + 1):
            touch("touchMove", x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps)
            page.wait_for_timeout(25)

    x, y = centre(page, plan)
    touch("touchStart", x, y)
    # Past the short hold that lifts the row, and short of the row's own menu.
    page.wait_for_timeout(320)
    if not page.evaluate("() => !!document.querySelector('.row.carried')"):
        wrong("[phone] the hold did not lift the row")
    bx, by = centre(page, BUTTON)
    slide(x, y, x, by)
    page.wait_for_timeout(HOLD)
    touch("touchMove", x, by + 1)
    page.wait_for_timeout(100)
    if not page.evaluate(f"() => {LIST}"):
        wrong("[phone] holding the row over the switcher did not open the list")
    work = ids["work"]["id"]
    wx, wy = centre(page, f'[data-space-drop="{work}"]')
    slide(x, by + 1, x, wy, 6)
    page.wait_for_timeout(100)
    if not lit(page, work):
        wrong("[phone] Work's row did not light under the finger")
    shot(page, "phone-over")
    touch("touchEnd", x, wy)
    page.wait_for_timeout(700)
    moved(page, "phone", ids, "Plan.md")
    page.close()


def drive(browser: Browser) -> None:
    desktop(browser)
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a note, a folder and a tab dragged onto the switcher move to that space"))
