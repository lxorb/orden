from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Browser, Page, Route

from harness import Drive

NEEDS = ("chromium",)

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PALETTE = re.compile(r"/assets/Palette-[^/]+\.js$")

ENTRY = re.compile(r'(<script type="module"[^>]*src="[^"]+\.js)"')

PALETTE_OPEN = "() => !!document.querySelector('.palette[role=dialog]')"

MARK = "() => { window.__beforeReload = true }"
SAME_PAGE = "() => window.__beforeReload === true"

RELOADED = "() => document.querySelector('script[type=module][src]')?.getAttribute('src').includes('deploy=2')"

def lose_the_palette(page: Page) -> dict[str, int]:
    asked = {"palette": 0, "deployed": 0}

    def refuse(route: Route) -> None:
        if asked["deployed"]:
            route.continue_()
            return
        asked["palette"] += 1
        route.abort("connectionreset")

    page.route(PALETTE, refuse)
    return asked

def press_for_palette(page: Page) -> bool:
    page.mouse.click(600, 400)
    page.keyboard.press("Control+O")
    try:
        page.wait_for_function(PALETTE_OPEN, timeout=4000, polling=50)
    except Exception:  # noqa: BLE001 - a timeout is the answer "it did not open"
        return False
    page.keyboard.press("Escape")
    page.wait_for_function(f"() => !({PALETTE_OPEN})()", timeout=4000, polling=50)
    return True

def same_build(browser: Browser) -> None:
    say("--- the same build: the network lost the piece ---")
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    asked = lose_the_palette(page)
    DRIVE.open(page)
    page.evaluate(MARK)

    offered = "() => !!document.querySelector('.notices .reload button')"
    if not DRIVE.waited(page, offered, "Reload on offer"):
        return
    say(f"    the palette's chunk was asked for {asked['palette']} time(s) and refused")
    shot(page, "same-build-offered")

    if press_for_palette(page):
        wrong("Ctrl+O opened a palette whose chunk never arrived")
    else:
        say("    Ctrl+O does nothing, as Chromium will not fetch the chunk again")
    if not page.evaluate(SAME_PAGE):
        wrong("the page reloaded by itself under the same build")

    page.unroute(PALETTE)
    with page.expect_navigation():
        page.click(".notices .reload button")
    DRIVE.ready(page)
    if press_for_palette(page):
        say("    after Reload, Ctrl+O opens the palette")
    else:
        wrong("the palette does not open after Reload")
    page.context.close()

def newer_build(browser: Browser) -> None:
    say("--- a newer build: the site moved on under the tab ---")
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    asked = lose_the_palette(page)
    served = {"root": 0}

    def deployed(route: Route) -> None:
        served["root"] += 1
        response = route.fetch()
        body = response.text()
        if served["root"] > 1:
            asked["deployed"] = 1
            body = ENTRY.sub(r'\1?deploy=2"', body, count=1)
        route.fulfill(response=response, body=body)

    page.route(re.compile(r"^[^?#]+://[^/]+/(\?.*)?$"), deployed)
    DRIVE.open(page)
    say(f"    the palette's chunk was asked for {asked['palette']} time(s) and refused")

    page.unroute(PALETTE)
    if not DRIVE.waited(page, RELOADED, "the page to reload by itself", patience=30):
        shot(page, "newer-build-stuck")
        return
    DRIVE.ready(page)
    entry: Any = page.evaluate(
        "() => document.querySelector('script[type=module][src]')?.getAttribute('src')"
    )
    say(f"    reloaded by itself, now running {entry}")
    if "deploy=2" not in str(entry):
        wrong("the reload did not pick up the newer build")
    if page.evaluate("() => !!document.querySelector('.notices .reload')"):
        wrong("Reload was offered for a newer build rather than done")
    if press_for_palette(page):
        say("    and Ctrl+O opens the palette")
        shot(page, "newer-build-reloaded")
    else:
        wrong("the palette does not open after the reload")
    page.context.close()

def drive(browser: Browser) -> None:
    same_build(browser)
    newer_build(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a lost chunk comes back, by Reload or by itself"))
