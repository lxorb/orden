from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NEAR = 1.0

WHOLE = """
(bubble) => {
  const box = bubble.getBoundingClientRect()
  const cut = []
  for (let up = bubble.parentElement; up && up !== document.documentElement; up = up.parentElement) {
    const style = getComputedStyle(up)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const holder = up.getBoundingClientRect()
    if (box.left < holder.left - 0.5 || box.right > holder.right + 0.5 ||
        box.top < holder.top - 0.5 || box.bottom > holder.bottom + 0.5)
      cut.push(`${up.tagName.toLowerCase()}.${[...up.classList].join('.')}`)
  }
  const outside = box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight
  return {
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
           width: box.width, height: box.height },
    cut, outside,
    shown: getComputedStyle(bubble).visibility !== 'hidden',
    z: parseInt(getComputedStyle(bubble).zIndex, 10) || 0,
    side: bubble.dataset.side ?? null,
  }
}
"""

GLYPHS = "() => [...document.querySelectorAll('[role=\"dialog\"] .explain button')].length"

def sentence_of(page: Page, index: int) -> dict | None:
    return page.evaluate(
        """async ([index, whole]) => {
          const glyph = document.querySelectorAll('[role="dialog"] .explain button')[index]
          if (!glyph) return null
          glyph.scrollIntoView({ block: 'center' })
          glyph.focus()
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
          await new Promise((done) => setTimeout(done, 200))
          // The newest: the one before may still be fading out after it.
          const bubble = [...document.querySelectorAll('.orden-bubble.sentence')].pop()
          if (!bubble) return { missing: true }
          // Measured where it rests, not part of the way through its rise.
          await Promise.all(bubble.getAnimations().map((one) => one.finished.catch(() => null)))
          const mark = glyph.closest('.explain').getBoundingClientRect()
          const dialog = glyph.closest('[role="dialog"]')
          let rung = 0
          for (let up = dialog; up; up = up.parentElement) {
            const z = parseInt(getComputedStyle(up).zIndex, 10)
            if (getComputedStyle(up).position !== 'static' && !Number.isNaN(z)) rung = z
          }
          const measured = window.__whole(bubble)
          glyph.blur()
          return { ...measured, rung, rtl: getComputedStyle(glyph).direction === 'rtl',
                   mark: { left: mark.left, right: mark.right, top: mark.top, bottom: mark.bottom },
                   label: glyph.getAttribute('aria-label').slice(0, 32) }
        }""",
        [index, WHOLE],
    )

def placed(one: dict, gap: float, inset: float) -> str | None:
    box, mark = one["box"], one["mark"]
    top = mark["bottom"] + gap if one["side"] != "above" else mark["top"] - gap - box["height"]
    if abs(box["top"] - top) > NEAR:
        return f"its top is {box['top']:.1f}, not {top:.1f}"
    start = mark["right"] - inset - box["width"] if one["rtl"] else mark["left"] + inset
    clamped = min(max(8, start), DRIVE_WIDTH - 8 - box["width"])
    if abs(box["left"] - clamped) > NEAR:
        return f"its left is {box['left']:.1f}, not {clamped:.1f}"
    return None

DRIVE_WIDTH = 1280

def every_sentence(page: Page, tag: str, sections: tuple[str, ...]) -> int:
    counted = 0
    for section in sections:
        page.evaluate("(id) => window.nibApp.settings.show(id)", section)
        page.wait_for_timeout(500)
        for index in range(page.evaluate(GLYPHS)):
            one = sentence_of(page, index)
            if one is None:
                continue
            where = f"[{tag}] {section}: the sentence of {one.get('label', index)!r}"
            if one.get("missing"):
                wrong(f"{where} did not open")
                continue
            counted += 1
            if one["cut"]:
                wrong(f"{where} is cut by {one['cut']} ({one['box']['height']:.0f}px tall)")
            if one["outside"]:
                wrong(f"{where} stands out of the window: {one['box']}")
            if not one["shown"]:
                wrong(f"{where} is hidden while its ? is in sight")
            if one["z"] < one["rung"]:
                wrong(f"{where} stands on {one['z']}, under the settings' {one['rung']}")
            off = placed(one, 6, -3)
            if off:
                wrong(f"{where} is not under its ?: {off}")
        shot(page, f"{tag}-{section}")
    say(f"[{tag}] {counted} sentences opened whole")
    return counted

def the_vault_row(page: Page, tag: str) -> None:
    page.evaluate("() => window.nibApp.settings.show('ai')")
    page.wait_for_timeout(500)
    glyph = page.locator("[role=switch]", has_text="vault").first.locator(".explain button")
    glyph.hover()
    wait_for(page, "() => !!document.querySelector('.orden-bubble.sentence')", "the vault's sentence")
    page.wait_for_timeout(250)
    one = page.evaluate("() => window.__whole(document.querySelector('.orden-bubble.sentence'))")
    say(f"[{tag}] the vault's sentence: {one['box']['width']:.0f}x{one['box']['height']:.0f}, cut by {one['cut']}")
    if one["cut"] or one["box"]["height"] < 30:
        wrong(f"[{tag}] the vault's sentence is cut: {one}")
    shot(page, f"{tag}-vault")
    page.mouse.move(5, 5)

