from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PLAN = "# Plan\n\nWhat we are doing this week, and why it matters.\n"

RIGHT = 'header [data-side-toggle="right"]'
PAD_TAB = '[data-tab="scratchpad"]'
YOU = "[data-phone-you]"
PAD_ITEM = '[role="menuitem"]:has-text("Scratchpad")'
CARD = "[data-scratchpad-card] .cm-content"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

ON_TOP = """() => {
  const card = document.querySelector('[data-scratchpad]')?.getBoundingClientRect()
  if (!card || !card.width || !card.height) return false
  const at = document.elementFromPoint(card.x + card.width / 2, card.y + card.height / 2)
  return !!at?.closest('[data-scratchpad-card]')
}"""

STATE = """() => ({
  pressed: document.querySelector('[data-tab="scratchpad"]')?.getAttribute('aria-selected') ?? 'false',
  card: !!document.querySelector('[data-scratchpad-card] .cm-content'),
  inCard: !!document.activeElement?.closest('[data-scratchpad-card]'),
  inNote: !!document.activeElement?.closest('[data-panes]'),
  tabs: window.nibApp.workspace.tabs.map((one) => one.name),
  words: document.querySelector('[data-scratchpad-card] .cm-content')?.textContent ?? null,
})"""

def opened(browser: Browser, scheme: str, phone: bool = False) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if phone else {"width": 1280, "height": 800},
        color_scheme=scheme,
        has_touch=phone,
        is_mobile=phone,
        **({"user_agent": PHONE_AGENT} if phone else {}),
    )
    DRIVE.open(page)
    DRIVE.seed(page, PLAN)
    DRIVE.open_note(page, "Plan")
    return page

def show_pad(page: Page) -> None:
    if not page.locator(PAD_TAB).is_visible():
        page.locator(RIGHT).click()
        page.locator(PAD_TAB).wait_for(state="visible", timeout=5000)
    if page.locator(PAD_TAB).get_attribute("aria-selected") != "true":
        page.locator(PAD_TAB).click()

def pad_on_phone(page: Page) -> None:
    if not page.locator(YOU).is_visible():
        page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
        page.locator(YOU).wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(400)
    page.locator(YOU).tap()
    page.locator(PAD_ITEM).wait_for(state="visible", timeout=5000)
    page.locator(PAD_ITEM).tap()
    page.wait_for_timeout(300)
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel) ws.closePanel() }")

def gone(page: Page) -> None:
    try:
        page.wait_for_function(f"!document.querySelector('{CARD}')", timeout=3000, polling=50)
    except Exception:  # noqa: BLE001 - still up, which the check after this says
        pass

def no_tab(page: Page, where: str) -> None:
    tabs = page.evaluate(STATE)["tabs"]
    if any("Scratchpad" in one for one in tabs):
        wrong(f"[{where}] the scratchpad is in the tab strip: {tabs}")

def desktop(browser: Browser, scheme: str) -> None:
    page = opened(browser, scheme)
    shot(page, f"{scheme}/01-the-switch")
    if page.evaluate(STATE)["pressed"] != "false":
        wrong(f"[{scheme}] the switch reads as pressed before it is")

    page.locator(".cm-content").first.click()
    show_pad(page)
    wait_for(page, f"document.querySelector('{CARD}')", "the card")
    page.wait_for_timeout(350)
    state = page.evaluate(STATE)
    say(f"[{scheme}] shown: {state}")
    if state["pressed"] != "true" or not state["inCard"]:
        wrong(f"[{scheme}] the card did not come up with the keyboard in it: {state}")
    no_tab(page, scheme)

    page.keyboard.type("A thought before it has a home")
    page.wait_for_timeout(200)
    shot(page, f"{scheme}/02-the-card")

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    gone(page)
    state = page.evaluate(STATE)
    say(f"[{scheme}] after Escape: {state}")
    if state["card"] or state["pressed"] != "false" or not state["inNote"]:
        wrong(f"[{scheme}] Escape left the card up or the keyboard nowhere: {state}")
    shot(page, f"{scheme}/03-escape")

    page.keyboard.press("Control+Shift+X")
    wait_for(page, f"document.querySelector('{CARD}')", "the card from the key")
    page.wait_for_timeout(350)
    state = page.evaluate(STATE)
    if "A thought before it has a home" not in (state["words"] or ""):
        wrong(f"[{scheme}] the words did not come back with the card: {state}")
    if not state["inCard"]:
        wrong(f"[{scheme}] the key did not put the keyboard in the card")

    page.wait_for_timeout(1200)
    page.reload()
    DRIVE.ready(page)
    wait_for(page, f"document.querySelector('{CARD}')", "the card after a reload")
    page.wait_for_timeout(400)
    state = page.evaluate(STATE)
    say(f"[{scheme}] after a reload: {state}")
    if "A thought before it has a home" not in (state["words"] or ""):
        wrong(f"[{scheme}] the words were lost over a reload")
    no_tab(page, f"{scheme} reload")
    shot(page, f"{scheme}/04-after-a-reload")

    page.locator(RIGHT).click()
    page.wait_for_timeout(400)
    gone(page)
    if page.evaluate(STATE)["card"]:
        wrong(f"[{scheme}] the right side's button did not put the card away")
    page.context.close()

