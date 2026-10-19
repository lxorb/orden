"""A phone and a tablet have no AI panel (#403): the right side's tabs hold no Ask, the
palette has no row that opens it, and its key and a panel left open on it by a desktop
sitting show nothing. A desktop beside them keeps all of it, so the drive is asking the
right question rather than one nothing would answer.

Run it from the repository root:

    python apps/desktop/test/e2e/mobile-no-ai.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 40

ANDROID = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
HINTS = "try { localStorage.setItem('nib:hints', JSON.stringify(['graph', 'palette'])) } catch {}"

# The right side's tabs, by the names they wear, once it is open on the outline.
RIGHT_TABS = """
async () => {
  const ws = window.nibApp.workspace
  ws.showPanel('outline')
  for (let i = 0; i < 40; i += 1) {
    const tabs = [...document.querySelectorAll('aside[data-region="right"] [role="tab"]')]
    if (tabs.length) return tabs.map((one) => one.getAttribute('aria-label'))
    await new Promise((done) => setTimeout(done, 100))
  }
  return null
}
"""

# The palette's command rows for a word, by their first line.
ROWS = "() => [...document.querySelectorAll('.palette [role=\"option\"]')].map((one) => one.innerText.split('\\n')[0].trim())"


def context_for(browser: Browser, device: str):
    if device == "desktop":
        return browser.new_context(viewport={"width": 1280, "height": 820})
    size = {"width": 420, "height": 880} if device == "phone" else {"width": 1180, "height": 820}
    return browser.new_context(viewport=size, has_touch=True, is_mobile=True, user_agent=ANDROID)


def palette_rows(page: Page, word: str) -> list[str]:
    page.keyboard.press("Control+Shift+KeyP")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the palette")
    page.keyboard.type(word)
    page.wait_for_timeout(400)
    rows = page.evaluate(ROWS)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return rows


def one(browser: Browser, device: str) -> None:
    context = context_for(browser, device)
    page = context.new_page()
    page.add_init_script(HINTS)
    page.on("pageerror", lambda error: wrong(f"[{device}] page error: {error}"))
    try:
        DRIVE.open(page)
        said = page.evaluate("() => window.nibApp.workspace && document.documentElement.hasAttribute('data-touch')")
        say(f"[{device}] touch: {said}")
        if device != "desktop" and not said:
            wrong(f"[{device}] the page did not take itself for a touch screen")

        tabs = page.evaluate(RIGHT_TABS)
        say(f"[{device}] the right side's tabs: {tabs}")
        if tabs is None:
            wrong(f"[{device}] the right side never showed its tabs")
        elif device == "desktop" and "Ask" not in tabs:
            wrong("[desktop] the right side lost its Ask tab")
        elif device != "desktop" and "Ask" in tabs:
            wrong(f"[{device}] the right side offers the AI panel: {tabs}")

        rows = palette_rows(page, "ask")
        say(f"[{device}] the palette for ask: {rows}")
        if device == "desktop" and "Ask" not in rows:
            wrong("[desktop] the palette lost its row for the AI panel")
        elif device != "desktop" and "Ask" in rows:
            wrong(f"[{device}] the palette offers the AI panel: {rows}")

        if device != "desktop":
            # The panel's key, and a panel a desktop sitting left open: nothing shows.
            page.keyboard.press("Control+Shift+KeyA")
            page.evaluate("() => { window.nibApp.workspace.rightPanel = 'ask' }")
            page.wait_for_timeout(500)
            shown = page.evaluate(
                "() => ({ open: window.nibApp.workspace.openOn('right'),"
                " body: !!document.querySelector('.body[data-panel=\"ask\"]') })"
            )
            say(f"[{device}] after the key and a panel left open: {shown}")
            if shown["open"] == "ask" or shown["body"]:
                wrong(f"[{device}] the AI panel is drawn: {shown}")
        DRIVE.shot(page, f"{device}-right")
    finally:
        context.close()


def drive(browser: Browser) -> None:
    for device in ("desktop", "phone", "tablet"):
        one(browser, device)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a phone and a tablet have no AI panel, and a desktop keeps it"))
