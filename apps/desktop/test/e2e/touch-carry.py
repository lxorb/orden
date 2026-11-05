"""A row carried by a thumb: held, then moved, it lands; a plain swipe still scrolls; and a
thumb swiping across a timeline bar scrolls the track and writes nothing. Real touch
through CDP, as Trello and Todoist are used: hold, then drag."""

from __future__ import annotations

import datetime

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

BASE = """filters: 'file.inFolder("Items")'
nib:
  properties:
    status:
      options:
        - { value: To do, tone: neutral }
        - { value: Doing, tone: info }
views:
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
  - type: timeline
    name: Time
    order: [file.name, note.status]
    nib: { date: note.start, end: note.end }
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

OPEN_VIEW = """async (view) => {
  const ws = window.nibApp.workspace
  for (const tab of ws.tabs.filter((one) => one.kind === 'view' && one.path)) await ws.closeAsking(tab.id)
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  window.tasks.openBaseFile(`${root}/Items.base`, {}, view)
}"""


def touch(cdp, kind, points):
    cdp.send(
        "Input.dispatchTouchEvent",
        {"type": kind, "touchPoints": [{"x": x, "y": y} for x, y in points]},
    )


def carried(page):
    return page.evaluate("() => !!document.querySelector('.is-carried')")


def box(page, selector, words):
    return page.evaluate(
        """([selector, words]) => {
          const found = [...document.querySelectorAll(selector)].find((one) =>
            one.textContent.trim().startsWith(words) && one.getBoundingClientRect().width > 0)
          if (!found) return null
          const at = found.getBoundingClientRect()
          return { x: at.x + at.width / 2, y: at.y + at.height / 2, width: at.width }
        }""",
        [selector, words],
    )


def in_column(page, words):
    return page.evaluate(
        """(words) => {
          for (const column of document.querySelectorAll('.column')) {
            const cards = [...column.querySelectorAll('.face')].map((one) => one.textContent.trim())
            if (cards.some((one) => one.startsWith(words))) return column.textContent.trim().slice(0, 12)
          }
          return null
        }""",
        words,
    )


def setup(browser, width, height):
    context = DRIVE.context(
        browser,
        viewport={"width": width, "height": height},
        user_agent=AGENT,
        has_touch=True,
        is_mobile=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    today = datetime.date.today()
    day = lambda n: (today + datetime.timedelta(days=n)).isoformat()
    files = [
        ["Items/A.md", f"---\nstatus: To do\nstart: {day(2)}T09:30\nend: {day(6)}T17:45\n---\n\nbody a\n"],
        ["Items/B.md", f"---\nstatus: Doing\nstart: {day(3)}\nend: {day(9)}\n---\n\nbody b\n"],
        ["Items.base", BASE],
    ]
    page.evaluate(WRITE, [files])
    page.wait_for_timeout(800)
    return context, page, context.new_cdp_session(page)


def board_on(browser, width, height, name):
    context, page, cdp = setup(browser, width, height)
    page.evaluate(OPEN_VIEW, "Board")
    wait_for(page, "() => document.querySelectorAll('.face').length >= 1", "the cards")
    page.wait_for_timeout(400)

    page.evaluate(
        """() => { window.__cancels = 0
          window.addEventListener('pointercancel', () => window.__cancels++, true) }"""
    )
    before = in_column(page, "A")
    a = box(page, ".face", "A")
    # A phone shows one column: the walk is across it, and what is asked is that it holds.
    b = box(page, ".face", "B") if name == "tablet" else {"x": a["x"] + 60, "y": a["y"] + 40}
    # A hold, then a walk to the other column.
    touch(cdp, "touchStart", [(a["x"], a["y"])])
    page.wait_for_timeout(450)
    if not carried(page):
        wrong(f"[{name}] a card held is not lifted")
    steps = 12
    for step in range(1, steps + 1):
        touch(
            cdp,
            "touchMove",
            [(a["x"] + (b["x"] - a["x"]) * step / steps, a["y"] + (b["y"] - a["y"]) * step / steps)],
        )
        page.wait_for_timeout(30)
    if not carried(page):
        wrong(f"[{name}] the drag was taken from the thumb on its first move")
    if page.evaluate("() => window.__cancels"):
        wrong(f"[{name}] the browser cancelled the pointer under a held drag")
    shot(page, f"board-{name}-carried")
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(900)
    after = in_column(page, "A")
    say(f"[{name}] A was in {before!r}, now {after!r}")
    if name == "tablet" and after == before:
        wrong(f"[{name}] the drop did not land: A is still in {before!r}")

    # A hold that does not move is the row's menu on a phone, a little after the lift.
    a = box(page, ".face", "A")
    touch(cdp, "touchStart", [(a["x"], a["y"])])
    page.wait_for_timeout(450)
    page.evaluate(
        """() => document.querySelector('.is-carried')?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))"""
    )
    if carried(page):
        wrong(f"[{name}] a row asked for its menu is still carried")
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # A swipe that does not hold is no drag at all.
    a = box(page, ".face", "A")
    touch(cdp, "touchStart", [(a["x"], a["y"])])
    for step in range(1, 9):
        touch(cdp, "touchMove", [(a["x"] - 12 * step, a["y"])])
        page.wait_for_timeout(16)
        if carried(page):
            wrong(f"[{name}] a swipe lifted a card")
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(500)
    # On a phone the columns are pages (#1046): the swipe turned it, and A is on the one before.
    if name == "phone":
        turned = page.evaluate("() => document.querySelector('.strip [aria-selected=true]')?.textContent")
        say(f"[{name}] a swipe across a card: the column is {turned!r}")
        if not turned or "Doing" not in turned:
            wrong(f"[{name}] a swipe across a card did not turn the column: {turned!r}")
    # And the swipe is the board's: a drawer that took it too stayed held over the page, as
    # the card it began on went with the column and its touchend reached nobody.
    if name == "phone":
        if page.evaluate("() => !!document.querySelector('.scrim')"):
            wrong(f"[{name}] a swipe on the board pulled a drawer out")
        page.locator('.strip [role="tab"]', has_text="To do").click()
        page.wait_for_timeout(300)
    if in_column(page, "A") != after:
        wrong(f"[{name}] a swipe moved a card")

    # The edge strip is the drawer's, as Google Docs' and Spotify's: with no button on the
    # bar it is the way to the file list from a board, and the column stays as it was.
    if name == "phone":
        column = page.evaluate("() => document.querySelector('.strip [aria-selected=true]')?.textContent")
        # On the column itself, the card it holds, not any margin beside it.
        left = page.evaluate(
            "() => document.querySelector('[data-turns-pages]').getBoundingClientRect().x"
        )
        start = box(page, ".face", "B")["y"] if in_column(page, "B") == column else 300
        x0, y0 = max(left + 2, 2), start
        say(f"[{name}] column starts at {left}, under ({x0}, {y0}):" + page.evaluate(
            "([x, y]) => { const e = document.elementFromPoint(x, y); return e.tagName + '.' + e.className + (e.closest('[data-turns-pages]') ? ' in the column' : ' outside') }",
            [x0, y0],
        ))
        touch(cdp, "touchStart", [(x0, y0)])
        for step in range(1, 13):
            touch(cdp, "touchMove", [(x0 + 26 * step, y0)])
            page.wait_for_timeout(16)
        touch(cdp, "touchEnd", [])
        page.wait_for_timeout(600)
        panel = page.evaluate("() => window.nibApp.workspace.panel")
        say(f"[{name}] from the edge strip: panel {panel}")
        if not panel:
            wrong(f"[{name}] a swipe from the edge did not open the drawer over a board")
        if page.evaluate("() => document.querySelector('.strip [aria-selected=true]')?.textContent") != column:
            wrong(f"[{name}] a swipe from the edge turned the board's page too")
        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(400)

        # A swipe from the right edge has nothing to bring out over a board.
        touch(cdp, "touchStart", [(384, y0)])
        for step in range(1, 13):
            touch(cdp, "touchMove", [(384 - 26 * step, y0)])
            page.wait_for_timeout(16)
        touch(cdp, "touchEnd", [])
        page.wait_for_timeout(600)
        if page.evaluate("() => window.nibApp.workspace.rightShows"):
            wrong(f"[{name}] a swipe from the right edge opened an empty drawer")
        page.locator('.strip [role="tab"]', has_text="To do").click()
        page.wait_for_timeout(300)

        # A card held in the strip and carried sideways is a carry, and no drawer with it.
        a = box(page, ".face", "A")
        x1 = max(left + 2, 2)
        touch(cdp, "touchStart", [(x1 + 9, a["y"])])
        page.wait_for_timeout(450)
        lifted = carried(page)
        for step in range(1, 10):
            touch(cdp, "touchMove", [(x1 + 9 + 22 * step, a["y"] + step)])
            page.wait_for_timeout(16)
        panel = page.evaluate("() => window.nibApp.workspace.panel")
        touch(cdp, "touchEnd", [])
        page.wait_for_timeout(500)
        say(f"[{name}] held in the strip: lifted {lifted}, panel {panel}")
        if not lifted:
            wrong(f"[{name}] a card held in the strip did not lift")
        if panel:
            wrong(f"[{name}] a card carried in the strip also opened the drawer")

        # A long column still scrolls under a thumb going up and down.
        page.evaluate(WRITE, [[[f"Items/Long {n}.md", "---\nstatus: To do\n---\n\nwords\n"] for n in range(30)]])
        page.wait_for_timeout(1200)
        scroller = page.evaluate(
            """() => { const s = [...document.querySelectorAll('[data-turns-pages] *')].find((o) => o.scrollHeight > o.clientHeight + 40); if (!s) return null; window.__long = s; return { top: s.scrollTop } }"""
        )
        if not scroller:
            wrong(f"[{name}] no long column to scroll")
        else:
            for step in range(1, 11):
                if step == 1:
                    touch(cdp, "touchStart", [(200, 600)])
                touch(cdp, "touchMove", [(200, 600 - 30 * step)])
                page.wait_for_timeout(16)
            touch(cdp, "touchEnd", [])
            page.wait_for_timeout(500)
            top = page.evaluate("() => window.__long.scrollTop")
            say(f"[{name}] a thumb up the column: scrolled to {top}")
            if top <= 0:
                wrong(f"[{name}] a thumb up the column did not scroll it")
    context.close()


def task_row_on_phone(browser):
    context, page, cdp = setup(browser, 390, 844)
    today = datetime.date.today().isoformat()
    DRIVE.seed(page, f"# Errands\n\n- [ ] one thing 📅 {today}\n- [ ] another thing 📅 {today}\n")
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "() => document.querySelectorAll('[data-row]').length >= 2", "the task rows")
    page.wait_for_timeout(400)
    page.evaluate(
        """() => { window.__cancels = 0
          window.addEventListener('pointercancel', () => window.__cancels++, true) }"""
    )
    row = page.evaluate(
        """() => {
          for (const one of document.querySelectorAll('[data-row]')) {
            const at = one.getBoundingClientRect()
            const x = at.x + at.width / 2, y = at.y + at.height / 2
            if (document.elementFromPoint(x, y)?.closest('[data-row]') === one) return { x, y }
          }
          return null
        }"""
    )
    touch(cdp, "touchStart", [(row["x"], row["y"])])
    page.wait_for_timeout(450)
    if not carried(page):
        wrong("[task row] a row held is not lifted")
    for step in range(1, 11):
        touch(cdp, "touchMove", [(row["x"] + 8 * step, row["y"] + 6 * step)])
        page.wait_for_timeout(30)
    if not carried(page):
        wrong("[task row] the drag was taken from the thumb on its first move")
    if page.evaluate("() => window.__cancels"):
        wrong("[task row] the browser cancelled the pointer under a held drag")
    if page.evaluate("() => !!document.querySelector('[data-swipe], .is-swiping')"):
        wrong("[task row] a held row swiped as well as carried")
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(500)
    context.close()


def timeline_on(browser, width, height):
    context, page, cdp = setup(browser, width, height)
    page.evaluate(OPEN_VIEW, "Time")
    wait_for(page, "() => document.querySelectorAll('.span').length >= 2", "the bars")
    # Days are wide enough for the track to have somewhere to go.
    page.get_by_role("tab", name="Days").click()
    page.wait_for_timeout(400)
    places = lambda: page.evaluate(
        "() => [...document.querySelectorAll('.span')].map((one) => one.style.insetInlineStart)"
    )
    before = places()
    track = lambda: page.evaluate("() => document.querySelector('.track').scrollLeft")
    span = page.evaluate(
        """() => { const at = document.querySelector('.span').getBoundingClientRect()
          return { x: at.x + at.width / 2, y: at.y + at.height / 2 } }"""
    )
    start = track()
    # A thumb swiping sideways across a bar, not asking for a hold: the track goes.
    touch(cdp, "touchStart", [(span["x"], span["y"])])
    for step in range(1, 11):
        touch(cdp, "touchMove", [(span["x"] - 12 * step, span["y"])])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(900)
    say(f"[timeline] track {start} -> {track()}, bars {before} -> {places()}")
    if places() != before:
        wrong("[timeline] a thumb swiping across a bar rewrote its dates")
    if track() == start:
        wrong("[timeline] a thumb swiping across a bar did not scroll the track")

    # A hold, then a move: the bar goes, and its times stay.
    page.evaluate("() => { document.querySelector('.track').scrollLeft = 0 }")
    page.wait_for_timeout(200)
    span = page.evaluate(
        """() => { const at = document.querySelector('.span').getBoundingClientRect()
          return { x: at.x + Math.min(at.width / 2, 40), y: at.y + at.height / 2 } }"""
    )
    touch(cdp, "touchStart", [(span["x"], span["y"])])
    page.wait_for_timeout(450)
    for step in range(1, 11):
        touch(cdp, "touchMove", [(span["x"] + 9 * step, span["y"])])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(900)
    after = places()
    say(f"[timeline] bars after a hold and a drag: {after}")
    if after == before:
        wrong("[timeline] a bar held and dragged did not move")
    context.close()


def drive(browser):
    board_on(browser, 1000, 760, "tablet")
    board_on(browser, 390, 844, "phone")
    task_row_on_phone(browser)
    timeline_on(browser, 1000, 760)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
