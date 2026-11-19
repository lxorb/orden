import io
import json
from PIL import Image
from playwright.sync_api import Browser, Page
from harness import Drive
from settling import NO_CARET, quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
APART = 4
QUIET = NO_CARET + """
  footer[data-region="status"], .fab { visibility: hidden !important }
  [data-panes] { background: #ff00ff !important }
"""
CARDS = """
() => {
  const ws = window.ordenApp.workspace
  const round = parseFloat(getComputedStyle(document.querySelector('main')).getPropertyValue('--card-radius')) || 0
  const all = [...document.querySelectorAll('[data-pane]')].filter((one) => one.getClientRects().length)
  const boxes = all.map((one) => one.getBoundingClientRect())
  return all.map((pane, at) => {
    const id = pane.dataset.pane
    const box = boxes[at]
    const head = pane.querySelector(':scope > .head')
    const top = head ? head.getBoundingClientRect().bottom : box.top
    const strip = head
      ? head.querySelector('.tabs')
      : document.querySelector(`header [data-top-strip="${CSS.escape(id)}"] .tabs`)
    const below = boxes.some((other, one) => one !== at && other.top >= box.bottom - 1
      && other.left < box.right - 1 && other.right > box.left + 1)
    return {
      id,
      kind: ws.showing(id)?.kind ?? 'empty',
      left: box.left,
      right: box.right,
      top,
      bottom: box.bottom,
      round,
      foot: !below,
      flush: !!strip && strip.classList.contains('flush') && !!strip.querySelector('.tab.first.active'),
    }
  })
}
"""
def apart(one: tuple[int, ...], other: tuple[int, ...]) -> int:
    return max(abs(a - b) for a, b in zip(one[:3], other[:3]))
def checked(page: Page, label: str) -> None:
    quiet(page)
    cards = page.evaluate(CARDS)
    shot = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    DRIVE.shot(page, label)
    for card in cards:
        reach = round(card["round"]) + 4
        left, top = int(card["left"]) + 1, int(card["top"]) + 1
        right, bottom = -int(-card["right"]) - 2, -int(-card["bottom"]) - 2
        corners = {
            "top left": ((left, top), (1, 1), not card["flush"]),
            "top right": ((right, top), (-1, 1), True),
            "bottom right": ((right, bottom), (-1, -1), not card["foot"]),
            "bottom left": ((left, bottom), (1, -1), not card["foot"]),
        }
        for name, ((x, y), (dx, dy), rounded) in corners.items():
            at = shot.getpixel((x, y))
            along = shot.getpixel((x + dx * reach, y))
            down = shot.getpixel((x, y + dy * reach))
            off = min(apart(at, along), apart(at, down))
            where = f"[{label}] the {card['kind']} pane's {name} corner"
            say(f"{where}: {at} beside {along} and {down}, {off} apart, wanted {'round' if rounded else 'square'}")
            if rounded and off <= APART:
                wrong(f"{where} is square, where the card is rounded: {json.dumps(card)}")
            if not rounded and off > APART:
                wrong(f"{where} is cut round, where the card meets the window: {json.dumps(card)}")
ARRANGE = """
async () => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom('# Corners\\n\\nA few words.\\n', ws.activeSpace.root)
  await ws.loadTree()
  if (ws.panel !== 'tree') ws.showPanel('tree')
  ws.showRight('outline')
}
"""
SPLITS = {
    "one": [],
    "side by side": [("row", 0)],
    "stacked": [("column", 0)],
    "three": [("row", 0), ("column", 1)],
}
KINDS = {"note": "note", "web": "web", "page": "pages"}
OPEN = """async ([pane, kind]) => {
  const ws = window.ordenApp.workspace
  ws.focusPane(pane)
  if (kind === 'note') await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Corners')).path, { activate: true })
  if (kind === 'web') ws.openPage('https://example.com/')
  if (kind === 'page') await ws.createPages(undefined, 'Corners.pages')
}"""
def fill(page: Page, kind: str) -> None:
    for pane in page.evaluate("() => window.ordenApp.workspace.panes.all.map((one) => one.id)"):
        shows = f"window.ordenApp.workspace.showing({json.dumps(pane)})?.kind === {json.dumps(KINDS[kind])}"
        for _try in range(4):
            page.evaluate(OPEN, [pane, kind])
            page.wait_for_timeout(700)
            if page.evaluate(f"() => {shows}"):
                break
        wait_for(page, shows, f"a {kind} in pane {pane}")
def drive(browser: Browser) -> None:
    for layout, splits in SPLITS.items():
        context = DRIVE.context(browser, viewport={"width": 1280, "height": 820}, reduced_motion="reduce")
        page = context.new_page()
        DRIVE.open(page)
        wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
        page.add_style_tag(content=QUIET)
        page.evaluate(ARRANGE)
        wait_for(page, "!!document.querySelector('.panels.right.open')", "the right side")
        for along, at in splits:
            count = page.evaluate("() => window.ordenApp.workspace.panes.all.length")
            page.evaluate(
                f"() => {{ const ws = window.ordenApp.workspace; ws.focusPane(ws.panes.all[{at}].id); ws.split('{along}') }}"
            )
            wait_for(page, f"window.ordenApp.workspace.panes.all.length === {count + 1}", f"a {along} split")
        for kind in ("note", "web", "page"):
            fill(page, kind)
            checked(page, f"{layout.replace(' ', '-')}-{kind}")
        context.close()
raise SystemExit(DRIVE.run(drive, "every pane's card is rounded at every corner but where it meets the window"))
