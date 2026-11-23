from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
WIDE = "| " + " | ".join(f"Column {n} with a few words in its head" for n in range(7)) + " |"
RULE = "|" + "---|" * 7
ROW = "| " + " | ".join("some longer words in every cell of the row" for _ in range(7)) + " |"
NOTE = f"# Wide\n\nA line of words.\n\n{WIDE}\n{RULE}\n{ROW}\n{ROW}\n\nBetween.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter.\n"
BOXES = """([column, scroll, pane]) => {
  const page = document.querySelector(column)
  const box = (one) => { const r = one.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }
  const style = getComputedStyle(page)
  const left = page.getBoundingClientRect().left + parseFloat(style.paddingLeft)
  const right = page.getBoundingClientRect().right - parseFloat(style.paddingRight)
  const scrollers = [...page.querySelectorAll(scroll)]
  const host = page.closest(pane)
  return {
    column: [Math.round(left), Math.round(right)],
    pane: box(host),
    wide: box(scrollers[0]),
    narrow: box(scrollers[1]),
    clipped: [scrollers[0], scrollers[0].querySelector('table')].some((one) => one.scrollWidth > one.clientWidth),
    spill: host.scrollWidth > host.clientWidth,
  }
}"""
def check(label: str, ok: bool, got: object) -> None:
    if ok:
        say(f"[{label}] ok")
    else:
        wrong(f"[{label}] {got!r}")
def measure(page: Page, where: str, column: str, scroll: str, pane: str, room: int, wide: bool) -> None:
    got = page.evaluate(BOXES, [column, scroll, pane])
    left, right = got["column"]
    check(f"{where}: the wide table starts with the text", abs(got["wide"][0] - left) <= 1, got)
    check(f"{where}: the narrow table starts with the text", abs(got["narrow"][0] - left) <= 1, got)
    check(f"{where}: the narrow table stays in the column", got["narrow"][1] <= right + 24 + 1, got)
    check(f"{where}: the wide table stays off the pane's edge", got["wide"][1] <= got["pane"][1] - room + 1, got)
    check(f"{where}: nothing spills past the pane", not got["spill"], got)
    if wide:
        check(f"{where}: the wide table grows past the column", got["wide"][1] > right + 200, got)
        check(f"{where}: and reaches the free room", got["wide"][1] >= got["pane"][1] - room - 1, got)
    else:
        check(f"{where}: in a narrow pane the wide table scrolls", got["clipped"], got)
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1800, "height": 1000})
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Wide")
    page.wait_for_selector(".orden-table-scroll")
    DRIVE.settled(page)
    gutter = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-5'))")
    measure(page, "editor", ".cm-content", ".orden-table-scroll", ".cm-scroller", round(2 * gutter), True)
    shot(page, "editor")
    DRIVE.reading(page)
    page.wait_for_selector(".reading-table")
    measure(page, "reading", "article.orden-write", ".reading-table", ".scroller", round(gutter), True)
    shot(page, "reading")
    page.set_viewport_size({"width": 420, "height": 900})
    DRIVE.settled(page)
    measure(page, "narrow reading", "article.orden-write", ".reading-table", ".scroller", 0, False)
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    page.wait_for_selector(".orden-table-scroll")
    DRIVE.settled(page)
    measure(page, "narrow editor", ".cm-content", ".orden-table-scroll", ".cm-scroller", 0, False)
    shot(page, "narrow")
raise SystemExit(DRIVE.run(drive, "a wide table grows into the room beside the text and scrolls only past it"))
