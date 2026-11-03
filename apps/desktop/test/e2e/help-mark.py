"""Every `?` sits on the words it explains, the same way after every label (#1052).

The `?` after a setting's name was centred on the name's line box, which is not where
the letters are: a line box is the font's ascent and descent and the line gap around
them, so the glyph stood a little off the words, by an amount that changed with the
face, the size and the platform. Here it is measured against the letters themselves.

For every `?` in the Settings panes a person reaches, the centre of the drawn circle
has to be within a pixel of the middle of the label's x-height - the font's own `x`,
measured on a canvas in the label's font, independently of how the page placed the
glyph - on the line of the label's last word, and the same distance after that word
on every row. That is checked at four text sizes, at one and two device pixels per
CSS pixel, on a touch screen, in the light and the dark theme, in Arabic (right to
left), and on a name squeezed until it wraps, where the `?` has to stay with the last
word rather than drop onto a line of its own.

Run it from the repository root:

    python apps/desktop/test/e2e/help-mark.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: The panes with a `?` on them that need no account.
PANES = ("general", "editor", "markdown", "appearance", "ai", "spelling")

#: And the ones only somebody signed in is shown.
SIGNED_IN = ("sync", "account")

#: How far the glyph's centre may stand from the middle of the x-height, and how far
#: one row's gap may differ from another's, in CSS pixels.
OFF_CENTRE = 0.75
GAP_SPREAD = 0.5

#: Where every visible `?` stands against the letters before it.
MEASURE = """
() => {
  const canvas = document.createElement('canvas').getContext('2d')
  const rows = []
  for (const mark of document.querySelectorAll('[role="dialog"] .explain')) {
    const svg = mark.querySelector('svg')
    const drawn = svg?.getBoundingClientRect()
    if (!drawn || !drawn.width) continue
    // The words the mark follows: the last text with letters in it before the mark.
    const walker = document.createTreeWalker(mark.parentElement, NodeFilter.SHOW_TEXT)
    let words = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (mark.contains(node)) break
      if (node.textContent.replace(/[\\s\\u2060]/g, '')) words = node
    }
    if (!words) continue
    const end = words.textContent.replace(/[\\s\\u2060]+$/, '').length
    const range = document.createRange()
    range.setStart(words, end - 1)
    range.setEnd(words, end)
    const last = [...range.getClientRects()].filter((one) => one.width).pop()
    if (!last) continue
    const style = getComputedStyle(words.parentElement)
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const x = canvas.measureText('x')
    // The text's box is its font's ascent and descent; the baseline is the ascent down.
    const baseline = last.top + x.fontBoundingBoxAscent
    const middle = baseline - x.actualBoundingBoxAscent / 2
    const centre = drawn.top + drawn.height / 2
    // The words on the glyph's line, wherever bidi put them: the gap is to the end of
    // that line in the label's direction, not to the last letter in memory.
    range.selectNodeContents(words)
    const line = [...range.getClientRects()].filter((one) => one.width && centre > one.top && centre < one.bottom)
    const rtl = style.direction === 'rtl'
    const gap = !line.length
      ? NaN
      : rtl
        ? Math.min(...line.map((one) => one.left)) - drawn.right
        : drawn.left - Math.max(...line.map((one) => one.right))
    rows.push({
      label: words.textContent.trim().slice(-24),
      size: parseFloat(style.fontSize),
      off: centre - middle,
      gap,
      sameLine: centre > last.top && centre < last.bottom,
    })
  }
  return rows
}
"""

#: The text sizes and faces a pane is checked at, set on the rows themselves: faces
#: whose ascent, descent and x-height stand in different proportions to each other,
#: which is what a platform's own UI font does to a line box.
LOOKS = (
    (None, None),
    (11, None),
    (17, None),
    (22, None),
    (None, "Liberation Sans"),
    (None, "Bitstream Charter"),
    (None, "WenQuanYi Zen Hei"),
    (None, "Loma"),
    (22, "Loma"),
)


def styled(page: Page, size: int | None, face: str | None) -> None:
    page.evaluate(
        """([size, face]) => {
          let style = document.getElementById('help-mark-look')
          if (!style) {
            style = document.createElement('style')
            style.id = 'help-mark-look'
            document.head.append(style)
          }
          style.textContent = '.nib-setting, .nib-setting * {' +
            (size ? `font-size: ${size}px !important;` : '') +
            (face ? `font-family: '${face}' !important;` : '') + '}'
        }""",
        [size, face],
    )


def check(page: Page, where: str) -> int:
    rows = page.evaluate(MEASURE)
    if not rows:
        wrong(f"{where}: no ? to measure")
        return 0
    worst = max(rows, key=lambda one: abs(one["off"]))
    gaps = [one["gap"] for one in rows if one["sameLine"]] or [0.0]
    say(
        f"{where}: {len(rows)} ?, worst {worst['off']:+.2f}px off the x-height on "
        f"{worst['label']!r} at {worst['size']}px, gaps {min(gaps):.2f}-{max(gaps):.2f}px"
    )
    for one in rows:
        if abs(one["off"]) > OFF_CENTRE:
            wrong(f"{where}: the ? after {one['label']!r} stands {one['off']:+.2f}px off the middle of the x-height")
        if not one["sameLine"]:
            wrong(f"{where}: the ? after {one['label']!r} is not on the line of the last word")
    if max(gaps) - min(gaps) > GAP_SPREAD:
        wrong(f"{where}: the gap before the ? runs from {min(gaps):.2f} to {max(gaps):.2f}px")
    return len(rows)


def panes(page: Page, tag: str, sections: tuple[str, ...]) -> None:
    counted = 0
    for section in sections:
        page.evaluate("(id) => window.nibApp.settings.show(id)", section)
        page.wait_for_timeout(500)
        for size, face in LOOKS:
            styled(page, size, face)
            page.wait_for_timeout(50)
            counted += check(page, f"[{tag}] {section} @{size or 'own'} {face or 'own face'}")
        styled(page, None, None)
        if section == "general":
            shot(page, f"{tag}-{section}")
    if counted < 6 * len(sections):
        wrong(f"[{tag}] only {counted} ? were measured")


def wrapped(page: Page, tag: str) -> None:
    """A name squeezed until it wraps: the `?` stays with its last word, on that line."""
    page.evaluate("() => window.nibApp.settings.show('general')")
    page.wait_for_timeout(500)
    for width in (60, 80, 110, 144):
        tall = page.evaluate(
            """(width) => {
              const style = document.getElementById('help-mark-wrap') ?? document.createElement('style')
              style.id = 'help-mark-wrap'
              style.textContent = `[role="dialog"] .nib-setting .name { flex: none !important;
                inline-size: ${width}px !important; min-inline-size: 0 !important }`
              document.head.append(style)
              const label = document.querySelector('[role="dialog"] .explain').parentElement
              return label.getBoundingClientRect().height
            }""",
            width,
        )
        say(f"[{tag}] names {width}px wide, the first one {tall:.0f}px tall")
        check(page, f"[{tag}] wrapped at {width}px")
        shot(page, f"{tag}-wrapped-{width}")
    page.evaluate("() => document.getElementById('help-mark-wrap')?.remove()")


def look(browser: Browser, tag: str, language: str = "en", scale: int = 1, touch: bool = False,
         scheme: str = "light") -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860}, device_scale_factor=scale)
    page.context.add_init_script(f"localStorage.setItem('nib:language', {language!r})")
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    if touch:
        page.evaluate("() => document.documentElement.toggleAttribute('data-touch', true)")
    page.evaluate("() => window.nibApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] .explain')", "the settings")
    direction = page.evaluate("() => getComputedStyle(document.querySelector('[role=\"dialog\"] .explain')).direction")
    say(f"[{tag}] direction {direction}")
    if language == "ar" and direction != "rtl":
        wrong(f"[{tag}] Arabic is drawn {direction}")
    panes(page, tag, PANES)
    wrapped(page, tag)
    page.evaluate("() => { window.nibApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' } }")
    panes(page, tag, SIGNED_IN)
    page.context.close()


def drive(browser: Browser) -> None:
    look(browser, "light")
    look(browser, "dark", scheme="dark")
    look(browser, "hidpi", scale=2)
    look(browser, "touch", touch=True)
    look(browser, "rtl", language="ar")
    look(browser, "german", language="de")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every ? sits on the middle of its label's letters"))