def at_the_foot(page: Page, tag: str) -> None:
    page.evaluate("() => window.nibApp.settings.show('general')")
    page.wait_for_timeout(500)
    one = page.evaluate(
        """async (whole) => {
          const glyphs = [...document.querySelectorAll('[role="dialog"] .explain button')]
          const glyph = glyphs[glyphs.length - 1]
          let pane = glyph.parentElement
          while (pane && !(pane.scrollHeight > pane.clientHeight + 4 &&
                 ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY))) pane = pane.parentElement
          // The glyph's row at the very foot of what the pane shows.
          const held = pane.getBoundingClientRect()
          pane.scrollTop += glyph.getBoundingClientRect().bottom - held.bottom + 2
          await new Promise((done) => setTimeout(done, 100))
          glyph.focus({ preventScroll: true })
          await new Promise((done) => setTimeout(done, 250))
          const bubble = document.querySelector('.orden-bubble.sentence')
          const foot = window.__whole(bubble)
          const room = innerHeight - glyph.getBoundingClientRect().bottom
          // And the glyph scrolled out of sight with its sentence up.
          pane.scrollTop -= held.height + 200
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
          const away = window.__whole(bubble)
          glyph.blur()
          return { foot, away, room }
        }""",
        WHOLE,
    )
    foot, away = one["foot"], one["away"]
    say(f"[{tag}] at the foot ({one['room']:.0f}px under it): side {foot['side']}, cut by {foot['cut']}; scrolled away: shown {away['shown']}")
    if foot["cut"] or foot["outside"] or not foot["shown"]:
        wrong(f"[{tag}] the sentence of a ? at the foot of its pane is not whole: {foot}")
    if one["room"] < foot["box"]["height"] + 14 and foot["side"] != "above":
        wrong(f"[{tag}] the sentence of a ? at the foot of its pane was not turned over")
    if away["shown"]:
        wrong(f"[{tag}] the sentence of a ? scrolled out of sight is still drawn")

def names(page: Page, tag: str) -> None:
    DRIVE.seed(page, *[f"# Note {one}\n" for one in range(1, 4)])
    page.evaluate("() => { const ws = window.nibApp.workspace; if (!ws.openOn('left')) ws.toggleSidebar('left') }")
    page.wait_for_timeout(400)
    page.evaluate(
        """() => { const ws = window.nibApp.workspace
          const last = document.querySelector("aside .row[data-path$='/Note 3.md']").dataset.path
          ws.startRenaming(last) }"""
    )
    field = page.locator("aside .row .naming input")
    field.wait_for(state="visible")
    for typed, held in (("a/b", False), ("AGENTS", True)):
        field.fill(typed)
        wait_for(page, "() => !!document.querySelector('.orden-bubble.reason')", f"the reason for {typed!r}")
        page.wait_for_timeout(250)
        one = page.evaluate(
            """(whole) => {
              const bubble = document.querySelector('.orden-bubble.reason')
              const naming = document.querySelector('aside .row .naming').getBoundingClientRect()
              return { ...window.__whole(bubble), naming: { left: naming.left, right: naming.right,
                       bottom: naming.bottom, width: naming.width },
                       widest: parseFloat(getComputedStyle(bubble).maxWidth) }
            }""",
            WHOLE,
        )
        where = f"[{tag}] the reason for {typed!r}"
        say(f"{where}: {one['box']['width']:.0f}x{one['box']['height']:.0f} at {one['box']['left']:.0f},{one['box']['top']:.0f}, cut by {one['cut']}")
        if one["cut"] or one["outside"] or not one["shown"]:
            wrong(f"{where} is not whole: {one}")
        if abs(one["box"]["top"] - (one["naming"]["bottom"] + 4)) > NEAR:
            wrong(f"{where} is not under the field: {one['box']['top']:.1f} for {one['naming']['bottom'] + 4:.1f}")
        if held:
            wide = min(one["naming"]["width"], one["widest"])
            if abs(one["box"]["width"] - wide) > NEAR:
                wrong(f"{where} is {one['box']['width']:.1f} wide, not the row's {wide:.1f}")
        shot(page, f"{tag}-reason-{'held' if held else 'plain'}")
    field.press("Escape")

def look(browser: Browser, tag: str, language: str = "en") -> None:
    page = DRIVE.page(browser, viewport={"width": DRIVE_WIDTH, "height": 860})
    page.context.add_init_script(f"localStorage.setItem('orden:language', {language!r})")
    DRIVE.open(page)
    page.evaluate(f"() => {{ window.__whole = {WHOLE} }}")
    names(page, tag)
    page.evaluate("() => window.nibApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] .explain')", "the settings")
    counted = every_sentence(page, tag, ("general", "editor", "markdown", "appearance", "ai", "spelling"))
    at_the_foot(page, tag)
    page.evaluate("() => { window.nibApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' } }")
    counted += every_sentence(page, tag, ("sync", "account", "ai"))
    if tag == "light":
        the_vault_row(page, tag)
    if counted < 30:
        wrong(f"[{tag}] only {counted} sentences were opened")
    page.context.close()

def drive(browser: Browser) -> None:
    look(browser, "light")
    look(browser, "rtl", language="ar")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every bubble is drawn whole, under what it is about"))
