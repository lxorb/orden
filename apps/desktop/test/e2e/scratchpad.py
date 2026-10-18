"""The scratchpad as a switch and a card, never a tab, seen in light and dark.

Emil, 2026-10-05: "The scratchpad should never open as a tab. It should be basically a
thing in the top right that you can click, and then it is selected or it isn't." So the
glyph at the bar's top right shows a card docked under it, Escape and the glyph put it
away and give the keyboard back to the note, Ctrl+Shift+X calls it, a reload keeps it
up with its words, and nothing of it is ever in the tab strip. On a phone it is the one
note on the screen, all of where the note is and named in the bar, never a card beside the
note (#206: "it should display as the only open note on mobile"). Over a canvas or a
page note it is a markdown note like any other: nothing of the drawing is left on the
screen, and putting it away gives the drawing back (#404).

    python apps/desktop/test/e2e/scratchpad.py

Screenshots go beside this file under `shots/scratchpad/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PLAN = "# Plan\n\nWhat we are doing this week, and why it matters.\n"

GLYPH = "header button.pad"
CARD = "[data-scratchpad] .cm-content"

# A phone says so in its user agent, and only then is the layout a phone's: with the
# headless desktop agent, a narrow touch window is still a desktop with a strip of tabs.
# See `deviceFor` in viewport.svelte.ts.
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

# What is drawn in the middle of the card, so a card under something else is caught.
ON_TOP = """() => {
  const card = document.querySelector('[data-scratchpad]')?.getBoundingClientRect()
  if (!card || !card.width || !card.height) return false
  const at = document.elementFromPoint(card.x + card.width / 2, card.y + card.height / 2)
  return !!at?.closest('[data-scratchpad]')
}"""

STATE = """() => ({
  pressed: document.querySelector('header button.pad')?.getAttribute('aria-pressed'),
  card: !!document.querySelector('[data-scratchpad] .cm-content'),
  inCard: !!document.activeElement?.closest('[data-scratchpad]'),
  inNote: !!document.activeElement?.closest('[data-panes]'),
  tabs: window.nibApp.workspace.tabs.map((one) => one.name),
  words: document.querySelector('[data-scratchpad] .cm-content')?.textContent ?? null,
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
    page.locator(GLYPH).click()
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

    # A reload keeps the card up and its words, and puts no tab back.
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

    page.locator(GLYPH).click()
    page.wait_for_timeout(400)
    if page.evaluate(STATE)["card"]:
        wrong(f"[{scheme}] the switch did not put the card away")
    page.context.close()


def phone(browser: Browser) -> None:
    page = opened(browser, "light", phone=True)
    if page.evaluate("document.documentElement.dataset.device") != "phone":
        wrong("[phone] the page is not laid out as a phone")
    page.locator(GLYPH).tap()
    wait_for(page, f"document.querySelector('{CARD}')", "the card on a phone")
    page.wait_for_timeout(400)
    if not page.evaluate(ON_TOP):
        wrong("[phone] the card is up but something else is drawn over it")
    # Settled, it is all of where the note was: nothing of the note beside it.
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


# Whether anything of the document under the scratchpad can be seen or pressed: the
# canvas's bar or the page note's, read where it would be drawn.
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

# Where a note's words start and how wide they may run, which is what makes it read
# as a note: the editor's own column, in the note's pane or in the scratchpad.
COLUMN = """(where) => {
  const content = document.querySelector(`${where} .cm-content`)
  if (!content) return null
  const style = getComputedStyle(content)
  return { left: Math.round(content.getBoundingClientRect().x), top: style.paddingTop, measure: style.maxWidth }
}"""


def over_a_drawing(browser: Browser) -> None:
    """On a phone the scratchpad over a canvas or a page note is a markdown note like
    any other: nothing of the drawing under it is drawn or pressed, its words sit in a
    note's column, the strip over the keyboard formats it, and putting it away is the
    drawing again (#404)."""
    page = opened(browser, "light", phone=True)
    note = page.evaluate(COLUMN, "[data-panes]")
    say(f"[phone] a note's column: {note}")
    for kind, make in (("canvas", "createCanvas"), ("page note", "createPages")):
        page.evaluate(f"() => window.nibApp.workspace.{make}()")
        wait_for(page, "document.querySelector('.cluster')", f"the {kind}'s bar")
        page.wait_for_timeout(400)
        page.locator(GLYPH).tap()
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

        # The strip over the keyboard formats the scratchpad, as it does any note.
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

        page.locator(GLYPH).tap()
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
    return DRIVE.verdict("the scratchpad is a switch and a card, never a tab")


if __name__ == "__main__":
    raise SystemExit(main())
