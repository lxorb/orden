from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PHONE_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)

BAR_SEEN = """
() => {
  const bar = document.querySelector('[data-phone-tabs]')
  if (!bar) return false
  const box = bar.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return !!hit && bar.contains(hit)
}
"""


COVERED = """
() => {
  const bar = document.querySelector('[data-phone-tabs]').getBoundingClientRect()
  return [...document.querySelectorAll('[data-notices] > *')].some((one) => {
    const box = one.getBoundingClientRect()
    return box.height > 0 && box.bottom > bar.top
  })
}
"""


def bar_seen(page: Page) -> bool:
    return bool(page.evaluate(BAR_SEEN))


def tab(page: Page, name: str) -> None:
    page.locator(f"[data-phone-tabs] [data-tab={name}]").tap()
    wait_for(page, f"window.ordenApp.workspace.panel === {name!r}", f"the {name} tab")
    page.wait_for_timeout(400)


def laptop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(300)
    if page.locator("[data-phone-tabs]").count():
        wrong("[laptop] a phone's tab bar on a laptop")
    if not page.locator('[role="tablist"][aria-label="Panels"]').count():
        wrong("[laptop] the panel strip went")
    page.context.close()


def phone(browser: Browser, dark: bool) -> None:
    tag = "dark-" if dark else ""
    context = DRIVE.context(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="dark" if dark else "light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    DRIVE.seed(page, "# Groceries\n\nmilk and eggs")
    DRIVE.todos(page, "- [ ] milk\n- [ ] eggs\n")
    DRIVE.seed(page, "# Ideas\n\nA thought")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)

    if page.locator('.panels:not(.right) [role="tablist"][aria-label="Panels"]').count():
        wrong("[phone] the desktop's panel strip is still drawn")
    tabs = page.locator("[data-phone-tabs] [data-tab]").evaluate_all("(all) => all.map((one) => one.dataset.tab)")
    say(f"[phone] tabs: {tabs}")
    if tabs[:2] != ["tree", "tasks"] or "search" not in tabs:
        wrong(f"[phone] the tab bar holds {tabs}")
    if not bar_seen(page):
        wrong("[phone] the tab bar is not seen over the notes")
    DRIVE.shot(page, f"{tag}notes")

    page.locator("[data-panel=tree]").get_by_text("Groceries").first.tap()
    wait_for(page, "window.ordenApp.workspace.active?.note?.name?.startsWith('Groceries')", "the note")
    wait_for(page, "window.ordenApp.workspace.panel === null", "the note on its own")
    page.wait_for_timeout(500)
    if bar_seen(page):
        wrong("[phone] the tab bar is over the note")
    if not page.locator("[data-phone-back]").is_visible():
        wrong("[phone] no back button in the note's bar")
    page.locator(".cm-content").tap()
    page.keyboard.press("Control+End")
    page.keyboard.type("\nbread")
    wait_for(page, "window.ordenApp.workspace.active?.doc?.includes('bread')", "the line written")
    DRIVE.shot(page, f"{tag}note")

    if page.locator("header .search").is_visible():
        wrong("[phone] the note's bar still has the search glyph, which is a tab now")
    page.locator("[data-phone-more]").tap()
    page.locator('[role="menuitem"]:has-text("Outline")').wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(300)
    DRIVE.shot(page, f"{tag}note-more")
    page.locator('[role="menuitem"]:has-text("Outline")').tap()
    wait_for(page, "window.ordenApp.workspace.openOn('right') === 'outline'", "the outline")
    page.wait_for_timeout(400)
    DRIVE.shot(page, f"{tag}note-outline")
    page.evaluate("() => window.ordenApp.workspace.closeRight()")
    page.wait_for_timeout(400)

    page.locator("[data-phone-back]").tap()
    wait_for(page, "window.ordenApp.workspace.panel === 'tree'", "back on the notes")
    page.wait_for_timeout(400)
    if not bar_seen(page):
        wrong("[phone] back did not bring the tab bar")

    tab(page, "tasks")
    wait_for(page, "document.querySelector('[data-panel=tasks]')?.innerText.includes('milk')", "the tasks listed")
    page.locator("[data-panel=tasks] [role=checkbox]").first.tap()
    wait_for(
        page,
        "async () => { const tasks = await window.ordenApp.tasks(); const text = await window.ordenApp.workspace.noteText(await tasks.rows.inbox()); return (text ?? '').includes('- [x]') }",
        "a task ticked off",
    )
    page.wait_for_timeout(300)
    if page.evaluate(COVERED):
        wrong("[phone] a notice covers the tab bar")
    DRIVE.shot(page, f"{tag}tasks")

    page.locator("[data-panel=tasks] .where").last.tap()
    wait_for(page, "window.ordenApp.workspace.panel === null", "the task's note")
    page.wait_for_timeout(400)
    page.locator("[data-phone-back]").tap()
    wait_for(page, "window.ordenApp.workspace.panel === 'tasks'", "back on the tasks, where it came from")

    tab(page, "search")
    field = page.locator("[data-panel=search] input").first
    field.tap()
    field.fill("thought")
    wait_for(page, "document.querySelector('[data-panel=search] .hit')", "a hit")
    page.wait_for_timeout(300)
    DRIVE.shot(page, f"{tag}search")
    page.locator("[data-panel=search] .hit").first.tap()
    wait_for(page, "window.ordenApp.workspace.active?.note?.name?.startsWith('Ideas')", "the note found")

    page.locator("[data-phone-back]").tap()
    wait_for(page, "window.ordenApp.workspace.panel === 'search'", "back on the search")
    tab(page, "tree")
    if page.locator('[data-region="foot"]').count():
        wrong("[phone] the desktop's sidebar foot is still drawn")
    before = page.evaluate("window.ordenApp.workspace.active?.id")
    page.locator(".panels:not(.right) button[aria-label='New note']").tap()
    wait_for(
        page,
        f"window.ordenApp.workspace.panel === null && window.ordenApp.workspace.active?.id !== {before!r}"
        " && window.ordenApp.workspace.active?.doc === ''",
        "a new note",
    )
    page.wait_for_timeout(500)
    page.keyboard.type("Kestrel")
    wait_for(page, "window.ordenApp.workspace.active?.doc?.includes('Kestrel')", "the new note written")
    DRIVE.shot(page, f"{tag}new-note")

    page.locator("[data-phone-back]").tap()
    wait_for(page, "window.ordenApp.workspace.panel === 'tree'", "back on the notes")
    page.wait_for_timeout(300)
    page.locator("[data-phone-you]").tap()
    page.locator('[role="menuitem"]:has-text("Settings")').wait_for(state="visible", timeout=5000)
    DRIVE.shot(page, f"{tag}you")
    page.locator('[role="menuitem"]:has-text("Settings")').tap()
    wait_for(page, """document.querySelector('[role="region"][aria-label="Settings"]')""", "the settings")
    context.close()


def drive(browser: Browser) -> None:
    laptop(browser)
    phone(browser, False)
    phone(browser, True)


if __name__ == "__main__":
    raise SystemExit(
        DRIVE.run(drive, "a phone gets around by a tab bar, and a note pushed over it comes back by a back button")
    )
