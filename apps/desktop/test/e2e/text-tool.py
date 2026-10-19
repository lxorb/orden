"""Words typed straight onto a canvas and a page note, with the bar's Text button (#421).

Emil: "no button to create some text on page note / canvas (similar to the one you have
in miro board / chrome pdf)". The bar of a canvas and of a page note has a Text button:
pressed, or W, and the plane or the paper pressed, the words are typed in at once where the
press was, with no card round them, and the arrow is in hand after. The file keeps them
as a card Obsidian reads, listed under `nib.words`.

    python apps/desktop/test/e2e/text-tool.py
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

BUTTON = '.cluster button[aria-label="Text"]'

#: The words node the surface in front holds, as the file has it after a settle.
FILE = """() => JSON.parse(window.nibApp.workspace.active.doc)"""


def typed(page: Page, label: str, surface: str, settle: str) -> None:
    button = page.locator(BUTTON).first
    if not button.count():
        wrong(f"[{label}] the bar has no Text button")
        return
    button.click()
    page.wait_for_timeout(200)
    box = page.locator(surface).first.bounding_box()
    assert box
    at = (box["x"] + box["width"] * 0.35, box["y"] + box["height"] * 0.35)
    page.mouse.click(*at)
    page.wait_for_timeout(500)
    page.keyboard.type("Words on the paper")
    page.wait_for_timeout(300)
    shot(page, f"{label}-typing")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    page.evaluate(settle)
    # A canvas writes its file a pause after the changes stop.
    page.wait_for_timeout(2500)

    written = page.evaluate(FILE)
    words = written.get("nib", {}).get("words", [])
    nodes = [one for one in written.get("nodes", []) if one.get("id") in words]
    if not nodes or "Words on the paper" not in nodes[0].get("text", ""):
        wrong(f"[{label}] no words were written: {json.dumps(written)[:300]}")
        return
    say(f"ok   [{label}] typed where it was pressed, kept as words: {nodes[0]['text']!r}")

    node = page.locator(f'[data-id="{nodes[0]["id"]}"]').first
    look = node.evaluate("(one) => { const s = getComputedStyle(one); return [s.backgroundColor, s.boxShadow] }")
    if look[0] not in ("rgba(0, 0, 0, 0)", "transparent") or look[1] != "none":
        wrong(f"[{label}] the words are drawn on a card: {look}")
    else:
        say(f"ok   [{label}] no card round the words")
    which = page.evaluate("() => document.querySelector('.cluster button[aria-pressed=\"true\"]')?.getAttribute('aria-label')")
    if which == "Text":
        wrong(f"[{label}] the Text tool is still in hand after the words")
    shot(page, f"{label}-written")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)

    page.evaluate("async () => { const ws = window.nibApp.workspace; await ws.createCanvas(ws.activeSpace.root, 'Board.canvas') }")
    wait_for(page, "!!document.querySelector('.canvas') && !!document.querySelector('.cluster')", "the canvas")
    page.wait_for_timeout(600)
    typed(page, "canvas", ".canvas", "() => null")

    # And by its key: W, the arrow in hand again after the words.
    box = page.locator(".canvas").first.bounding_box()
    assert box
    page.mouse.click(box["x"] + box["width"] * 0.8, box["y"] + box["height"] * 0.8)
    page.keyboard.press("w")
    page.wait_for_timeout(200)
    which = page.evaluate("() => document.querySelector('.cluster button[aria-pressed=\"true\"]')?.getAttribute('aria-label')")
    if which != "Text":
        wrong(f"[canvas] W did not take up the Text tool: {which}")
    else:
        say("ok   [canvas] W takes up the Text tool")
    page.keyboard.press("v")

    for _ in range(4):
        page.evaluate("() => window.nibApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => !!window.nibApp.workspace.active?.path?.endsWith('.pages')"):
            break
    wait_for(page, "!!document.querySelector('.pages .cluster')", "the page note")
    page.wait_for_timeout(600)
    typed(page, "page note", ".pages", "() => window.nibApp.pages.current?.store.part()")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "words are typed straight onto a canvas and a page note"))
