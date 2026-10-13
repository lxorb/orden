"""Source mode is each pane's own, seen in the built app (issue #232).

What this drives:

  * One note split beside itself, and Ctrl+/ pressed in the right pane only: the right
    pane shows the markdown as written and the left one goes on showing the live
    preview, on the same document.
  * The two faces come back as they were after a reload, which is what a restart is.

Run it from the repository root:

    python apps/desktop/test/e2e/source-split.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/source-split/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = (
    "# Plan\n\n"
    "Some **bold** words, a little *emphasis* and a [link](https://example.com).\n\n"
    "- [ ] one thing\n"
    "- [x] another\n\n"
    "> A quote to finish on.\n"
)

# Each pane, left to right: whether its words still carry the marks, and the tab's own
# answer for source mode.
FACES = """
() => {
  const ws = window.nibApp.workspace
  return ws.panes.all.map((pane) => {
    const words = document.querySelector(`[data-pane="${pane.id}"] .cm-content`)?.innerText ?? ''
    return { raw: words.includes('**bold**'), source: ws.showing(pane.id)?.source ?? null }
  })
}
"""


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


def faces(page: Page) -> list[dict]:
    return page.evaluate(FACES)  # type: ignore[no-any-return]


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1400, "height": 820}, color_scheme="light")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Plan")

    page.evaluate("() => window.nibApp.workspace.split('row')")
    wait_for(page, "document.querySelectorAll('.pane .cm-content').length === 2", "two editors")
    right = page.evaluate("() => window.nibApp.workspace.panes.focusedId")
    page.evaluate(f"() => document.querySelector('[data-pane=\"{right}\"] .cm-content').focus()")
    page.keyboard.press("Control+/")
    wait_for(page, f"({FACES})()[1]?.raw", "the right pane in source mode")

    seen = faces(page)
    say(f"[split] {json.dumps(seen)}")
    if seen != [{"raw": False, "source": False}, {"raw": True, "source": True}]:
        wrong(f"Ctrl+/ in the right pane did not turn that pane alone: {seen}")
    shot(page, "01-two-faces")

    page.reload()
    wait_for(
        page,
        "window.nibApp?.workspace.panes.count === 2"
        " && document.querySelectorAll('.pane .cm-content').length === 2",
        "both panes after the reload",
    )
    wait_for(page, f"({FACES})()[1]?.raw", "the right pane back in source mode")
    seen = faces(page)
    say(f"[reload] {json.dumps(seen)}")
    if seen != [{"raw": False, "source": False}, {"raw": True, "source": True}]:
        wrong(f"the two faces did not survive a reload: {seen}")
    shot(page, "02-after-reload")

    # Settings says where a new tab starts, and leaves the tabs already open alone.
    page.evaluate("() => window.nibApp.settings.show('markdown')")
    row = page.get_by_role("switch", name="Open notes in source mode")
    row.wait_for()
    row.scroll_into_view_if_needed()
    row.click()
    if row.get_attribute("aria-checked") != "true":
        wrong("the switch did not take")
    shot(page, "03-settings")
    page.keyboard.press("Escape")

    seen = faces(page)
    if seen != [{"raw": False, "source": False}, {"raw": True, "source": True}]:
        wrong(f"Settings changed a tab that was already open: {seen}")
    # In the left pane, whose tab is not in source mode, so a tab that only took the
    # next note on could not pass for a new one.
    page.evaluate("() => window.nibApp.workspace.focusPane(window.nibApp.workspace.panes.all[0].id)")
    DRIVE.seed(page, "# Fresh\n\nA **new** note.\n")
    DRIVE.open_note(page, "Fresh")
    fresh = page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const plan = ws.tabs.filter((one) => one.name === 'Plan.md').map((one) => one.source)
          return { fresh: ws.active.source, plan }
        }"""
    )
    say(f"[settings] {json.dumps(fresh)}")
    if fresh != {"fresh": True, "plan": [False, True]}:
        wrong(f"a tab opened after the switch is not in source mode beside the two: {fresh}")
    shot(page, "04-new-tab")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "each pane keeps its own source mode"))
