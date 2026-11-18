from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

PICKER = '[role="dialog"][aria-label="Choose an icon"]'

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom('# Plan\\n\\nWe meet at noon.\\n', ws.activeSpace.root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Plan.md')
  await ws.openEntry(note.path, { activate: true })
  return note.path
}
"""

LAID = """
(selector) => {
  const sheet = document.querySelector(selector)
  const box = (one) => one.getBoundingClientRect()
  const field = sheet.querySelector('input.orden-field')
  const tick = field.nextElementSibling
  const grid = sheet.querySelector('.grid')
  const tall = grid.querySelector('.tall')
  const recent = sheet.querySelector('.recent')
  const collapsed = [...sheet.children]
    .filter((one) => one.getClientRects().length && one !== grid)
    .filter((one) => box(one).height + 1 < one.scrollHeight)
    .map((one) => one.className)
  return {
    collapsed,
    segmented: sheet.querySelectorAll('.orden-segmented').length,
    tick: tick?.querySelector('input[type="checkbox"]') ? tick.textContent.trim() : null,
    checked: tick?.querySelector('input')?.checked ?? null,
    recent: recent ? box(recent).height : null,
    cell: sheet.querySelector('.grid .cell') ? box(sheet.querySelector('.grid .cell')).height : 0,
    gaps: [box(tall).left - box(field).left, box(field).right - box(tall).right],
    bar: grid.offsetWidth - grid.clientWidth,
    edge: box(sheet).right - box(grid).right,
    remove: [...sheet.querySelectorAll('button')].some((one) => one.textContent.trim() === 'Remove icon'),
  }
}
"""

def opened(page, path: str) -> None:
    page.evaluate("(path) => window.ordenApp.iconChoice.file(path)", path)
    page.wait_for_selector(f"{PICKER} .grid .cell")
    quiet(page)

def checked(label: str, laid: dict) -> None:
    say(f"[{label}] {laid}")
    if laid["collapsed"]:
        wrong(f"[{label}] squeezed below their own height: {laid['collapsed']}")
    if laid["segmented"]:
        wrong(f"[{label}] still a segmented switch in the picker")
    if laid["tick"] != "One colour":
        wrong(f"[{label}] no One colour checkbox right below the search field: {laid['tick']}")
    if laid["recent"] is not None and abs(laid["recent"] - laid["cell"]) > 1:
        wrong(f"[{label}] the recent row is {laid['recent']}px tall, a cell {laid['cell']}px")
    left, right = laid["gaps"]
    if abs(left - right) > laid["bar"] + 2:
        wrong(f"[{label}] the grid is not centred under the search field: {left} and {right}")
    if laid["edge"] > 2:
        wrong(f"[{label}] the grid's scrollbar stands {laid['edge']}px in from the panel edge")

def drive(browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 1280, "height": 720},
        color_scheme="dark",
        reduced_motion="reduce",
    )
    page.set_default_timeout(15000)
    DRIVE.open(page)
    path = page.evaluate(SEED)
    quiet(page)

    opened(page, path)
    first = page.locator(f"{PICKER} .grid .cell").nth(3)
    first.click()
    page.wait_for_selector(PICKER, state="detached")

    for width, height in [(1280, 720), (1280, 560)]:
        page.set_viewport_size({"width": width, "height": height})
        label = f"{width}x{height}"
        opened(page, path)
        laid = page.evaluate(LAID, PICKER)
        checked(label, laid)
        if not laid["remove"]:
            wrong(f"[{label}] no Remove icon button while the note wears one")
        shot(page, f"picker-{label}")
        page.keyboard.press("Escape")
        page.wait_for_selector(PICKER, state="detached")

    page.set_viewport_size({"width": 1280, "height": 720})
    opened(page, path)
    glyph = page.locator(f"{PICKER} .grid .cell").nth(20).inner_html()
    page.locator(f"{PICKER} label.tick").click()
    quiet(page)
    laid = page.evaluate(LAID, PICKER)
    if laid["checked"] is not True:
        wrong("the One colour checkbox did not tick")
    if page.locator(f"{PICKER} .grid .cell").nth(20).inner_html() == glyph:
        wrong("ticking One colour left the icons as they were")
    shot(page, "picker-one-colour")

    page.fill(f"{PICKER} input.orden-field", "star")
    quiet(page)
    checked("searched", page.evaluate(LAID, PICKER))
    shot(page, "picker-searched")

    page.locator(f"{PICKER} button", has_text="Remove icon").click()
    page.wait_for_selector(PICKER, state="detached")
    opened(page, path)
    if page.evaluate(LAID, PICKER)["remove"]:
        wrong("Remove icon left the icon on the note")
    shot(page, "picker-removed")
    page.keyboard.press("Escape")

    page.emulate_media(color_scheme="light")
    page.evaluate("() => window.ordenApp.theme?.setScheme?.('light')")
    opened(page, path)
    checked("light", page.evaluate(LAID, PICKER))
    shot(page, "picker-light")

    page.context.close()

raise SystemExit(DRIVE.run(drive))
