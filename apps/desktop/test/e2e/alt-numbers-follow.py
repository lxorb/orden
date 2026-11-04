"""Each tab's number stays on its tab after Alt and a digit has switched tabs (#1110).

While Alt is held every tab wears its number at the corner of its mark (#1053), and Alt
and a digit brings that tab to the front. With Icon tabs on (#1041) the tab that comes
to the front opens out and the one it left closes up over the strip's width transition,
and the numbers were placed once, in the first frame, where the marks were leaving: they
stood off their tabs until Alt was let go of. This holds Alt, presses digits, and after
each holds every number to the corner of its own tab's mark.

Run it from the repository root:

    python apps/desktop/test/e2e/alt-numbers-follow.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist.
"""

from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

# Each number against the corner of its tab's mark, as numbers.svelte.ts places it.
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
