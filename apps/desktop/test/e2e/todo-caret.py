from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WORDS = ["30 F", "Pay rent 30 nov #home p1", "Call the landlord about the heating tomorrow #flat p2 and then the plumber"]
MEASURE = """(field) => {
  const input = document.querySelector(field)
  const letters = input.closest('.chip-input').querySelector('.letters')
  const style = getComputedStyle(input)
  const box = input.getBoundingClientRect()
  const pen = document.createElement('canvas').getContext('2d')
  pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const caret = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    + pen.measureText(input.value.slice(0, input.selectionEnd ?? input.value.length)).width - input.scrollLeft
  const walker = document.createTreeWalker(letters, NodeFilter.SHOW_TEXT)
  let last = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.length) last = node
  const range = document.createRange()
  range.setStart(letters, 0)
  range.setEnd(last, last.textContent.endsWith('\\u200b') ? last.textContent.length - 1 : last.textContent.length)
  const text = range.getBoundingClientRect()
  return {
    across: Math.round((caret - text.right) * 10) / 10,
    down: Math.round((box.top + box.height / 2 - (text.top + text.bottom) / 2) * 10) / 10,
    chips: letters.querySelectorAll('[data-chip]').length,
  }
}"""
def measured(page: Page, where: str, field: str, tag: str) -> None:
    for words in WORDS:
        page.locator(field).click()
        page.locator(field).fill("")
        page.keyboard.type(words, delay=10)
        page.keyboard.press("End")
        page.wait_for_timeout(120)
        got = page.evaluate(MEASURE, field)
        say(f"[{tag}] {where} {words!r}: {got}")
        if abs(got["across"]) > 1.5 or abs(got["down"]) > 1.5:
            wrong(f"[{tag}] in {where} the caret is {got['across']}px across and {got['down']}px down from the end of {words!r}")
    DRIVE.shot(page, f"{tag}-{where.replace(' ', '-')}")
    page.locator(field).fill("")
    page.keyboard.press("Escape")
def todos(page: Page, tag: str) -> None:
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    page.wait_for_selector("[data-todos-panel] [data-todos-add]")
    field = page.locator("[data-todos-panel] [data-todos-add]")
    field.fill("Water the plants")
    field.press("Enter")
    wait_for(page, "[...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].length > 0", "a todo")
    measured(page, "panel", "[data-todos-panel] [data-todos-add]", tag)
    page.locator("[data-todos-panel] [data-todos-open]").click()
    page.wait_for_selector("[data-todos-board] [data-todos-column]")
    measured(page, "board", "[data-todos-board] [data-todos-add]", tag)
    page.locator("[data-todos-board] [data-todos-column] [data-todos-column-add]").first.click()
    page.wait_for_selector("[data-todos-board] [data-todos-column-field]")
    measured(page, "board column", "[data-todos-board] [data-todos-column-field]", tag)
def quick(page: Page, tag: str) -> None:
    page.keyboard.press("Control+o")
    wait_for(page, "!!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("add task", delay=15)
    wait_for(page, "[...document.querySelectorAll('.palette .orden-row')].some((one) => one.textContent.includes('Add task'))", "the Add task row")
    page.keyboard.press("Enter")
    wait_for(page, "!!document.querySelector('.sheet .quick input.field')", "the quick add field")
    measured(page, "quick add", ".sheet .quick input.field", tag)
def drive(browser: Browser) -> None:
    for scheme in ["light", "dark"]:
        context = DRIVE.context(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
        page = context.new_page()
        page.on("pageerror", lambda error: wrong(f"page error: {error}"))
        DRIVE.open(page)
        page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
        todos(page, scheme)
        quick(page, scheme)
        context.close()
    say("the caret sits at the end of the shown text in every todo field, light and dark")
raise SystemExit(DRIVE.run(drive, "the caret in a todo field sits at the end of the text it shows"))
