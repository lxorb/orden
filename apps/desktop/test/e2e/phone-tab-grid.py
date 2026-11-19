from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONE_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
SHOWN = "window.ordenApp.workspace.active?.shown"
def names(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.tabs.map((tab) => tab.shown)")
def open_note(page: Page, name: str) -> None:
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    wait_for(page, "window.ordenApp.workspace.panel === 'tree'", "the notes")
    page.wait_for_timeout(300)
    page.locator("[data-panel=tree]").get_by_text(name).first.tap()
    wait_for(page, f"{SHOWN} === {name!r} && window.ordenApp.workspace.panel === null", name)
    page.wait_for_timeout(400)
def swipe(page: Page, selector: str, dx: int) -> None:
    box = page.locator(selector).first.bounding_box()
    if not box:
        wrong(f"nothing at {selector} to swipe")
        return
    page.evaluate(
        """([selector, dx]) => {
          const node = document.querySelector(selector)
          const box = node.getBoundingClientRect()
          const y = box.top + box.height / 2
          const x = box.left + box.width / 2
          const fire = (type, at) => node.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: at, clientY: y,
          }))
          fire('pointerdown', x)
          for (let step = 1; step <= 6; step++) fire('pointermove', x + (dx * step) / 6)
          fire('pointerup', x + dx)
        }""",
        [selector, dx],
    )
    page.wait_for_timeout(500)
def phone(browser: Browser, dark: bool, width: int, height: int) -> None:
    tag = f"{'dark-' if dark else ''}{width}-"
    context = DRIVE.context(
        browser,
        viewport={"width": width, "height": height},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="dark" if dark else "light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    DRIVE.seed(
        page,
        "# Groceries\n\nmilk and eggs\nbread\ncoffee",
        "# Ideas\n\nA thought about tabs that behave like the ones in Safari.",
        "# Trip\n\n- passport\n- tickets\n- charger",
    )
    for name in ["Groceries", "Ideas", "Trip"]:
        open_note(page, name)
    held = names(page)
    say(f"[{tag}] {page.evaluate('window.ordenApp.viewport?.device')} tabs: {held}")
    if not {"Groceries", "Ideas", "Trip"} <= set(held):
        wrong(f"[{tag}] opening three notes left {held}")
    count = page.locator("[data-tabs-button]").inner_text().strip()
    if count != str(len(held)):
        wrong(f"[{tag}] the tabs button says {count!r} for {len(held)} tabs")
    DRIVE.shot(page, f"{tag}note")
    swipe(page, "header h1.title", 120)
    wait_for(page, f"{SHOWN} === 'Ideas'", "the tab before, by a swipe to the right")
    swipe(page, "header h1.title", -120)
    wait_for(page, f"{SHOWN} === 'Trip'", "the next tab, by a swipe to the left")
    if page.evaluate("window.ordenApp.workspace.panel") is not None:
        wrong(f"[{tag}] a swipe across the title pulled the notes list in")
    page.locator("[data-tabs-button]").tap()
    page.locator("[data-tab-grid]").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(400)
    cards = page.locator("[data-tab-grid] [data-tab-card]").count()
    if cards != len(held):
        wrong(f"[{tag}] the grid shows {cards} cards for {len(held)} tabs")
    if "tabs" not in page.locator("[data-tab-grid] .count").inner_text():
        wrong(f"[{tag}] the grid's bar does not count the tabs")
    DRIVE.shot(page, f"{tag}grid")
    ideas = page.evaluate(
        "() => window.ordenApp.workspace.tabs.find((tab) => tab.shown === 'Ideas').id"
    )
    swipe(page, f"[data-tab-card='{ideas}']", -200)
    wait_for(page, "!window.ordenApp.workspace.tabs.some((tab) => tab.shown === 'Ideas')", "a card flung away")
    page.wait_for_timeout(400)
    DRIVE.shot(page, f"{tag}grid-flung")
    page.locator("[data-tab-grid] [data-tab-card]").filter(has_text="Groceries").locator(".page").tap()
    wait_for(page, f"{SHOWN} === 'Groceries'", "the card tapped")
    wait_for(page, "!document.querySelector('[data-tab-grid]')", "the grid gone")
    page.locator("[data-tabs-button]").tap()
    page.locator("[data-tab-grid]").wait_for(state="visible", timeout=5000)
    page.locator("[data-tab-grid] .bar .plus").tap()
    wait_for(
        page,
        "!document.querySelector('[data-tab-grid]') && window.ordenApp.workspace.active?.doc === ''",
        "a new note from the grid",
    )
    page.keyboard.type("Kestrel")
    wait_for(page, "window.ordenApp.workspace.active?.doc?.includes('Kestrel')", "the new note written")
    if not {"Groceries", "Trip"} <= set(names(page)):
        wrong(f"[{tag}] a new note put the others away: {names(page)}")
    page.locator("[data-tabs-button]").tap()
    page.locator("[data-tab-grid]").wait_for(state="visible", timeout=5000)
    page.locator("[data-tab-grid] .done").tap()
    wait_for(page, "!document.querySelector('[data-tab-grid]')", "Done shuts the grid")
    context.close()
def laptop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    if page.locator("[data-tabs-button]").count():
        wrong("[laptop] a phone's tabs button on a laptop")
    page.context.close()
def drive(browser: Browser) -> None:
    laptop(browser)
    phone(browser, False, 390, 844)
    phone(browser, True, 390, 844)
    phone(browser, False, 320, 568)
    phone(browser, False, 820, 1180)
raise SystemExit(
    DRIVE.run(drive, "a phone keeps its notes as tabs, shows them as a grid, and a swipe walks or closes them")
)
