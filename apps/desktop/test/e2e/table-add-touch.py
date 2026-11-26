import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
NOTE = (
    "# Gym\n\n## 3a. Leg press\n\n3 × 10–15\n\n"
    "| Load [kg] | Reps by set |\n| --- | --- |\n| 27 | 9 / 8 / 8 / 8 |\n| 23 | 12 / 12 / 14 / 12 / 10 |\n| 23 | 12 / 14 / 12 / 12 / 9 |\n\n"
    "## 3b. Leg extension\n\n3 × 10–15\n"
)
SEED = """
async ([note]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const one = ws.notes.find((entry) => entry.name.startsWith('Gym'))
  await ws.openEntry(one.path, { activate: true })
}
"""
def centre(page: Page, selector: str) -> dict:
    return page.evaluate(
        "(s) => { const one = [...document.querySelectorAll(s)].at(-1); const b = one.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }",
        selector,
    )
def drive(browser: Browser, scheme: str) -> None:
    phone = browser.new_context(
        viewport={"width": 390, "height": 844}, user_agent=AGENT, has_touch=True, is_mobile=True,
        color_scheme=scheme, device_scale_factor=3,
    )
    page = phone.new_page()
    DRIVE.open(page)
    page.evaluate(SEED, [NOTE])
    wait_for(page, "document.querySelector('.cm-content .orden-table td')", "the table")
    page.wait_for_timeout(800)
    spot = centre(page, ".cm-content .orden-table tbody tr:last-child td:first-child")
    page.touchscreen.tap(spot["x"], spot["y"])
    page.wait_for_timeout(500)
    shown = page.evaluate("() => !!document.querySelector('.orden-table-add-row') && getComputedStyle(document.querySelector('.orden-table-add-row')).display")
    say(f"[{scheme}] add row strip shown: {shown}")
    shot(page, f"{scheme}-1-cell-focused")
    spot = centre(page, ".orden-table-add-row")
    page.touchscreen.tap(spot["x"], spot["y"])
    page.wait_for_timeout(600)
    doc = page.evaluate("() => window.orden.state.doc.toString()")
    focused = page.evaluate("() => { const f = document.activeElement; return f?.dataset ? { row: f.dataset.row, column: f.dataset.column } : null }")
    say(f"[{scheme}] after add row, focused {json.dumps(focused)}; rows {doc.count(chr(10) + '|') }")
    if "|  |  |" not in doc and "| | |" not in doc:
        wrong(f"[{scheme}] no empty row was added: {json.dumps(doc[-200:])}")
    page.keyboard.type("25")
    page.wait_for_timeout(300)
    shot(page, f"{scheme}-2-row-added")
    phone.close()
def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            drive(browser, scheme)
    return DRIVE.verdict("a row is added to a table with a tap")
raise SystemExit(main())
