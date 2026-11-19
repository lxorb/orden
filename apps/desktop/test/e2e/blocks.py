import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
NOTE = """# A note of blocks

The first paragraph, which has seven words here.

The second paragraph, shorter.

- one item
- another item

> A quote to move around.

The last paragraph of the note.
"""
SEED = """
async ([note]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""
MARKS = """
() => [...document.querySelectorAll('.orden-block-handle')].map((mark) => {
  const line = mark.closest('.cm-line')
  const box = line.getBoundingClientRect()
  const rect = mark.getBoundingClientRect()

  return {
    text: line.textContent.trim().slice(0, 24),
    gap: Math.round(box.left - rect.right),
    into: Math.round(rect.top + rect.height / 2 - box.top),
    shown: getComputedStyle(mark).opacity,
  }
})
"""
ROWS = """
() => [...document.querySelectorAll('.rows .orden-row')].map((row) => ({
  label: row.querySelector('.orden-row-label')?.textContent ?? '',
  off: row.disabled,
}))
"""
LIST = """# A note of blocks

cleanes konto fuer ethcc emails

quaestur:
- [ ] clean up the repo
- [ ] payrexx import
- [ ] abacus zahlungsmethode fuer auslaendische kunden




"""
def fresh(
    browser: Browser, label: str, finger: bool = False, width: int = 1180, note: str = NOTE
) -> Page:
    context = browser.new_context(
        viewport={"width": width, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        permissions=["clipboard-read", "clipboard-write"],
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    DRIVE.open(page)
    say(f"[{label}] the space holds {page.evaluate(SEED, [note])}")
    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('A note'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.orden && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page
def source(page: Page) -> str:
    return page.evaluate("() => window.orden.state.doc.toString()")
def line_of(page: Page, words: str):
    return page.locator(".cm-line", has_text=words).first
def press_mark(page: Page, words: str) -> None:
    line_of(page, words).hover()
    page.wait_for_timeout(250)
    line_of(page, words).locator(".orden-block-handle").click()
    page.wait_for_timeout(400)
def choose(page: Page, label: str) -> None:
    page.locator(".rows .orden-row", has_text=label).first.click()
    page.wait_for_timeout(500)
def drive_marks(browser: Browser) -> None:
    page = fresh(browser, "desktop")
    resting = page.evaluate("() => getComputedStyle(document.querySelector('.orden-block-handle')).opacity")
    say(f"[desktop] a mark nobody is pointing at: opacity {resting}")
    if resting != "0":
        wrong(f"the mark is not calm: opacity {resting}")
    line_of(page, "The first paragraph").hover()
    page.wait_for_timeout(300)
    marks = page.evaluate(MARKS)
    say(f"[desktop] the marks: {json.dumps(marks[:4], ensure_ascii=False)}")
    shot(page, "01-mark-beside-a-block")
    if len(marks) < 6:
        wrong(f"a note of seven blocks drew {len(marks)} marks")
    gaps = sorted({one["gap"] for one in marks})
    if len(gaps) != 1:
        wrong(f"the marks do not stand in one column: {gaps}")
    if gaps and gaps[0] < 20:
        wrong(f"the mark does not stand clear of the fold chevron: gap {gaps}")
    for one in marks:
        if not 0 <= one["into"] <= 40:
            wrong(f"a mark is not on its block's first row: {one['into']}px into it")
    hovered = [one for one in marks if one["text"].startswith("The first paragraph")]
    if not hovered or hovered[0]["shown"] != "1":
        wrong("the mark did not come out under the pointer")
    page.context.close()
REACH = """
() => {
  const pane = document.querySelector('.cm-scroller').getBoundingClientRect()
  return [...document.querySelectorAll('.orden-block-handle')].map((mark) => {
    const rect = mark.getBoundingClientRect()
    const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      text: mark.closest('.cm-line').textContent.trim().slice(0, 24),
      out: Math.round(Math.max(pane.left - rect.left, rect.right - pane.right)),
      hit: mark === under || mark.contains(under),
    }
  })
}
"""
def drive_narrow(browser: Browser) -> None:
    for width in (480, 640):
        page = fresh(browser, f"narrow {width}", width=width)
        line_of(page, "The first paragraph").hover()
        page.wait_for_timeout(300)
        marks = page.evaluate(REACH)
        say(f"[narrow {width}] the marks: {json.dumps(marks[:3], ensure_ascii=False)}")
        shot(page, f"02-mark-in-a-narrow-window-{width}")
        if not marks:
            wrong(f"a {width}px window drew no marks")
        for one in marks:
            if one["out"] > 0 or not one["hit"]:
                wrong(f"[narrow {width}] the mark of {one['text']!r} sticks {one['out']}px out of the pane")
        line_of(page, "The first paragraph").locator(".orden-block-handle").click()
        page.wait_for_timeout(400)
        if not page.evaluate(ROWS):
            wrong(f"[narrow {width}] pressing the mark opened no menu")
        page.context.close()
def drive_menu(browser: Browser) -> None:
    page = fresh(browser, "menu")
    press_mark(page, "The first paragraph")
    rows = page.evaluate(ROWS)
    say(f"[menu] the rows: {json.dumps([one['label'] for one in rows], ensure_ascii=False)}")
    shot(page, "10-the-block-menu")
    labels = [one["label"] for one in rows]
    if not any(label.startswith("Paragraph, ") for label in labels):
        wrong(f"the menu does not say what the block is: {labels[:3]}")
    if "Paragraph, 8 words" not in labels:
        wrong(f"the words of the block are not counted: {[l for l in labels if 'word' in l]}")
    if not [one for one in rows if one["label"].startswith("Paragraph") and one["off"]]:
        wrong("what the block is reads as something to press")
    for wanted in ("Duplicate", "Copy link", "Delete"):
        if wanted not in labels:
            wrong(f"the menu offers no {wanted!r}")
    choose(page, "Duplicate")
    text = source(page)
    shot(page, "11-duplicated")
    if text.count("The first paragraph, which has seven words here.") != 2:
        wrong("the block was not duplicated")
    press_mark(page, "The first paragraph")
    choose(page, "Delete")
    if source(page).count("The first paragraph") != 1:
        wrong("the block was not deleted")
    shot(page, "12-deleted")
    press_mark(page, "The second paragraph")
    choose(page, "Copy link")
    text = source(page)
    link = page.evaluate("() => navigator.clipboard.readText()")
    say(f"[menu] the link: {link!r}")
    shot(page, "13-copy-link")
    if not link.startswith("[[A note of blocks#^"):
        wrong(f"the link does not point into this note: {link!r}")
    name = link.split("#^")[-1].rstrip("]")
    if f"shorter. ^{name}" not in text:
        wrong(f"the block was not given the name the link points at: {name!r}")
    before = source(page)
    press_mark(page, "A note of blocks")
    choose(page, "Copy link")
    heading = page.evaluate("() => navigator.clipboard.readText()")
    say(f"[menu] the heading link: {heading!r}")
    if heading != "[[A note of blocks#A note of blocks]]":
        wrong(f"a heading is not linked by its own words: {heading!r}")
    if source(page) != before:
        wrong("linking to a heading wrote something into the note")
    page.context.close()
def drive_selection(browser: Browser) -> None:
    page = fresh(browser, "selection")
    page.evaluate(
        """() => {
          const text = window.orden.state.doc.toString()
          const from = text.indexOf('The first paragraph')
          const to = text.indexOf('shorter.') + 4
          window.orden.dispatch({ selection: { anchor: from, head: to } })
          window.orden.focus()
        }"""
    )
    page.wait_for_timeout(300)
    press_mark(page, "The second paragraph")
    labels = [one["label"] for one in page.evaluate(ROWS)]
    say(f"[selection] the rows: {json.dumps(labels[:4], ensure_ascii=False)}")
    shot(page, "20-two-blocks")
    if "2 blocks, 12 words" not in labels:
        wrong(f"the menu does not count the blocks a selection covers: {labels[:3]}")
    choose(page, "Delete")
    text = source(page)
    shot(page, "21-both-deleted")
    if "The first paragraph" in text or "The second paragraph" in text:
        wrong("deleting what a selection covers left one of the blocks behind")
    page.context.close()
def drive_drag(browser: Browser) -> None:
    page = fresh(browser, "drag")
    line_of(page, "A quote to move").hover()
    page.wait_for_timeout(300)
    mark = line_of(page, "A quote to move").locator(".orden-block-handle").bounding_box()
    target = line_of(page, "The first paragraph").bounding_box()
    if not mark or not target:
        raise SystemExit("nothing to drag")
    page.mouse.move(mark["x"] + mark["width"] / 2, mark["y"] + mark["height"] / 2)
    page.mouse.down()
    page.mouse.move(target["x"] + 40, target["y"] + 2, steps=12)
    page.wait_for_timeout(200)
    drawn = page.evaluate(
        """() => ({
          lifted: document.querySelectorAll('.cm-line.orden-block-lifted').length,
          over: document.querySelectorAll('.cm-line.orden-block-over').length,
        })"""
    )
    say(f"[drag] while it is carried: {json.dumps(drawn)}")
    shot(page, "30-carrying")
    if not drawn["lifted"]:
        wrong("the block being carried does not say so")
    if drawn["over"] != 1:
        wrong(f"the place it would land is not drawn: {drawn['over']} lines")
    page.mouse.up()
    page.wait_for_timeout(500)
    text = source(page)
    shot(page, "31-dropped")
    if text.index("> A quote") > text.index("The first paragraph"):
        wrong("the quote did not move above the paragraph it was dropped on")
    if "> A quote to move around.\n\nThe first paragraph" not in text:
        wrong(f"the blank line between the blocks did not survive the move:\n{text[:200]}")
    if page.evaluate("() => document.querySelectorAll('.cm-line.orden-block-lifted').length"):
        wrong("the block is still being carried after the button came up")
    page.context.close()
DROP_LINE = """
() => {
  const line = document.querySelector('.cm-line.orden-block-over, .cm-line.orden-block-under')
  if (!line) return null
  const box = line.getBoundingClientRect()
  const under = line.classList.contains('orden-block-under')
  return { text: line.textContent.trim(), under, y: Math.round(under ? box.bottom : box.top) }
}
"""
def carry_to(page: Page, words: str, x: float, y: float, label: str):
    line_of(page, words).hover()
    page.wait_for_timeout(300)
    mark = line_of(page, words).locator(".orden-block-handle").bounding_box()
    if not mark:
        raise SystemExit("nothing to drag")
    page.mouse.move(mark["x"] + mark["width"] / 2, mark["y"] + mark["height"] / 2)
    page.mouse.down()
    page.mouse.move(x, y, steps=12)
    page.wait_for_timeout(200)
    drawn = page.evaluate(DROP_LINE)
    shot(page, f"32-drop-line-{label}")
    page.mouse.up()
    page.wait_for_timeout(500)
    return drawn
def drive_drop_line(browser: Browser) -> None:
    cases = [
        ("end", "payrexx import", "abacus zahlungsmethode", 0.75, "abacus zahlungsmethode", True),
        ("below", "payrexx import", None, 0, "abacus zahlungsmethode", True),
        ("gap", "payrexx import", "quaestur:", -0.6, "quaestur:", False),
        ("top", "abacus zahlungsmethode", "cleanes konto", 0.2, "cleanes konto", False),
        ("middle", "abacus zahlungsmethode", "clean up the repo", 0.75, "payrexx import", False),
    ]
    for label, words, onto, part, edge, under in cases:
        page = fresh(browser, f"drop {label}", note=LIST)
        content = page.locator(".cm-content").bounding_box()
        if onto:
            box = line_of(page, onto).bounding_box()
            y = box["y"] + box["height"] * part
            x = box["x"] + 40
        else:
            last = page.locator(".cm-line").last.bounding_box()
            y = last["y"] + last["height"] + 120
            x = content["x"] + 40
        drawn = carry_to(page, words, x, y, label)
        text = source(page)
        rows = [one for one in text.split("\n") if one.strip()]
        row = lambda words: next(at for at, one in enumerate(rows) if words in one)
        say(f"[drop {label}] the line: {json.dumps(drawn, ensure_ascii=False)}")
        if not drawn:
            wrong(f"[drop {label}] no line shows where the block would land")
            page.context.close()
            continue
        if edge not in drawn["text"]:
            wrong(f"[drop {label}] the line is on {drawn['text']!r}, not on {edge!r}")
        if drawn["under"] != under:
            wrong(f"[drop {label}] the line is {'under' if drawn['under'] else 'over'} its line")
        if label in ("end", "below"):
            if words not in rows[-1]:
                wrong(f"[drop {label}] the block did not land last: {rows[-3:]}")
            if "abacus" not in rows[-2]:
                wrong(f"[drop {label}] the block did not land right under the last one: {rows[-3:]}")
        if label == "gap" and row("quaestur:") != row(words) + 1:
            wrong(f"[drop {label}] the block did not land in the gap: {rows[:4]}")
        if label == "top" and words not in rows[1]:
            wrong(f"[drop {label}] the block did not land at the top: {rows[:3]}")
        if label == "middle" and row(words) != row("clean up the repo") + 1:
            wrong(f"[drop {label}] the block did not land under the middle one: {rows}")
        page.context.close()
def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)
    marks = page.evaluate(
        "() => [...document.querySelectorAll('.orden-block-handle')]"
        ".map((mark) => getComputedStyle(mark).display)"
    )
    say(f"[phone] the marks: {json.dumps(sorted(set(marks)))}")
    shot(page, "40-phone")
    if any(one != "none" for one in marks):
        wrong("a screen with no pointer draws a mark nobody can hover")
    page.context.close()
KINDS = """# A note to reach

