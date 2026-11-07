from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ORIGIN = DRIVE.origin
DIST = harness.DIST

def shot(page: Page, name: str, selector: str | None = None) -> None:
    DRIVE.shot(page.locator(selector) if selector else page, name)

MARK = "/mark.png"

DRESSED = "---\nicon: rocket\n---\n\n# Plan\n\nA note that chose an icon.\n"

def shortcut(url: str, title: str, icon: str | None) -> str:

    rows = [f"URL={url}", f"Title={title}", "Orden-Added=2026-09-13T08:00:00.000Z"]
    if icon:
        rows.append(f"Orden-Icon={icon}")

    return "[InternetShortcut]\r\n" + "\r\n".join(rows) + "\r\n"

SEED = """
async (site) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root

  for (const one of [...ws.tabs]) ws.close(one.id)

  const plan = await ws.noteFrom(site.dressed, root)
  const marked = await ws.noteFrom(site.marked, root)
  await ws.rename(marked, 'A site with a mark.url')
  const plain = await ws.noteFrom(site.plain, root)
  await ws.rename(plain, 'A site with no mark.url')
  await ws.loadTree()

  const at = (name) => ws.files.find((one) => one.name === name)?.path ?? null

  return {
    held: ws.files.map((one) => one.name),
    plan,
    marked: at('A site with a mark.url'),
    plain: at('A site with no mark.url'),
  }
}
"""

OPEN = """
async (where) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root

  await ws.openEntry(where.plan, {})
  await ws.createCanvas(root, 'Roadmap.canvas')
  await ws.createPages(root, 'Lecture.pages')
  ws.openGraph()

  // A web note in a browser build opens a browser tab rather than one of nib's
  // (docs/web-tabs.md), so the two websites come in the way a sitting puts them back:
  // written into the arrangement, as the desktop app's session holds them.
  const layout = ws.layout()
  const pane = layout.frame.pane
  for (const [path, name] of [[where.marked, 'A site with a mark'], [where.plain, 'A site with no mark']]) {
    const doc = (await ws.noteText(path)) ?? ''
    pane.tabs.push({ kind: 'web', path, name, doc, dirty: false, cursor: 0, scroll: 0 })
  }
  pane.active = pane.tabs.length - 1
  await ws.applyLayout(layout)

  return ws.tabs.map((one) => [one.kind, one.shown])
}
"""

STRIP = """
() => {
  const hairline = (svg) => {
    const units = svg.viewBox?.baseVal?.width || 24
    const drawn = svg.getBoundingClientRect().width
    const said = parseFloat(getComputedStyle(svg).strokeWidth) || 0
    return Math.round((said * drawn / units) * 1000) / 1000
  }

  return [...document.querySelectorAll('.tab')].map((tab) => {
    const pick = tab.querySelector('.pick')
    // The mark sits in the tab's face since the strip took Chrome's shape (917497b4);
    // counted there, so a second mark anywhere in the face still counts as two.
    const face = pick.querySelector('.face') ?? pick
    const marks = [...face.children].filter((one) => one.classList.contains('mark'))
    const mark = marks[0] ?? null
    const box = mark?.getBoundingClientRect() ?? null
    const seat = pick.getBoundingClientRect()
    const svg = mark?.querySelector('svg') ?? null
    const img = mark?.querySelector('img') ?? null

    return {
      name: tab.querySelector('.label')?.textContent ?? null,
      // A tab drawn as an icon is its mark alone, which is the one place the mark is
      // the whole of what the reader has to go on (#1041).
      icon: tab.classList.contains('icon'),
      shut: !!tab.querySelector('.shut'),
      marks: marks.length,
      kind: img ? 'picture' : svg ? 'stroke' : 'nothing',
      width: box ? Math.round(box.width * 100) / 100 : null,
      height: box ? Math.round(box.height * 100) / 100 : null,
      // Where the mark sits inside the tab's own button, which is what makes every
      // name in the strip start at the same place.
      at: box ? Math.round((box.left - seat.left) * 100) / 100 : null,
      middle: box ? Math.round((box.top + box.height / 2 - seat.top) * 100) / 100 : null,
      tab: Math.round(tab.getBoundingClientRect().width * 100) / 100,
      hairline: svg ? hairline(svg) : null,
      drawing: svg ? (svg.querySelector('path')?.getAttribute('d') ?? '').slice(0, 44) : null,
      src: img?.getAttribute('src') ?? null,
      // Whether the picture really arrived, rather than merely being asked for.
      arrived: img ? img.naturalWidth > 0 : null,
    }
  })
}
"""

