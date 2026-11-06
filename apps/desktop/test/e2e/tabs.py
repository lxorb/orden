from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots

NOTES = {
    "Daily": "# Daily\n\nThe note that stays open.\n",
    "First": "# First\n\nThe first stop.\n",
    "Second": "# Second\n\nThe second stop.\n",
    "Third": "# Third\n\nThe third stop.\n",
}

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const text of notes) await ws.noteFrom(text, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

STRIP = """
() => ({
  tabs: [...document.querySelectorAll('.tab')].map((tab) => ({
    name: tab.querySelector('.label')?.textContent ?? null,
  })),
  steps: [...document.querySelectorAll('.step')].map((one) => one.disabled),
  showing: window.nibApp.workspace.active?.name ?? null,
  trail: (window.nibApp.workspace.active?.trail ?? []).map((one) => one.split(/[\\\\/]/).pop()),
  at: window.nibApp.workspace.active?.at ?? null,
})
"""

def fresh(browser: Browser, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    DRIVE.open(page)
    say(f"[{label}] the space holds {page.evaluate(SEED, list(NOTES.values()))}")
    page.wait_for_timeout(300)
    return page

def peek(page: Page, name: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { preview: true })
        }""",
        name,
    )
    page.wait_for_timeout(500)

def strip(page: Page) -> dict:
    return page.evaluate(STRIP)

def drive_trail(browser: Browser) -> None:
    page = fresh(browser, "trail")

    peek(page, "First")
    peek(page, "Second")
    peek(page, "Third")

    walked = strip(page)
    say(f"[trail] where the tab has been: {json.dumps(walked['trail'])} at {walked['at']}")
    shot(page, "10-walked")

    if walked["trail"] != ["First.md", "Second.md", "Third.md"]:
        wrong(f"the tab did not write down where it has been: {walked['trail']}")
    if walked["steps"] != [False, True]:
        wrong(f"the arrows do not say where it can go: {walked['steps']}")

    page.locator(".step").first.click()
    page.wait_for_timeout(600)
    once = strip(page)
    say(f"[trail] one step back: showing {once['showing']}, at {once['at']}")
    shot(page, "11-back")
    if once["showing"] != "Second.md":
        wrong(f"back did not go back: {once['showing']}")
    if once["steps"] != [False, False]:
        wrong(f"the arrows do not say both ways are open: {once['steps']}")

    page.locator(".step").first.click()
    page.wait_for_timeout(600)
    twice = strip(page)
    say(f"[trail] two steps back: showing {twice['showing']}, at {twice['at']}")
    if twice["showing"] != "First.md":
        wrong(f"the second step back did not go back: {twice['showing']}")
    if twice["steps"] != [True, False]:
        wrong(f"the far end of the trail is not the far end: {twice['steps']}")

    page.locator(".cm-content").click()
    page.keyboard.press("Alt+ArrowRight")
    page.wait_for_timeout(600)
    on = strip(page)
    say(f"[trail] forward by key: showing {on['showing']}")
    shot(page, "12-forward")
    if on["showing"] != "Second.md":
        wrong(f"Alt and an arrow did not go forward: {on['showing']}")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const one of [...ws.tabs]) if (one.id !== ws.activeTabId) ws.close(one.id)
        }"""
    )
    page.wait_for_timeout(250)

    peek(page, "Daily")
    turned = strip(page)
    say(f"[trail] after turning off it: {json.dumps(turned['trail'])} at {turned['at']}")
    shot(page, "13-turned-off")
    if turned["trail"] != ["First.md", "Second.md", "Daily.md"]:
        wrong(f"the road not taken was kept: {turned['trail']}")

    page.locator(".step").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.rows .nib-row')].map((row) => row.textContent.trim())"
    )
    say(f"[trail] behind the back arrow: {json.dumps(rows)}")
    shot(page, "14-the-trail")
    if rows != ["Second", "First"]:
        wrong(f"the trail does not read newest first: {rows}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        say("--- a tab that remembers ---")
        drive_trail(browser)

    return DRIVE.verdict("a tab can go back where it came from")

if __name__ == "__main__":
    raise SystemExit(main())
