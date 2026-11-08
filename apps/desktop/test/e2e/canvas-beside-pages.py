from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PRESSED = "() => [...document.querySelectorAll('.canvas .cluster button.on')].map((one) => one.getAttribute('aria-label')).join(',')"


def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 820})
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.createCanvas()")
    wait_for(page, "!!window.ordenApp.workspace.active?.path?.endsWith('.canvas')", "a canvas")
    page.wait_for_selector(".canvas", timeout=15000)
    alone = page.locator(".canvas").first.bounding_box()
    page.mouse.click(alone["x"] + alone["width"] / 2, alone["y"] + alone["height"] / 3)
    page.keyboard.press("r")
    page.wait_for_timeout(300)
    lone = page.evaluate(PRESSED)
    say(f"a canvas alone after r: {lone!r}")
    if "Rectangle" not in lone:
        wrong(f"r on a canvas alone did not choose the rectangle: {lone!r}")
        return
    page.keyboard.press("v")
    page.evaluate("() => window.ordenApp.workspace.split('right')")
    page.wait_for_timeout(500)
    page.evaluate("() => window.ordenApp.workspace.createPages()")
    wait_for(page, "!!window.ordenApp.workspace.active?.path?.endsWith('.pages')", "a page note beside it")
    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(800)
    shown = page.evaluate("() => [document.querySelectorAll('.canvas').length, document.querySelectorAll('.pages').length]")
    say(f"canvases and page notes drawn {shown}")
    if shown[0] < 1 or shown[1] < 1:
        wrong(f"wanted a canvas beside a page note, drew {shown}")
        return

    box = page.locator(".canvas").first.bounding_box()
    say(f"canvas box {box}")
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 3)
    page.wait_for_timeout(300)
    page.keyboard.press("r")
    page.wait_for_timeout(400)
    pressed = page.evaluate(PRESSED)
    say(f"the canvas bar after r: {pressed!r}")
    if "Rectangle" not in pressed:
        wrong(f"the rectangle chosen on the canvas did not stay chosen beside a page note: {pressed!r}")
        return

    paper = page.locator(".pages").first.bounding_box()
    page.mouse.click(paper["x"] + paper["width"] / 2, paper["y"] + paper["height"] / 2)
    page.wait_for_timeout(400)
    later = page.evaluate(PRESSED)
    say(f"the canvas bar once the page note is used: {later!r}")
    if "Rectangle" in later:
        wrong("the page note took up a tool it has not got")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
