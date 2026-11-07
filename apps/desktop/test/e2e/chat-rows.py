from __future__ import annotations

from playwright.sync_api import Browser

from harness import CHATS_ON, Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SEED = """async () => {
  const chat = await window.ordenApp.aiChats()
  const now = Date.now()
  const head = (id, title, state, mins, more = {}) => ({
    id, title, state, provider: 'x', model: 'claude-sonnet', updated: now - mins * 60000,
    words: '', space: 'any', ...more,
  })
  chat.every = [
    head('long', 'A very long title for a chat that will surely not fit in its row, however wide the side is made to stand', 'interrupted', 3),
    head('short', 'Short', 'done', 40, { answered: now, seen: 0 }),
    head('stuck', 'Waiting on a reply', 'needs-input', 600),
  ]
}"""

MEASURE = """() => [...document.querySelectorAll('.threads .item')].map((item) => {
  const box = (selector) => item.querySelector(selector).getBoundingClientRect()
  const title = item.querySelector('.title')
  const gap = parseFloat(getComputedStyle(item.querySelector('.tail')).columnGap)
  return {
    id: title.textContent, gap,
    state: box('.state'), when: box('.when'), acts: box('.acts'), title: box('.title'), row: box('.row'),
    ellipsized: title.scrollWidth > title.clientWidth,
    acting: getComputedStyle(item.querySelector('.acts')).opacity === '1',
    timed: getComputedStyle(item.querySelector('.when')).visibility !== 'hidden',
  }
})"""

NEAR = 1.0

def near(one: float, other: float) -> bool:
    return abs(one - other) <= NEAR

def drive(browser: Browser) -> None:
    for width in (240, 420):
        context = browser.new_context(viewport={"width": 1400, "height": 820})
        context.add_init_script(CHATS_ON)
        context.add_init_script(f"localStorage.setItem('orden:sidebar-width-right', '{width}')")
        page = context.new_page()
        DRIVE.open(page)
        page.keyboard.press("Control+Shift+A")
        page.locator('button[aria-label="Chats"]').last.click()
        wait_for(page, "document.querySelector('.threads')", "the list of chats")
        page.wait_for_timeout(1000)
        page.evaluate(SEED)
        wait_for(page, "document.querySelectorAll('.threads .item').length === 3", "three rows")
        page.mouse.move(700, 400)
        page.wait_for_timeout(300)
        rest = page.evaluate(MEASURE)

        for at, still in enumerate(rest):
            name = f"{width}px, {still['id']!r}"
            if still["title"]["right"] > still["state"]["left"] - still["gap"] + NEAR:
                wrong(f"{name}: the title runs into the end group")
            if not near(still["when"]["left"] - still["state"]["right"], still["gap"]):
                wrong(f"{name}: the time is not at the row's gap after the state")
            if still["acting"] or not still["timed"]:
                wrong(f"{name}: at rest the actions show or the time does not")

            page.locator(".threads .item").nth(at).hover()
            page.wait_for_timeout(250)
            pointed = page.evaluate(MEASURE)[at]
            if not near(pointed["acts"]["left"] - pointed["state"]["right"], pointed["gap"]):
                wrong(
                    f"{name}: pointed at, {pointed['acts']['left'] - pointed['state']['right']:.1f}px "
                    f"between the state and the actions, not the row's {pointed['gap']}px"
                )
            if not near(pointed["state"]["right"], still["state"]["right"]):
                wrong(f"{name}: the state moved sideways when pointed at")
            if not pointed["acting"] or pointed["timed"]:
                wrong(f"{name}: pointed at, the actions do not take the time's place")
            if pointed["acts"]["right"] > pointed["row"]["right"]:
                wrong(f"{name}: the actions run past the row")
        long = [one for one in rest if one["id"].startswith("A very long")]
        if not long or not long[0]["ellipsized"]:
            wrong(f"{width}px: the long title is not cut short")
        say(f"{width}px: {len(rest)} rows, the end group tight at rest and pointed at")
        DRIVE.shot(page, f"pointed-{width}")

        page.evaluate("() => document.documentElement.setAttribute('data-touch', '')")
        page.mouse.move(700, 400)
        page.wait_for_timeout(250)
        for touched in page.evaluate(MEASURE):
            if not touched["acting"] or touched["timed"]:
                wrong(f"{width}px, {touched['id']!r}: on a touch screen the actions are not in the time's place")
            if not near(touched["acts"]["left"] - touched["state"]["right"], touched["gap"]):
                wrong(f"{width}px, {touched['id']!r}: on a touch screen the actions leave a gap")
        say(f"{width}px: on a touch screen the actions stand in the time's place")
        context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the chat rows keep their end group tight, at rest, pointed at and touched"))
