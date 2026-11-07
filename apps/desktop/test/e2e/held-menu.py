from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

MENU = ".orden-layer.menu[role=menu]"
OPEN = f"!!document.querySelector('{MENU}') && window.ordenApp.overlays.depth > 0"

LISTEN = """() => {
  window.__heard = []
  for (const type of ['pointerdown', 'mousedown', 'contextmenu', 'pointerup', 'mouseup', 'click', 'auxclick']) {
    window.addEventListener(type, (event) => window.__heard.push(
      `${type}:${event.button}/${event.buttons}${event.ctrlKey ? '+ctrl' : ''}${
        document.querySelector('.orden-layer.menu') ? ' (open)' : ''}`), true)
  }
}"""

def is_open(page: Page) -> bool:
    return bool(page.evaluate(f"() => {OPEN}"))

def centre(page: Page, selector: str) -> tuple[float, float]:
    box = page.locator(selector).first.bounding_box()
    if box is None:
        raise SystemExit(f"nothing on screen for {selector}")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

def row_of(page: Page, label: str) -> tuple[float, float]:
    row = page.locator(f"{MENU} [role=menuitem]", has_text=label).first
    box = row.bounding_box()
    if box is None:
        raise SystemExit(f"the menu has no {label!r} row")
    return box["x"] + min(40, box["width"] / 2), box["y"] + box["height"] / 2

def shut(page: Page) -> None:
    if is_open(page):
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

def heard(page: Page) -> list[str]:
    return list(page.evaluate("() => window.__heard.splice(0)"))

def clicked(page: Page, label: str, at: tuple[float, float]) -> None:
    page.mouse.move(*at)
    page.mouse.down(button="right")
    held_open = is_open(page)
    page.mouse.up(button="right")
    page.wait_for_function(f"() => {OPEN}", timeout=3000)
    page.wait_for_timeout(400)
    order = heard(page)
    say(f"[{label}] a right click: {' > '.join(order)}")
    if not is_open(page):
        wrong(f"[{label}] the menu went away after a right click")
        return
    say(f"ok   [{label}] a right click leaves the menu open (open while held: {held_open})")
    page.mouse.click(at[0] + 400, at[1] + 200 if at[1] < 400 else at[1] - 200)
    page.wait_for_timeout(300)
    if is_open(page):
        wrong(f"[{label}] a click past the menu did not close it")
    shut(page)

def held(page: Page, label: str, at: tuple[float, float], choose: str, chosen: str) -> None:
    page.mouse.move(*at)
    page.mouse.down(button="right")
    page.wait_for_timeout(250)
    if not is_open(page):
        say(f"[{label}] the menu is not open while the button is down: {' > '.join(heard(page))}")
        page.mouse.up(button="right")
        shut(page)
        return
    x, y = row_of(page, choose)
    page.mouse.move(x, y, steps=6)
    page.wait_for_timeout(100)
    page.mouse.up(button="right")
    page.wait_for_timeout(500)
    heard(page)
    if is_open(page):
        wrong(f"[{label}] the menu stayed open after letting go on {choose!r}")
        shut(page)
    elif not page.evaluate(chosen):
        wrong(f"[{label}] letting go on {choose!r} did not choose it")
    else:
        say(f"ok   [{label}] held, slid onto {choose!r} and let go of: chosen")

def held_past(page: Page, label: str, at: tuple[float, float]) -> None:
    page.mouse.move(*at)
    page.mouse.down(button="right")
    page.wait_for_timeout(250)
    if not is_open(page):
        page.mouse.up(button="right")
        return
    page.mouse.move(at[0] + 420, at[1], steps=6)
    page.mouse.up(button="right")
    page.wait_for_timeout(300)
    if is_open(page):
        wrong(f"[{label}] let go of past the menu, it stayed open")
        shut(page)
    else:
        say(f"ok   [{label}] let go of past the menu: closed, nothing chosen")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nThe plan, and its words.\n")
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    plan = f".row[data-path={json.dumps(root.rstrip('/') + '/Plan.md')}]"
    wait_for(page, f"document.querySelector({json.dumps(plan)})", "Plan's row")
    DRIVE.settled(page)
    page.evaluate(LISTEN)

    clicked(page, "file list", centre(page, plan))
    held(page, "file list", centre(page, plan), "Rename", "() => !!window.ordenApp.workspace.naming")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    held_past(page, "file list", centre(page, plan))

    DRIVE.open_note(page, "Plan")
    wait_for(page, "!!document.querySelector('.cm-content')", "the note")
    words = page.locator(".cm-line", has_text="The plan").first
    box = words.bounding_box()
    assert box is not None
    at = (box["x"] + 30, box["y"] + box["height"] / 2)
    clicked(page, "note", at)
    held(
        page,
        "note",
        at,
        "Duplicate",
        "() => (document.querySelector('.cm-content')?.textContent.match(/The plan, and its words/g) ?? []).length > 1",
    )
    held_past(page, "note", at)
    shot(page, "note")

    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    page.evaluate(
        "async (root) => { const ws = window.ordenApp.workspace;"
        " await window.ordenApp.tasks().then((t) => t.writeFile(`${root.replace(/\\/+$/, '')}/Board.canvas`,"
        " JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'A card', x: 0, y: 0, width: 240, height: 120 }], edges: [] })));"
        " await ws.loadTree(); await ws.openEntry(`${root.replace(/\\/+$/, '')}/Board.canvas`, { activate: true }) }",
        root,
    )
    wait_for(page, "!!document.querySelector('.canvas, [data-canvas]')", "the canvas")
    DRIVE.settled(page)
    page.wait_for_timeout(500)
    surface = page.locator(".canvas, [data-canvas]").first.bounding_box()
    assert surface is not None
    at = (surface["x"] + surface["width"] - 120, surface["y"] + surface["height"] - 120)
    clicked(page, "canvas", at)
    held_past(page, "canvas", at)
    shot(page, "canvas")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a right click's menu stays, and a held one chooses the row it is let go of on"))
