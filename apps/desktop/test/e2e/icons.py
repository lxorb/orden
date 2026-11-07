from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

DESKTOP = {"width": 1180, "height": 760}
PHONE = {"width": 390, "height": 844}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        failures.append(what)

def fresh(browser: Browser, label: str, viewport: dict[str, int]) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    return page

AS_PHONE = """
() => {
  const app = window.ordenApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('---\\nicon: rocket\\n---\\n\\n# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('---\\nicon: \\u{1F680}\\n---\\n\\n# Launch day\\n\\nsoon\\n', root)
  await ws.noteFrom(
    '---\\nicon: flame\\nicon-color: orange\\n---\\n\\n# Burning\\n\\nurgent\\n',
    root,
  )
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))

  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  // A folder is not a file, so its icon comes out of the space's own map.
  ws.setFolderIcon(at('Reading'), 'flat-color-icons:folder')

  ws.toggleFolder(at('Reading'))
  await ws.loadTree()
  return ws.tree.children.map((one) => one.name)
}
"""

ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) => {
  const mark = row.querySelector('.mark')
  const glyph = mark?.querySelector('svg, .emoji')
  return [
    row.textContent.trim().slice(0, 24),
    glyph?.tagName === 'SPAN' ? `emoji ${glyph.textContent}` : (glyph?.getAttribute('viewBox') ?? 'no mark'),
    glyph?.getAttribute('style') ?? '',
  ].join(' | ')
})
"""

CANVAS_ICON = """
() => {
  const ws = window.ordenApp.workspace
  const canvas = ws.files.find((one) => one.name === 'Roadmap.canvas')
  window.ordenApp.iconChoice.file(canvas.path)
  return canvas.path
}
"""

def pick(page: Page, label: str, words: str) -> None:
    page.locator(".sheet input.orden-field").fill(words)
    cell = page.locator(f'.sheet button[aria-label="{words}"]:has(svg)').first
    cell.wait_for(state="visible", timeout=PATIENCE * 1000)
    cell.click()
    say(f"[{label}] picked {words}")

def sets(page: Page, label: str, where: str) -> None:
    page.locator(".sheet input.orden-field").fill("")
    wait_for(
        page,
        "() => document.querySelectorAll('.sheet .cell').length > 8",
        f"[{label}] the sets to arrive",
    )
    page.wait_for_timeout(250)
    page.locator(".sheet").screenshot(path=str(SHOTS / f"picker-{where}.png"))
    say(f"[{label}] wrote picker-{where}.png")
    check(
        page.locator(".sheet .orden-segmented:not(.variant)").count() == 0,
        f"[{label}] the picker has no tabs",
    )

    for words, what in (("rocket", "line"), ("orden", "Orden's own mark")):
        page.locator(".sheet input.orden-field").fill(words)
        found = page.locator(f'.sheet button[aria-label="{words}"], .sheet button[aria-label="Orden"]')
        try:
            found.first.wait_for(state="visible", timeout=PATIENCE * 1000)
        except Exception:
            check(False, f"[{label}] a search for {words} finds {what}")
        page.locator(".sheet").screenshot(path=str(SHOTS / f"picker-{words}-{where}.png"))
    page.locator(".sheet input.orden-field").fill("")

GEOMETRY = """
() => {
  const sheet = document.querySelector('.sheet')
  const centre = (r) => [r.left + r.width / 2, r.top + r.height / 2]
  const off = []
  for (const cell of [...sheet.querySelectorAll('.grid .cell')].slice(0, 40)) {
    const box = cell.getBoundingClientRect()
    const glyph = cell.querySelector('.glyph').getBoundingClientRect()
    const emoji = cell.querySelector('.emoji')
    const range = document.createRange()
    if (emoji?.firstChild) range.selectNodeContents(emoji)
    const drawn = emoji ? range.getBoundingClientRect() : glyph
    const [cx, cy] = centre(box)
    for (const one of [glyph, drawn]) {
      const [x, y] = centre(one)
      off.push(Math.max(Math.abs(x - cx), Math.abs(y - cy)))
    }
  }
  const head = sheet.querySelector('.grid .head')
  const row = head?.parentElement?.nextElementSibling
  const first = row?.querySelector('.cell .glyph')
  let heading = null
  if (head && first) {
    const range = document.createRange()
    range.selectNodeContents(head)
    heading = Math.abs(range.getBoundingClientRect().left - first.getBoundingClientRect().left)
  }
  return { worst: Math.max(...off), heading, walked: sheet.querySelectorAll('.cell.at').length }
}
"""

LOOKS = """
(which) => {
  const cell = document.querySelector(which)
  if (!cell) return null
  const style = getComputedStyle(cell)
  return [style.backgroundColor, style.boxShadow].join(' / ')
}
"""

def aligned(page: Page, label: str) -> None:
    page.locator(".sheet input.orden-field").fill("")
    wait_for(page, "() => document.querySelectorAll('.sheet .grid .emoji').length > 8", f"[{label}] the emoji")
    page.wait_for_timeout(250)
    seen = page.evaluate(GEOMETRY)
    say(f"[{label}] cells: {seen}")
    check(seen["worst"] <= 0.75, f"[{label}] every glyph is centred in its cell ({seen['worst']:.2f}px off)")
    check(
        seen["heading"] is not None and seen["heading"] <= 1,
        f"[{label}] a group's heading lines up with its glyphs ({seen['heading']})",
    )
    check(seen["walked"] == 0, f"[{label}] no cell is marked before a key is pressed")

    field = page.locator(".sheet input.orden-field")
    field.press("ArrowRight")
    field.press("ArrowRight")
    walked = page.evaluate(LOOKS, ".sheet .cell.at")
    check(walked is not None, f"[{label}] the arrows mark the cell they are on")
    if label == "desktop":
        page.locator(".sheet .grid .cell").nth(5).hover()
        page.wait_for_timeout(200)
        hovered = page.evaluate(LOOKS, ".sheet .grid .cell:hover")
        check(
            walked is not None and hovered is not None and walked != hovered,
            f"[{label}] and that mark is not a hover's: {walked} against {hovered}",
        )
        page.mouse.move(0, 0)
    field.fill("rocket")
    page.wait_for_timeout(150)
    check(page.locator(".sheet .cell.at").count() == 0, f"[{label}] a new search starts unmarked")
    field.fill("")

CANVAS_WORN = (
    "() => { const ws = window.ordenApp.workspace;"
    " const c = ws.files.find((one) => one.name === 'Roadmap.canvas');"
    " return c ? [window.ordenApp.links.iconOf(c.path), window.ordenApp.links.tintOf(c.path)] : null }"
)

def outline(page: Page, label: str, where: str) -> None:
    say(f"[{label}] choosing again for {page.evaluate(CANVAS_ICON)}")
    sheet = page.locator(".sheet")
    sheet.wait_for(state="visible", timeout=PATIENCE * 1000)
    sheet.locator(".variant button").nth(1).click()
    sheet.locator("input.orden-field").fill("thinking face")
    sheet.locator(".tint").nth(3).click()
    cell = sheet.locator('button.cell[aria-label="thinking face"]:has(svg.drawn)').first
    cell.wait_for(state="visible", timeout=PATIENCE * 1000)
    page.wait_for_timeout(400)
    check(
        sheet.locator("input.orden-field").input_value() == "thinking face",
        f"[{label}] a colour painted keeps the search",
    )
    sheet.screenshot(path=str(SHOTS / f"picker-outline-{where}.png"))
    say(f"[{label}] wrote picker-outline-{where}.png")
    cell.click()

    worn = wait_for(
        page,
        f"() => {{ const w = ({CANVAS_WORN})(); return w && w[0] !== 'rocket' ? w : null }}",
        f"[{label}] the canvas to wear the outline",
    )
    check(
        worn is not None and worn[0] == "fluent-emoji-high-contrast:thinking-face",
        f"[{label}] the outline is a value of its own: `{worn}`",
    )
    check(worn is not None and worn[1] is not None, f"[{label}] and keeps the colour picked")

    row = page.locator("aside .row", has_text="Roadmap").locator(".mark svg.drawn")
    row.first.wait_for(state="visible", timeout=PATIENCE * 1000)
    check(
        "color" in (row.first.get_attribute("style") or ""),
        f"[{label}] the row draws the outline in that colour",
    )
    page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"tree-outline-{where}.png"))
    say(f"[{label}] wrote tree-outline-{where}.png")

    say(f"[{label}] and once more for {page.evaluate(CANVAS_ICON)}")
    sheet.wait_for(state="visible", timeout=PATIENCE * 1000)
    check(
        sheet.locator(".variant button").nth(1).get_attribute("aria-checked") == "true",
        f"[{label}] the picker opens on outlines for a row that wears one",
    )
    sheet.locator(".variant button").nth(0).click()
    sheet.locator("input.orden-field").fill("thinking face")
    sheet.locator('button.cell[aria-label="thinking face"]:has(.emoji)').first.click()
    worn = wait_for(
        page,
        f"() => {{ const w = ({CANVAS_WORN})(); return w && !w[0].includes(':') ? w : null }}",
        f"[{label}] the canvas to wear the emoji",
    )
    check(worn is not None and worn[0] == "\U0001F914", f"[{label}] in colour it is the emoji: `{worn}`")
    check(worn is not None and worn[1] is None, f"[{label}] which takes no colour")

def shoot(browser: Browser, where: str, viewport: dict[str, int]) -> None:
    label = where
    page = fresh(browser, label, viewport)
    try:
        say(f"[{label}] the space holds {page.evaluate(SEED)}")

        if where == "phone":
            page.evaluate(AS_PHONE)
            page.evaluate(
                "() => { const ws = window.ordenApp.workspace;"
                " if (!ws.panel) ws.showPanel('tree') }"
            )
            page.wait_for_timeout(350)

        wait_for(
            page,
            "() => document.querySelectorAll('aside .row .mark svg, aside .row .mark .emoji')"
            ".length >= 5",
            f"[{label}] a mark on every row",
        )
        page.wait_for_timeout(700)

        for one in page.evaluate(ROWS):
            say(f"[{label}] {one}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"tree-{where}.png"))
        say(f"[{label}] wrote tree-{where}.png")

        check(
            page.locator("aside .row .mark .emoji").count() >= 1,
            f"[{label}] a note wearing an emoji draws the character",
        )
        check(
            page.locator("aside .row .mark .drawn").count() >= 1,
            f"[{label}] a folder wearing a coloured drawing draws it",
        )
        check(
            page.locator('aside .row .mark svg[style*="color"]').count() >= 1,
            f"[{label}] a note with a colour on its icon is drawn in it",
        )

        say(f"[{label}] choosing for {page.evaluate(CANVAS_ICON)}")
        page.locator(".sheet").wait_for(state="visible", timeout=PATIENCE * 1000)
        sets(page, label, where)
        aligned(page, label)

        pick(page, label, "rocket")

        worn = wait_for(
            page,
            "() => { const ws = window.ordenApp.workspace;"
            " const c = ws.files.find((one) => one.name === 'Roadmap.canvas');"
            " return c ? window.ordenApp.links.iconOf(c.path) : null }",
            f"[{label}] the canvas to wear what was picked",
        )
        check(worn == "rocket", f"[{label}] the canvas kept `{worn}` in its own file")

        page.wait_for_timeout(300)
        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"tree-chosen-{where}.png"))
        say(f"[{label}] wrote tree-chosen-{where}.png")

        outline(page, label, where)
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        shoot(browser, "desktop", DESKTOP)
        shoot(browser, "phone", PHONE)

    return DRIVE.verdict(
        "icons on a note, a canvas and a folder, the picker over every set, its cells' marks, and an emoji's outline"
    )

if __name__ == "__main__":
    sys.exit(main())
