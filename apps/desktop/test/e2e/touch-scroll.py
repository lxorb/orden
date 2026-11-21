import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
FILLER = "".join(f"A line of words to scroll past, number {n}.\n\n" for n in range(12))
NOTE = (
    "# Gym\n\n" + FILLER + "![Cable pushdown](pushdown.png)\n\n"
    "| Load | Reps |\n| --- | --- |\n| 17 | 12 / 12 |\n\n"
    "- [ ] stretch after\n\n" + FILLER
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
STATE = """() => {
  const view = window.orden
  const { from, to } = view.state.selection.main
  return { doc: view.state.doc.toString(), from, to, focused: document.activeElement?.className ?? '' }
}"""
CENTRE = """(selector) => {
  const one = document.querySelector(selector)
  one.scrollIntoView({ block: 'center' })
  const box = one.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}"""
def swipe(page: Page, x: float, y: float) -> None:
    touch = page.context.new_cdp_session(page)
    touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for step in range(1, 13):
        touch.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y - step * 15}]})
        page.wait_for_timeout(16)
    touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(500)
def across(page: Page, label: str, selector: str) -> None:
    spot = page.evaluate(CENTRE, selector)
    page.wait_for_timeout(300)
    before = page.evaluate(STATE)
    swipe(page, spot["x"], spot["y"])
    after = page.evaluate(STATE)
    say(f"[{label}] before {json.dumps({k: before[k] for k in ('from', 'to')})} after {json.dumps({k: after[k] for k in ('from', 'to', 'focused')})}")
    if after["doc"] != before["doc"]:
        wrong(f"[{label}] scrolling across it changed the note")
    if (after["from"], after["to"]) != (before["from"], before["to"]):
        wrong(f"[{label}] scrolling across it moved the selection to {after['from']}..{after['to']}")
    if "orden-table-cell" in after["focused"] or "orden-image" in after["focused"]:
        wrong(f"[{label}] scrolling across it took focus: {after['focused']}")
def main() -> int:
    with DRIVE.session() as browser:
        phone = browser.new_context(
            viewport={"width": 390, "height": 844}, user_agent=AGENT, has_touch=True, is_mobile=True
        )
        page = phone.new_page()
        DRIVE.open(page)
        page.evaluate(SEED, [NOTE])
        wait_for(page, "document.querySelector('.cm-content .orden-image-frame')", "the picture")
        page.wait_for_timeout(800)
        across(page, "picture", ".cm-content .orden-image-frame")
        across(page, "table cell", ".cm-content .orden-table td")
        across(page, "task box", ".cm-content .orden-checkbox")
        spot = page.evaluate(CENTRE, ".cm-content .orden-image-frame")
        page.wait_for_timeout(300)
        page.touchscreen.tap(spot["x"], spot["y"])
        page.wait_for_timeout(400)
        tapped = page.evaluate(STATE)
        picked = tapped["doc"][tapped["from"] : tapped["to"]]
        say(f"[tap] picked {json.dumps(picked)}")
        if picked != "![Cable pushdown](pushdown.png)":
            wrong(f"a tap on the picture did not pick it: {picked!r}")
        shot(page, "tapped")
        phone.close()
    return DRIVE.verdict("a finger scrolls across pictures, tables and boxes without picking them")
raise SystemExit(main())