PIN = """
() => {
  const ws = window.nibApp.workspace
  const other = ws.tabs.find((one) => !(one.name ?? '').startsWith('Plan'))
  ws.activate(other.id)
}
"""

CHOOSE = """
() => {
  const ws = window.nibApp.workspace
  const canvas = ws.files.find((one) => one.name === 'Roadmap.canvas')
  window.nibApp.iconChoice.file(canvas.path)
  return canvas.path
}
"""

ROWS = """
() =>
  Object.fromEntries(
    [...document.querySelectorAll('.orden-row.row')].map((row) => [
      row.querySelector('.orden-row-label')?.textContent ?? '',
      (row.querySelector('.mark svg path')?.getAttribute('d') ?? '').slice(0, 44),
    ]),
  )
"""

@DRIVE.answers
def marks(request: harness.Files) -> bool:
    if request.path not in {MARK, "/favicon.ico"}:
        return False
    return request.reply((DIST / "icon-256.png").read_bytes(), "image/png")

def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{scheme}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{scheme}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda answer: wrong(f"[{scheme}] nothing at {answer.url}")
        if answer.status == 404
        else None,
    )
    DRIVE.open(page)
    page.wait_for_timeout(300)
    return page

def website(path: str) -> str:
    return f"{ORIGIN}{path}"

def iconned(page: Page, scheme: str) -> None:

    page.evaluate(PIN)
    page.wait_for_timeout(700)

    strip = page.evaluate(STRIP)
    chip = next((one for one in strip if (one["name"] or "").startswith("Plan")), None)
    beside = next((one for one in strip if one is not chip), None)
    say(f"[{scheme}] the icon chip: {json.dumps(chip, ensure_ascii=False)}")
    shot(page, f"03-the-icon-chip-{scheme}", ".strip")

    if not chip or not beside:
        wrong(f"[{scheme}] the strip lost its tabs when another was put in front")
        return

    if not chip["icon"]:
        wrong(f"[{scheme}] the tab behind is not drawn as its icon")
    if chip["shut"]:
        wrong(f"[{scheme}] a tab drawn as its icon offers a cross")
    if chip["tab"] > 48:
        wrong(f"[{scheme}] a tab drawn as its icon is as wide as a named one: {chip['tab']}px")

    row = page.evaluate(ROWS).get("Plan", "")
    if chip["drawing"] != row:
        wrong(f"[{scheme}] the icon chip wears {chip['drawing']!r} where the row wears {row!r}")
    if (chip["width"], chip["height"]) != (beside["width"], beside["height"]):
        wrong(f"[{scheme}] the chip's mark is not the box the other tabs keep: {chip}")

def chooses(page: Page, scheme: str) -> None:

    say(f"[{scheme}] choosing an icon for {page.evaluate(CHOOSE)}")
    page.locator(".sheet").wait_for(state="visible", timeout=30_000)
    page.locator(".sheet input.orden-field").fill("anchor")
    cell = page.locator('.sheet button[aria-label="anchor"]:has(svg)').first
    cell.wait_for(state="visible", timeout=30_000)
    cell.click()
    page.wait_for_timeout(900)
    page.evaluate("() => window.nibApp.iconChoice.close()")
    page.wait_for_timeout(400)

    strip = page.evaluate(STRIP)
    rows = page.evaluate(ROWS)
    tab = next((one for one in strip if one["name"] == "Roadmap"), None)
    row = rows.get("Roadmap", "")
    drawn = tab["drawing"] if tab else None
    say(f"[{scheme}] Roadmap now wears {row!r} in the list and {drawn!r} in the strip")
    shot(page, f"04-an-icon-chosen-{scheme}", ".strip")

    if not row:
        wrong(f"[{scheme}] the chosen icon never reached the row it was chosen on")
    elif drawn != row:
        wrong(f"[{scheme}] an icon chosen in the list did not reach the tab: {drawn!r}")

