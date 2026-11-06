from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

OFF = """() => {
  const strip = document.querySelector('[data-strip]')
  const marks = [...strip.querySelectorAll('.pick[data-tab]')].map((pick) => {
    const face = pick.querySelector('.face')
    return (face?.getClientRects().length ? face : pick).getBoundingClientRect()
  })
  const numbers = [...document.querySelectorAll('.numeral')].map((one) => {
    const [x, y] = getComputedStyle(one).translate.split(' ').map(parseFloat)
    return { x, y }
  })
  return numbers.map((one, at) => {
    const mark = marks[at]
    return mark ? Math.max(Math.abs(one.x - mark.right), Math.abs(one.y - mark.bottom)) : -1
  })
}"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 800})
    DRIVE.open(page)
    names = ("One", "Two", "Three", "Four")
    DRIVE.seed(page, *(f"# {name}\n\nWords.\n" for name in names))
    for name in names:
        DRIVE.open_note(page, name)
    page.mouse.move(700, 500)
    page.wait_for_timeout(800)

    page.keyboard.down("Alt")
    page.wait_for_timeout(300)
    for digit in ("2", "4", "1", "3"):
        page.keyboard.press(digit)
        page.wait_for_timeout(600)
        off = page.evaluate(OFF)
        say(f"Alt+{digit}: {len(off)} numbers, the farthest {max(off, default=0):.1f} off its mark")
        if not off:
            wrong(f"Alt+{digit}: no numbers while Alt is held")
        elif max(off) > 1 or min(off) < 0:
            wrong(f"Alt+{digit}: the numbers stand off their tabs: {[round(one, 1) for one in off]}")
    page.keyboard.up("Alt")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the numbers follow their tabs"))