def phone(browser: Browser) -> None:
    page = opened(browser, "light", phone=True)
    if page.evaluate("document.documentElement.dataset.device") != "phone":
        wrong("[phone] the page is not laid out as a phone")
    if page.locator(f"header {PAD_TAB}, header [aria-label='Scratchpad']").count():
        wrong("[phone] the bar has a switch of the scratchpad's, which is the drawer's (#1030)")
    pad_on_phone(page)
    wait_for(page, f"document.querySelector('{CARD}')", "the card on a phone")
    page.wait_for_timeout(400)
    if not page.evaluate(ON_TOP):
        wrong("[phone] the card is up but something else is drawn over it")
    page.wait_for_timeout(400)
    sizes = page.evaluate(
        """() => {
      const card = document.querySelector('[data-scratchpad] .card')?.getBoundingClientRect()
      const panes = document.querySelector('[data-panes]')?.getBoundingClientRect()
      return card && panes ? { card: [card.x, card.width], panes: [panes.x, panes.width] } : null
    }"""
    )
    if not sizes or abs(sizes["card"][0] - sizes["panes"][0]) > 1 or sizes["card"][1] < sizes["panes"][1] - 1:
        wrong(f"[phone] the scratchpad is beside the note rather than the note there is: {sizes}")
    if page.locator("header .title .name").inner_text() != "Scratchpad":
        wrong("[phone] the bar does not name the scratchpad while it is the note on screen")
    no_tab(page, "phone")
    shot(page, "light/05-a-phone")
    page.context.close()

UNDER = """() => {
  const bar = document.querySelector('.cluster')
  const panes = document.querySelector('[data-panes]')
  const box = bar?.getBoundingClientRect()
  const hit = box && box.width
    ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    : null
  return {
    barSeen: !!hit && !!hit.closest('.cluster'),
    panesHidden: !!panes && getComputedStyle(panes).visibility === 'hidden',
    panesInert: !!panes?.inert,
  }
}"""

COLUMN = """(where) => {
  const content = document.querySelector(`${where} .cm-content`)
  if (!content) return null
  const style = getComputedStyle(content)
  return { left: Math.round(content.getBoundingClientRect().x), top: style.paddingTop, measure: style.maxWidth }
}"""

def over_a_drawing(browser: Browser) -> None:
    page = opened(browser, "light", phone=True)
    note = page.evaluate(COLUMN, "[data-panes]")
    say(f"[phone] a note's column: {note}")
    for kind, make in (("canvas", "createCanvas"), ("page note", "createPages")):
        page.evaluate(f"() => window.nibApp.workspace.{make}()")
        wait_for(page, "document.querySelector('.cluster')", f"the {kind}'s bar")
        page.wait_for_timeout(400)
        pad_on_phone(page)
        wait_for(page, f"document.querySelector('{CARD}')", f"the scratchpad over the {kind}")
        page.wait_for_timeout(500)

        under = page.evaluate(UNDER)
        say(f"[phone, {kind}] under the scratchpad: {under}")
        if under["barSeen"] or not under["panesHidden"] or not under["panesInert"]:
            wrong(f"[phone] the {kind}'s bar is still there over the scratchpad: {under}")
        if not page.evaluate(ON_TOP):
            wrong(f"[phone] something is drawn over the scratchpad on a {kind}")
        if not page.locator("header .title .mark").count():
            wrong(f"[phone] the bar names the scratchpad over a {kind} without a note's mark")

        column = page.evaluate(COLUMN, "[data-scratchpad]")
        if not note or not column or column != note:
            wrong(f"[phone] the scratchpad's words are not in a note's column ({column}, not {note})")

        page.locator(CARD).tap()
        page.evaluate("() => { window.nibApp.viewport.keyboard = 300; window.nibApp.viewport.typing = true }")
        wait_for(page, "document.querySelector('.nib-bar.docked')", f"the strip over the keyboard on a {kind}")
        page.keyboard.type("Pad words")
        page.keyboard.press("Home")
        page.keyboard.press("Shift+End")
        bold = page.locator(".nib-bar.docked button[aria-label='Bold']").first
        if bold.count():
            bold.tap()
            page.wait_for_timeout(300)
            if "**Pad words**" not in (page.evaluate(STATE)["words"] or ""):
                wrong(f"[phone] Bold on the strip did not format the scratchpad over a {kind}")
        shot(page, f"light/06-over-a-{kind.replace(' ', '-')}")
        page.evaluate("() => { window.nibApp.viewport.keyboard = 0; window.nibApp.viewport.typing = false }")

        pad_on_phone(page)
        page.wait_for_timeout(600)
        back = page.evaluate(UNDER)
        kinds = {"canvas": "canvas", "page note": "pages"}
        if page.evaluate("() => window.nibApp.workspace.active?.kind") != kinds[kind] or not back["barSeen"]:
            wrong(f"[phone] putting the scratchpad away did not give the {kind} back: {back}")
        shot(page, f"light/07-the-{kind.replace(' ', '-')}-again")
        say(f"[phone] the scratchpad over a {kind} is a note like any other, and the {kind} comes back")
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            desktop(browser, scheme)
        say("--- a phone ---")
        phone(browser)
        say("--- a phone, over a drawing ---")
        over_a_drawing(browser)
    return DRIVE.verdict("the scratchpad is a card on the right side or a phone's one note, never a tab")

if __name__ == "__main__":
    raise SystemExit(main())
