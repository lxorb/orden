from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)

DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0) }
}"""

ERRANDS = """# Errands

## Calls
- [ ] Call the bank #admin 📅 {today}
  Their number is on the back of the old card.
  - [x] Find the old card
  - Called once, no answer.
- [ ] Water the plants 📅 {today}
"""

WRITE = """async ([files]) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) {
    await window.tasks.writeFile(`${root}/${path}`, text)
    if (/\\.md$/i.test(path)) window.tasks.makeList(`${root}/${path}`)
  }
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words)?.task ?? null"

NOTE = """async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  return await window.ordenApp.workspace.noteText(`${root}/Errands.md`)
}"""

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

def seed(page: Page) -> None:
    wait_for(page, "window.ordenApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.ordenApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(page, f"() => !!({TASK})('Water the plants')", "the seeded rows")
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today's rows")
    quiet(page)

def row(words: str) -> str:
    return f".view-tab .task:has(.words:text-is('{words}'))"

def note(page: Page) -> str:
    return page.evaluate(NOTE)  # type: ignore[no-any-return]

FIELDS = """() => {
  const composer = document.querySelector('.sheet .composer')
  const label = document.querySelector('.sheet .adder .orden-row-label')
  if (!composer || !label) return null
  const style = getComputedStyle(composer)
  const box = composer.getBoundingClientRect()
  const adder = label.closest('.orden-row').getBoundingClientRect()
  const line = parseFloat(style.lineHeight)
  const top = parseFloat(style.paddingTop)
  return {
    left: Math.round(box.left), labelLeft: Math.round(label.getBoundingClientRect().left),
    height: Math.round(composer.closest('.orden-row').getBoundingClientRect().height),
    adderHeight: Math.round(adder.height),
    lineMiddle: Math.round(top + line / 2), middle: Math.round(box.height / 2),
    border: style.borderTopWidth,
  }
}"""

def the_comment_field(page: Page) -> None:
    fields = page.evaluate(FIELDS)
    say(f"[comment field] {fields}")
    if not fields:
        wrong("the comment field or the Add sub-task row is not there")
        return
    if abs(fields["left"] - fields["labelLeft"]) > 1:
        wrong(f"the comment's words start at {fields['left']}, not at Add sub-task's {fields['labelLeft']}")
    if abs(fields["height"] - fields["adderHeight"]) > 1:
        wrong(f"the comment row is {fields['height']} high, Add sub-task's {fields['adderHeight']}")
    if abs(fields["lineMiddle"] - fields["middle"]) > 1:
        wrong(f"the comment's line is not in the middle of its field: {fields}")
    if fields["border"] not in ("0px", ""):
        wrong(f"the comment field is still a box: border {fields['border']}")

BORDER = """() => {
  const row = document.querySelector('.sheet .composer').closest('.orden-row')
  row.getAnimations().forEach((one) => one.finish())
  return getComputedStyle(row).borderTopColor
}"""

RING = """() => {
  const composer = document.querySelector('.sheet .composer')
  const row = composer.closest('.orden-row')
  const of = (one) => {
    const style = getComputedStyle(one)
    return { shadow: style.boxShadow, outline: style.outlineStyle, radius: style.borderTopLeftRadius }
  }
  const box = row.getBoundingClientRect()
  const spread = Number(/(\\d+(?:\\.\\d+)?)px$/.exec(of(row).shadow)?.[1] ?? 0)
  const clips = []
  for (let up = row.parentElement; up; up = up.parentElement) {
    const style = getComputedStyle(up)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const edge = up.getBoundingClientRect()
    if (box.left - spread < edge.left || box.right + spread > edge.right)
      clips.push(up.className)
  }
  const words = composer.getBoundingClientRect()
  return {
    focused: document.activeElement === composer,
    words: of(composer), row: of(row), spread, clips,
    inside: words.left >= box.left && words.right <= box.right
      && words.top >= box.top && words.bottom <= box.bottom,
  }
}"""

def the_comment_ring(page: Page) -> None:
    composer = page.locator(".sheet .composer")
    composer.hover()
    rest = page.evaluate(BORDER)
    if rest != "rgba(0, 0, 0, 0)":
        wrong(f"the comment row is a box under the pointer: {rest}")
    composer.focus()
    page.evaluate("""() => document.querySelector('.sheet .composer').closest('.orden-row').getAnimations().forEach((one) => one.finish())""")
    ring = page.evaluate(RING)
    say(f"[comment ring] {ring}")
    shot(page, "01b-comment-ring")
    if not ring["focused"]:
        wrong("the comment field did not take the focus")
    if ring["words"]["shadow"] != "none" or ring["words"]["outline"] != "none":
        wrong(f"the words inside the comment row draw a ring of their own: {ring['words']}")
    if not ring["spread"]:
        wrong(f"the comment row says nothing of the focus: {ring['row']}")
    if ring["row"]["radius"] in ("0px", ""):
        wrong(f"the comment row's ring is square: {ring['row']}")
    if not ring["inside"]:
        wrong("the comment's words stand outside the ring")
    if ring["clips"]:
        wrong(f"the comment row's ring is cut off by {ring['clips']}")
    composer.blur()

def the_view(page: Page) -> None:
    page.locator(f"{row('Call the bank')} .words").click()
    wait_for(page, "document.querySelector('.sheet .title')", "the task view")
    wait_for(page, "document.querySelector('.sheet .description .cm-content')", "the description's editor")
    text = page.locator(".sheet").inner_text()
    for wanted in ["Errands", "Calls", "Their number is on the back", "Find the old card", "#admin"]:
        if wanted not in text:
            wrong(f"the task view does not say {wanted}")
    shot(page, "01-view")
    the_comment_field(page)
    the_comment_ring(page)

    page.locator(".sheet .title").fill("Call the bank again")
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Call the bank again')", "the new words in the line")
    if page.locator(".sheet .title").input_value() != "Call the bank again":
        wrong("the view lost the task when its words changed")

    page.locator(".sheet .description .cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.type(" Ask for Sam.", delay=10)
    for _ in range(100):
        if "card. Ask for Sam." in note(page):
            break
        page.wait_for_timeout(100)
    if "  Their number is on the back of the old card. Ask for Sam." not in note(page):
        say(note(page))
        wrong("the description lost its indent under the task")

    page.locator(".sheet .adder").click()
    page.keyboard.type("Ask about fees tomorrow", delay=10)
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Ask about fees')", "the sub-task written")
    sub = page.evaluate("() => window.tasks.rows.of().find((one) => one.task?.text === 'Ask about fees')")
    if not sub or sub["task"].get("parent") is None:
        wrong("the new task is not a sub-task")
    if not sub or not sub["task"].get("start"):
        wrong("the sub-task's words were not read for a day")
    shot(page, "02-edited")

    page.locator(".sheet .side .orden-row", has_text="p4").click()
    page.locator(".menu [role=menuitem]", has_text="1").first.click()
    wait_for(page, f"() => ({TASK})('Call the bank again')?.priority === 1", "priority 1 written")

    wait_for(page, "document.querySelector('.sheet .comment')?.textContent.includes('Called once')", "the comment")
    page.locator(".sheet").focus()
    page.keyboard.press("c")
    wait_for(page, "document.activeElement?.matches('.sheet .composer')", "c giving the field the keyboard")
    page.keyboard.type("Called again, they will ring back.", delay=5)
    page.keyboard.press("Enter")
    for _ in range(100):
        if "  - Called again, they will ring back. [at:: " in note(page):
            break
        page.wait_for_timeout(100)
    else:
        say(note(page))
        wrong("the comment was not written under the task, stamped")
    wait_for(page, "document.querySelectorAll('.sheet .comment').length === 2", "two comments")
    if not page.locator(".sheet .comment .at").count():
        wrong("the new comment does not say when it was written")
    shot(page, "02b-comments")
    page.locator(".sheet .comment").first.hover()
    page.locator(".sheet .comment .gone").first.click()
    wait_for(page, "document.querySelectorAll('.sheet .comment').length === 1", "a comment deleted")

    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet')", "the view put away")
    page.evaluate(
        "async () => { const ws = window.ordenApp.workspace; await ws.open(ws.activeSpace.root.replace(/[\\\\/]+$/, '') + '/Errands.md') }"
    )
    wait_for(page, "document.querySelector('.cm-content .orden-comment-chips')", "the comment's chip in the note")
    shown = page.locator(".cm-content .orden-comment-chips").first.inner_text()
    say(f"[comment chip] {shown!r}")
    if "[at::" in page.locator(".cm-content").inner_text():
        wrong("the comment's stamp is drawn as its raw field")
    shot(page, "02c-comment-in-note")
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today again")
    page.locator(f"{row('Call the bank again')} .words").click()
    wait_for(page, "document.querySelector('.sheet .title')", "the task view again")

    page.locator(".sheet").focus()
    page.keyboard.press("j")
    wait_for(page, "document.querySelector('.sheet .title')?.value === 'Water the plants'", "the next task")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet')", "the view put away")

def phone(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    DRIVE.open(page)
    seed(page)
    page.locator(f"{row('Call the bank')} .words").click()
    wait_for(page, "document.querySelector('.sheet.page')", "the task view as a page")
    shot(page, "03-phone")
    page.close()

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    the_view(page)
    page.close()
    phone(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the task view held"))