A paragraph to reach.

- a bullet to reach

- [ ] a task to reach

> a quote to reach

1. a number to reach

שורה בעברית לנסות
"""
ON_THE_WAY = """
([words, x, y]) => {
  const line = [...document.querySelectorAll('.cm-line')].find((one) => one.textContent.includes(words))
  const mark = line?.querySelector('.orden-block-handle')
  const under = document.elementFromPoint(x, y)
  return {
    line: !!under && line?.contains(under),
    shown: mark ? Number(getComputedStyle(mark).opacity) : 0,
    grip: !!under && !!mark?.contains(under),
  }
}
"""
def drive_gap(browser: Browser) -> None:
    lines = ["A note to reach", "A paragraph to reach", "a bullet to reach", "a task to reach",
             "a quote to reach", "a number to reach", "שורה בעברית"]
    for width in (1180, 480):
        page = fresh(browser, f"gap {width}", width=width, note=KINDS)
        for words in lines:
            line = line_of(page, words)
            mark = line.locator(".orden-block-handle")
            text = page.evaluate(
                """(words) => {
                  const line = [...document.querySelectorAll('.cm-line')].find((one) => one.textContent.includes(words))
                  const range = document.createRange()
                  range.selectNodeContents(line)
                  const rects = [...range.getClientRects()].filter((one) => one.width > 0)
                  const box = rects[0] ?? line.getBoundingClientRect()
                  const rtl = getComputedStyle(line).direction === 'rtl'
                  return { x: rtl ? box.right - 4 : box.left + 4, y: box.top + box.height / 2 }
                }""",
                words,
            )
            page.mouse.move(text["x"], text["y"])
            page.wait_for_timeout(300)
            grip = mark.bounding_box()
            if not grip:
                wrong(f"[gap {width}] {words!r} drew no mark")
                continue
            goal = {"x": grip["x"] + grip["width"] / 2, "y": grip["y"] + grip["height"] / 2}
            lost = []
            for step in range(1, 13):
                x = text["x"] + (goal["x"] - text["x"]) * step / 12
                y = text["y"] + (goal["y"] - text["y"]) * step / 12
                page.mouse.move(x, y)
                page.wait_for_timeout(40)
                seen = page.evaluate(ON_THE_WAY, [words, x, y])
                if not seen["line"] or seen["shown"] < 0.99:
                    lost.append(step)
                if step == 6:
                    page.wait_for_timeout(700)
                    rested = page.evaluate(ON_THE_WAY, [words, x, y])
                    if rested["shown"] < 0.99:
                        wrong(f"[gap {width}] resting between {words!r} and its mark hides the mark")
            seen = page.evaluate(ON_THE_WAY, [words, goal["x"], goal["y"]])
            say(f"[gap {width}] {words!r}: lost on steps {lost}, grabbable {seen['grip']}")
            if lost:
                wrong(f"[gap {width}] the mark of {words!r} went away on the way to it: steps {lost}")
            if not seen["grip"] or seen["shown"] < 0.99:
                wrong(f"[gap {width}] the mark of {words!r} is not there to take hold of")
            if words == "a task to reach":
                page.mouse.move(goal["x"] + (text["x"] - goal["x"]) / 2, goal["y"])
                page.wait_for_timeout(200)
                shot(page, f"05-between-task-and-mark-{width}")
        page.mouse.move(goal["x"], goal["y"])
        page.mouse.down()
        top = line_of(page, "A note to reach").bounding_box()
        page.mouse.move(top["x"] + 40, top["y"] + 2, steps=12)
        page.mouse.up()
        page.wait_for_timeout(400)
        if not source(page).startswith("שורה בעברית"):
            wrong(f"[gap {width}] the line reached through the gap could not be carried: {source(page)[:40]!r}")
        page.context.close()
LAST_LINE = """() => {
  const line = [...document.querySelectorAll('.cm-line')].at(-1)
  return { text: line.textContent, heading: /orden-h\\d/.test(line.className), bullet: !!line.querySelector('.orden-bullet') }
}"""
def drive_lone_mark(browser: Browser) -> None:
    page = fresh(browser, "lone mark")
    page.evaluate("() => { if (!window.ordenApp.modes.quietMarks) window.ordenApp.modes.toggleQuietMarks(window.orden) }")
    page.evaluate(
        "() => { const view = window.orden; const end = view.state.doc.length;"
        " view.dispatch({ selection: { anchor: end } }); view.focus() }"
    )
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    for mark, kind in (("#", "heading"), ("-", "bullet")):
        page.keyboard.type(mark)
        page.wait_for_timeout(300)
        alone = page.evaluate(LAST_LINE)
        shot(page, f"50-lone-{kind}-mark")
        say(f"[lone {mark}] {json.dumps(alone, ensure_ascii=False)}")
        if alone[kind] or alone["text"] != mark:
            wrong(f"[lone {mark}] a mark with no space after it is drawn as a {kind}: {alone}")
        page.keyboard.type(" Title")
        page.wait_for_timeout(300)
        spaced = page.evaluate(LAST_LINE)
        shot(page, f"51-spaced-{kind}-mark")
        say(f"[spaced {mark}] {json.dumps(spaced, ensure_ascii=False)}")
        if not spaced[kind]:
            wrong(f"[spaced {mark}] a mark with a space after it is not drawn as a {kind}: {spaced}")
        page.evaluate(
            "() => { const view = window.orden; const line = view.state.doc.line(view.state.doc.lines);"
            " view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from } }) }"
        )
        page.wait_for_timeout(200)
    page.evaluate("() => { if (window.ordenApp.modes.quietMarks) window.ordenApp.modes.toggleQuietMarks(window.orden) }")
    page.context.close()
def main() -> int:
    with DRIVE.session() as browser:
        say("--- the mark ---")
        drive_marks(browser)
        say("--- a lone heading or list mark ---")
        drive_lone_mark(browser)
        say("--- the gap before a line ---")
        drive_gap(browser)
        say("--- a narrow window ---")
        drive_narrow(browser)
        say("--- what it opens ---")
        drive_menu(browser)
        say("--- more than one block ---")
        drive_selection(browser)
        say("--- dragging one ---")
        drive_drag(browser)
        say("--- where it would land ---")
        drive_drop_line(browser)
        say("--- a finger ---")
        drive_finger(browser)
    return DRIVE.verdict("a block can be taken hold of, moved, copied and pointed at")
raise SystemExit(main())