def drive(page: Page, scheme: str) -> list[dict]:
    where = page.evaluate(
        SEED,
        {
            "dressed": DRESSED,
            "marked": shortcut(f"{ORIGIN}/index.html", "A site with a mark", website(MARK)),
            "plain": shortcut(f"{ORIGIN}/index.html", "A site with no mark", None),
        },
    )
    say(f"[{scheme}] the space holds {json.dumps(where['held'], ensure_ascii=False)}")
    page.wait_for_timeout(600)

    opened = page.evaluate(OPEN, where)
    say(f"[{scheme}] the tabs: {json.dumps(opened, ensure_ascii=False)}")
    page.wait_for_timeout(2000)

    page.keyboard.press("Control+Shift+e")
    page.wait_for_timeout(900)

    strip = page.evaluate(STRIP)
    say(f"[{scheme}] the strip: {json.dumps(strip, ensure_ascii=False)}")

    shot(page, f"01-the-strip-{scheme}", ".strip")
    shot(page, f"02-the-window-{scheme}")

    if len(strip) != 6:
        wrong(f"[{scheme}] the strip holds {len(strip)} tabs rather than six")
        return strip

    for one in strip:
        if one["marks"] != 1:
            wrong(f"[{scheme}] {one['name']} wears {one['marks']} marks rather than one")
        if one["kind"] == "nothing":
            wrong(f"[{scheme}] {one['name']} wears no mark at all")

    boxes = {(one["width"], one["height"]) for one in strip}
    seats = {(one["at"], one["middle"]) for one in strip}
    if len(boxes) != 1:
        wrong(f"[{scheme}] the marks are not one box: {sorted(boxes)}")
    if len(seats) != 1:
        wrong(f"[{scheme}] the marks do not sit in one place: {sorted(seats)}")
    say(f"[{scheme}] one box {boxes.pop()} at one place {seats.pop()}")

    hairlines = {one["hairline"] for one in strip if one["hairline"] is not None}
    if max(hairlines) - min(hairlines) > 0.02:
        wrong(f"[{scheme}] the strokes are not one weight: {sorted(hairlines)}")
    say(f"[{scheme}] one hairline: {sorted(hairlines)}")

    drawings = [one["drawing"] for one in strip if one["drawing"]]
    if len(set(drawings)) != len(drawings):
        wrong(f"[{scheme}] two tabs wear the same drawing: {drawings}")

    marked = next((one for one in strip if "with a mark" in (one["name"] or "")), None)
    plain = next((one for one in strip if "with no mark" in (one["name"] or "")), None)
    if not marked or marked["kind"] != "picture":
        wrong(f"[{scheme}] the site with a mark does not wear its favicon: {marked}")
    elif marked["src"] != website(MARK):
        wrong(f"[{scheme}] the favicon came from {marked['src']}")
    elif not marked["arrived"]:
        wrong(f"[{scheme}] the favicon was asked for and never arrived")
    if not plain or plain["kind"] != "stroke":
        wrong(f"[{scheme}] the site with no mark does not fall back to the globe: {plain}")

    rows = page.evaluate(ROWS)
    tab = next((one for one in strip if one["name"] == "Plan"), None)
    row = rows.get("Plan", "")
    say(f"[{scheme}] Plan wears {row!r} in the list and {tab and tab['drawing']!r} in the strip")
    if not row:
        wrong(f"[{scheme}] there is no row for the note that chose an icon")
    elif tab and row != tab["drawing"]:
        wrong(f"[{scheme}] the tab wears {tab['drawing']!r} where the row wears {row!r}")

    iconned(page, scheme)
    chooses(page, scheme)
    return strip

def main() -> int:
    measured: dict[str, list[dict]] = {}
    with DRIVE.session() as browser:
        for scheme in ["light", "dark"]:
            say(f"--- {scheme} ---")
            page = fresh(browser, scheme)
            try:
                measured[scheme] = drive(page, scheme)
            finally:
                page.context.close()

    if len(measured) == 2:
        shapes = [
            [(one["name"], one["width"], one["at"], one["tab"]) for one in rows]
            for rows in measured.values()
        ]
        if shapes[0] != shapes[1]:
            wrong(f"the strip is not the same shape in both schemes: {shapes}")

    return DRIVE.verdict(
        "six kinds of tab, one mark each, one box, one weight, one place - and the"
        " file's own mark in the strip as in the list, down to the chip a tab behind is drawn as"
    )

if __name__ == "__main__":
    raise SystemExit(main())
