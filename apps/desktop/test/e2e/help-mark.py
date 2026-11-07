from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PANES = ("general", "editor", "markdown", "appearance", "ai", "spelling")

SIGNED_IN = ("sync", "account", "ai")

OFF_CENTRE = 0.75
GAP_SPREAD = 0.5
OUTSIDE = 0.5

KINDS = {"orden-hint": "?", "orden-outward": "arrow"}

MEASURE = """
(kinds) => {
  const canvas = document.createElement('canvas').getContext('2d')
  const rows = []
  for (const mark of document.querySelectorAll('[role="dialog"] .orden-mark')) {
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
    // Inside the box the words are in, which keeps the end of the line for the glyph.
    const box = mark.parentElement.getBoundingClientRect()
    const outside = rtl ? box.left - drawn.left : drawn.right - box.right
    // Glued to the last word: a word joiner straight after it, and not even a space
    // between, which would widen the gap. Svelte's anchors are comments, and no text.
    let before = mark.previousSibling
    while (before?.nodeType === Node.COMMENT_NODE) before = before.previousSibling
    const glued = mark.firstChild?.nodeType === Node.TEXT_NODE && mark.firstChild.textContent === '\\u2060'
      && before === words && !/\\s$/.test(words.textContent)
    rows.push({
      kind: Object.entries(kinds).find(([name]) => mark.classList.contains(name))?.[1] ?? mark.className,
      label: words.textContent.trim().slice(-24),
      size: parseFloat(style.fontSize),
      off: centre - middle,
      gap,
      sameLine: centre > last.top && centre < last.bottom,
      outside,
      glued,
    })
  }
  return rows
}
"""

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
          // Every row, and whatever else holds a mark: a caption, a link.
          style.textContent = '.orden-setting, .orden-setting *, :has(> .orden-mark), :has(> .orden-mark) * {' +
            (size ? `font-size: ${size}px !important;` : '') +
            (face ? `font-family: '${face}' !important;` : '') + '}'
        }""",
        [size, face],
    )

def check(page: Page, where: str, kinds: tuple[str, ...] = ("?",)) -> int:
    rows = page.evaluate(MEASURE, KINDS)
    for kind in kinds:
        if not any(one["kind"] == kind for one in rows):
            wrong(f"{where}: no {kind} to measure")
    if not rows:
        return 0
    worst = max(rows, key=lambda one: abs(one["off"]))
    say(
        f"{where}: {len(rows)} marks, worst {worst['off']:+.2f}px off the x-height on "
        f"the {worst['kind']} after {worst['label']!r} at {worst['size']}px"
    )
    for one in rows:
        mark = f"the {one['kind']} after {one['label']!r}"
        if abs(one["off"]) > OFF_CENTRE:
            wrong(f"{where}: {mark} stands {one['off']:+.2f}px off the middle of the x-height")
        if not one["sameLine"]:
            wrong(f"{where}: {mark} is not on the line of the last word")
        if one["outside"] > OUTSIDE:
            wrong(f"{where}: {mark} stands {one['outside']:.2f}px out of the box of its words")
        if not one["glued"]:
            wrong(f"{where}: {mark} is not joined to the last word")
    for kind in sorted({one["kind"] for one in rows}):
        gaps = [one["gap"] for one in rows if one["kind"] == kind and one["sameLine"]] or [0.0]
        say(f"{where}: {kind} gaps {min(gaps):.2f}-{max(gaps):.2f}px")
        if max(gaps) - min(gaps) > GAP_SPREAD:
            wrong(f"{where}: the gap before the {kind} runs from {min(gaps):.2f} to {max(gaps):.2f}px")
    return len(rows)

def panes(page: Page, tag: str, sections: tuple[str, ...], arrows: tuple[str, ...] = ()) -> None:
    counted = 0
    for section in sections:
        page.evaluate("(id) => window.ordenApp.settings.show(id)", section)
        page.wait_for_timeout(500)
        kinds = ("?", "arrow") if section in arrows else ("?",)
        for size, face in LOOKS:
            styled(page, size, face)
            page.wait_for_timeout(50)
            counted += check(page, f"[{tag}] {section} @{size or 'own'} {face or 'own face'}", kinds)
        styled(page, None, None)
        if section in ("general", *arrows):
            shot(page, f"{tag}-{section}")
    if counted < 6 * len(sections):
        wrong(f"[{tag}] only {counted} marks were measured")

WIDTHS = (60, 80, 110, 144, 177, 210, 250, 300)

def wrapped(page: Page, tag: str, section: str, kinds: tuple[str, ...]) -> None:
    page.evaluate("(id) => window.ordenApp.settings.show(id)", section)
    page.wait_for_timeout(500)
    for width in WIDTHS:
        tall = page.evaluate(
            """(width) => {
              const style = document.getElementById('help-mark-wrap') ?? document.createElement('style')
              style.id = 'help-mark-wrap'
              style.textContent = `[role="dialog"] .orden-setting .name { flex: none !important;
                inline-size: ${width}px !important; min-inline-size: 0 !important }
                [role="dialog"] :is(.hint.caption, .steps .link) {
                  max-inline-size: ${Math.max(width, 110)}px !important }`
              document.head.append(style)
              return Math.max(...[...document.querySelectorAll('[role="dialog"] .orden-mark')]
                .map((mark) => mark.parentElement.getBoundingClientRect().height))
            }""",
            width,
        )
        say(f"[{tag}] {section} squeezed to {width}px, the tallest words {tall:.0f}px tall")
        check(page, f"[{tag}] {section} wrapped at {width}px", kinds)
        shot(page, f"{tag}-{section}-wrapped-{width}")
    page.evaluate("() => document.getElementById('help-mark-wrap')?.remove()")

def look(browser: Browser, tag: str, language: str = "en", scale: int = 1, touch: bool = False,
         scheme: str = "light") -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860}, device_scale_factor=scale)
    page.context.add_init_script(
        f"localStorage.setItem('orden:language', {language!r}); localStorage.setItem('orden:access-choice', 'claude')"
    )
    DRIVE.open(page)
    page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
    if touch:
        page.evaluate("() => document.documentElement.toggleAttribute('data-touch', true)")
    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] .explain')", "the settings")
    direction = page.evaluate("() => getComputedStyle(document.querySelector('[role=\"dialog\"] .explain')).direction")
    say(f"[{tag}] direction {direction}")
    if language == "ar" and direction != "rtl":
        wrong(f"[{tag}] Arabic is drawn {direction}")
    machine = language in ("ar", "es")
    panes(page, tag, PANES, ("general",) if machine else ())
    wrapped(page, tag, "general", ("?", "arrow") if machine else ("?",))
    page.evaluate("() => { window.ordenApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' } }")
    panes(page, tag, SIGNED_IN, ("ai",))
    wrapped(page, tag, "ai", ("?", "arrow"))
    page.context.close()

def drive(browser: Browser) -> None:
    look(browser, "light")
    look(browser, "dark", scheme="dark")
    look(browser, "hidpi", scale=2)
    look(browser, "touch", touch=True)
    look(browser, "rtl", language="ar")
    look(browser, "german", language="de")
    look(browser, "spanish", language="es")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every mark sits on the middle of the letters of the words it follows"))
