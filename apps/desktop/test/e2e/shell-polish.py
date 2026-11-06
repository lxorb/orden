from __future__ import annotations

import io
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

SLACK = 1.0

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")

def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "() => !!window.nibApp.workspace.active", f"[{label}] the app's own note")
    return page

SEED = """
async () => {
  const app = window.nibApp
  const ws = app.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  // Not `users`: a note wearing the shared mark as the icon it chose for itself
  // is a picture nobody could read.
  await ws.noteFrom('---\\nicon: notebook-pen\\n---\\n\\n# With Nina\\n\\nours\\n', root)
  await ws.openEntry(at('Deep work.md'))

  // The open space wears a stroked mark, which is the one Emil measured.
  ws.setIcon(ws.activeSpaceId, 'square-check-big')
  return { root, spaces: ws.spaces.map((one) => one.name), icon: ws.iconFor(ws.activeSpaceId) }
}
"""

MORE_SPACES = """
() => {
  const app = window.nibApp
  const ws = app.workspace
  const here = ws.activeSpace

  const added = [
    { id: 'space-emoji', name: 'Journal', root: '/Journal' },
    { id: 'space-shared', name: 'With Nina', root: '/With Nina' },
  ]
  for (const one of added) {
    if (!ws.spaces.some((space) => space.id === one.id)) ws.spaces.push({ ...one })
  }

  ws.setIcon('space-emoji', '\\u{1F4D3}')
  ws.setIcon('space-shared', 'notebook-pen')

  // `isShared` asks two things: which remote space a folder mirrors, and what
  // the account holds for it. There is no Worker behind this run, so both are
  // stood in for; it is the only way a drive can see a shared row at all.
  //
  // A whole mirror each, not just the id: every row in the file list asks
  // `sync.tracked` whether it is a file shared on its own, and that walks the
  // mirrors and reads each one's root. A mirror without one threw, and an
  // exception in a row takes the whole sidebar with it. See newMirror in
  // sync/mirror.ts for the shape.
  const stand = (spaceId, root) => ({
    spaceId,
    root,
    cursor: 0,
    notes: {},
    files: {},
    shared: true,
  })

  app.sync.mirrors = {
    ...app.sync.mirrors,
    '/With Nina': stand('remote-nina', '/With Nina'),
    [here.root]: stand('remote-here', here.root),
  }
  app.account.spaces = [
    { id: 'remote-nina', name: 'With Nina', role: 'write', shared: true },
    { id: 'remote-here', name: here.name, role: 'owner', shared: true },
  ]

  return {
    here: here.name,
    spaces: ws.spaces.map((one) => one.name),
    roots: ws.spaces.map((one) => one.root),
  }
}
"""

BADGES = """
() => {
  const centre = (box) => box.top + box.height / 2
  const round = (value) => Math.round(value * 100) / 100
  const out = []

  for (const badge of document.querySelectorAll('.spaces .nib-badge')) {
    const box = badge.getBoundingClientRect()

    // Down to what is really drawn. A box that is centred can still hold a glyph
    // that is not: an svg is an inline element, so it sits on the text baseline of
    // whatever wraps it and the line box's descender pushes it off centre. That is
    // the pixel Emil saw, and it is only visible at the innermost element.
    let drawn = badge
    for (;;) {
      const next = drawn.querySelector(':scope > svg, :scope > .glyph, :scope > span')
      if (!next) break
      drawn = next
    }

    const inner = drawn.getBoundingClientRect()
    // Where the ink is, which for a stroked mark is tighter than its box.
    const ink = drawn.tagName.toLowerCase() === 'svg' ? drawn.getBBox?.() : null
    out.push({
      row: badge.closest('.nib-row')?.textContent.trim() ?? '?',
      kind: drawn === badge ? 'letter' : drawn.tagName.toLowerCase(),
      badge: [round(box.width), round(box.height)],
      mark: [round(inner.width), round(inner.height)],
      box_off: round(centre(inner) - centre(box)),
      ink: ink ? [round(ink.y), round(ink.height)] : null,
      line: getComputedStyle(drawn.parentElement ?? drawn).lineHeight,
      display: getComputedStyle(drawn).display,
      vertical: getComputedStyle(drawn).verticalAlign,
    })
  }

  return out
}
"""

BAR = """
() => {
  const header = document.querySelector('header')
  if (!header) return null

  const centre = (box) => box.top + box.height / 2
  const box = header.getBoundingClientRect()
  const parts = []

  const want = [
    ['the menu', 'header > :first-child button, header > button:first-child'],
    ['the sidebar button', 'header .toggle'],
    ['the first tab', 'header .tab, header [role=tab], header .strip button'],
  ]

  for (const [name, selector] of want) {
    const found = header.querySelector(selector)
    if (!found) { parts.push({ name, missing: true }); continue }

    const one = found.getBoundingClientRect()
    parts.push({
      name,
      top: Math.round(one.top * 100) / 100,
      height: Math.round(one.height * 100) / 100,
      off: Math.round((centre(one) - centre(box)) * 100) / 100,
    })
  }

  return {
    height: Math.round(box.height * 100) / 100,
    token: getComputedStyle(document.documentElement).getPropertyValue('--header-height').trim(),
    parts,
  }
}
"""

TOGGLE = """
() => {
  // Wherever it is drawn: the title bar on a desktop, the drawer's own head under
  // a thumb. One component, drawn once; see mobile-header.test.ts.
  const button = document.querySelector('.toggle')
  if (!button) return null

  const seat = button.getBoundingClientRect()
  const shapes = [...button.querySelectorAll('svg *')].map((one) => {
    const style = getComputedStyle(one)
    const box = one.getBoundingClientRect()
    return {
      tag: one.tagName.toLowerCase(),
      d: one.getAttribute('d') ?? one.getAttribute('x') ?? '',
      fill: style.fill,
      opacity: style.opacity,
      transform: style.transform,
      x: Math.round((box.left - seat.left) * 10) / 10,
      y: Math.round((box.top - seat.top) * 10) / 10,
      width: Math.round(box.width * 10) / 10,
    }
  })

  return { pressed: button.getAttribute('aria-pressed'), shapes }
}
"""

HEAD = """
() => {
  const head = document.querySelector('aside .head')
  const name = head?.querySelector('.name')
  if (!head || !name) return null

  const style = getComputedStyle(head)
  const gap = parseFloat(style.gap) || 0

  const row = head.getBoundingClientRect()
  const box = name.getBoundingClientRect()
  const inner = {
    left: row.left + (parseFloat(style.paddingLeft) || 0),
    right: row.right - (parseFloat(style.paddingRight) || 0),
  }

  const others = [...head.children]
    .filter((one) => one !== name)
    .map((one) => {
      const seen = one.getBoundingClientRect()
      return {
        what: one.className || one.tagName.toLowerCase(),
        width: Math.round(seen.width),
        left: seen.left,
        right: seen.right,
      }
    })

  // What stands between the switcher and each end of the row, whichever way the
  // row is laid out: the nearest thing on that side, or the row's own padding.
  const before = others.filter((one) => one.right <= box.left + 1)
  const after = others.filter((one) => one.left >= box.right - 1)
  const leftOf = before.length ? Math.max(...before.map((one) => one.right)) : inner.left
  const rightOf = after.length ? Math.min(...after.map((one) => one.left)) : inner.right

  return {
    row: Math.round(row.width),
    name: Math.round(box.width),
    height: Math.round(box.height),
    others: others.map((one) => ({ what: one.what, width: one.width })),
    gap: Math.round(gap),
    spare: Math.round((box.left - leftOf + (rightOf - box.right)) * 10) / 10,
    grow: getComputedStyle(name).flexGrow,
  }
}
"""

FOOT = """
() => {
  const foot = document.querySelector('aside .foot')
  if (!foot) return null

  const row = foot.getBoundingClientRect()
  const middle = row.top + row.height / 2

  const acts = [...foot.querySelectorAll('.act')].map((one) => {
    const box = one.getBoundingClientRect()
    const mark = one.querySelector('svg')?.getBoundingClientRect() ?? box
    return {
      name: one.getAttribute('aria-label'),
      display: getComputedStyle(one).display,
      width: Math.round(box.width),
      height: Math.round(box.height),
      off: Math.round((box.top + box.height / 2 - middle) * 10) / 10,
      markX: Math.round((mark.left + mark.right - box.left - box.right) / 2 * 10) / 10,
      markY: Math.round((mark.top + mark.bottom - box.top - box.bottom) / 2 * 10) / 10,
    }
  })

  const who = foot.querySelector('.who')?.getBoundingClientRect()
  return {
    height: Math.round(row.height),
    acts,
    who: who ? Math.round((who.top + who.height / 2 - middle) * 10) / 10 : null,
  }
}
"""

FORMAT_BAR = """
() => {
  const docked = document.querySelector('.nib-bar.docked')
  const callout = document.querySelector('.nib-bar-at')
  const one = docked ?? callout
  if (!one) return { none: true }

  const box = one.getBoundingClientRect()
  return {
    none: false,
    docked: !!docked,
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    left: Math.round(box.left),
    right: Math.round(box.right),
    page: window.innerHeight,
    keyboard: window.nibApp.viewport.keyboard,
    typing: window.nibApp.viewport.typing,
  }
}
"""

KEYS = """
(pixels) => {
  const seen = window.nibApp.viewport
  seen.keyboard = pixels
  seen.typing = pixels > 0
  return { keyboard: seen.keyboard, typing: seen.typing }
}
"""

SELECT = """
() => {
  const view = window.nib
  if (!view) return null

  const to = Math.min(12, view.state.doc.length)
  view.dispatch({ selection: { anchor: 2, head: to } })
  view.focus()
  return view.state.sliceDoc(2, to)
}
"""

SHARED = """
() => {
  const seen = []
  const found = document.querySelectorAll('.with, .shared')
  for (const one of found) {
    const style = getComputedStyle(one)
    seen.push({
      where: one.closest('.nib-row, .row, .name')?.textContent.trim() ?? '?',
      tag: one.tagName.toLowerCase(),
      klass: one.className,
      marks: one.querySelectorAll('svg').length,
      radius: style.borderRadius,
      width: style.width,
      background: style.backgroundColor,
      colour: style.color,
      label: one.getAttribute('aria-label'),
    })
  }

  return seen
}
"""

AS_PHONE = """
() => {
  const app = window.nibApp
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

WITH_SOMEBODY = """
() => {
  const app = window.nibApp
  const tab = app.workspace.tabs.find((one) => one.path && one.path.endsWith('.md'))
  if (!tab) return null

  app.rooms.present = { ...app.rooms.present, [tab.note.key]: 1 }
  return tab.path
}
"""

TREE_MARKS = """
() => [...document.querySelectorAll('aside .row')].map((row) => ({
  row: row.textContent.trim(),
  shared: row.querySelectorAll('.shared').length,
}))
"""

SEGMENTED = """
() => {
  const track = document.querySelector('.nib-segmented')
  if (!track) return { none: true }

  // The surface belongs to the thumb wherever one slides, and to the chosen
  // button where none does; see `.nib-segmented.has-thumb button.on`.
  const raised = track.querySelector('.nib-segmented-thumb') ?? track.querySelector('button.on')
  if (!raised) return { none: true }

  const lit = (css) => {
    const [r, g, b] = (css.match(/[\\d.]+/g) ?? [0, 0, 0]).slice(0, 3).map(Number)
    const one = (v) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * one(r) + 0.7152 * one(g) + 0.0722 * one(b)
  }

  const over = getComputedStyle(raised).backgroundColor
  const under = getComputedStyle(track).backgroundColor
  const hi = Math.max(lit(over), lit(under))
  const lo = Math.min(lit(over), lit(under))

  return {
    none: false,
    thumb: over,
    track: under,
    lighter: lit(over) > lit(under),
    ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 1000) / 1000,
    shadow: getComputedStyle(raised).boxShadow !== 'none',
  }
}
"""

FORMAT_MARKS = """
() => {
  const bar = document.querySelector('.nib-bar.docked') ?? document.querySelector('.nib-bar-at')
  if (!bar) return { none: true }

  const ink = document.createElement('canvas').getContext('2d')

  const marks = [...bar.querySelectorAll('button')].map((one) => {
    const box = one.getBoundingClientRect()
    const middle = box.top + box.height / 2
    const name = one.getAttribute('aria-label') ?? '?'

    const glyph = one.querySelector('svg')
    if (glyph) {
      const seen = glyph.getBoundingClientRect()
      return {
        name,
        as: 'glyph',
        off: Math.round((seen.top + seen.height / 2 - middle) * 10) / 10,
        size: Math.round(seen.height * 10) / 10,
      }
    }

    // The `.low` span where there is one, which is the element the transform is on,
    // so its own box is where the letter ended up.
    const held = one.querySelector('span') ?? one
    const text = (held.textContent ?? '').trim()
    if (!text) return { name, as: 'nothing', off: null, size: null }

    const style = getComputedStyle(held)
    ink.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    ink.textBaseline = 'alphabetic'
    const cut = ink.measureText(text)

    let line = held.getBoundingClientRect()
    if (held === one) {
      const range = document.createRange()
      range.selectNodeContents(one)
      line = range.getBoundingClientRect()
    }

    const lead = (line.height - (cut.fontBoundingBoxAscent + cut.fontBoundingBoxDescent)) / 2
    const baseline = line.top + lead + cut.fontBoundingBoxAscent
    const above = (cut.actualBoundingBoxAscent - cut.actualBoundingBoxDescent) / 2

    return {
      name,
      as: 'letter',
      text,
      off: Math.round((baseline - above - middle) * 10) / 10,
      size: Math.round((cut.actualBoundingBoxAscent + cut.actualBoundingBoxDescent) * 10) / 10,
    }
  })

  return { none: false, marks }
}
"""

FORMAT_BOXES = """
() => {
  const bar = document.querySelector('.nib-bar.docked') ?? document.querySelector('.nib-bar-at')
  return bar
    ? [...bar.querySelectorAll('button')].map((one) => {
        const box = one.getBoundingClientRect()
        return { name: one.getAttribute('aria-label') ?? '?', x: box.x, y: box.y, width: box.width, height: box.height }
      })
    : []
}
"""

def drawn_off(page: Page) -> dict[str, float]:
    from PIL import Image

    off: dict[str, float] = {}
    for box in page.evaluate(FORMAT_BOXES):
        if box["width"] < 4 or box["height"] < 4:
            continue
        clip = {key: box[key] for key in ("x", "y", "width", "height")}
        picture = Image.open(io.BytesIO(page.screenshot(clip=clip, scale="css"))).convert("L")
        width, height = picture.size
        pixels = picture.load()
        ground = pixels[1, height // 2]
        rows = [y for y in range(height) if any(abs(pixels[x, y] - ground) > 60 for x in range(2, width - 2))]
        if rows:
            off[box["name"]] = round((rows[0] + rows[-1] + 1) / 2 - height / 2, 1)
    return off

ASIDE_AT = """
() => {
  const aside = document.querySelector('aside')
  if (!aside) return null

  const box = aside.getBoundingClientRect()
  return { left: Math.round(box.left), width: Math.round(box.width) }
}
"""

def same_glyph(label: str, shut: dict | None, opened: dict | None) -> None:
    if not shut or not opened:
        check(False, f"[{label}] there is a sidebar button to measure")
        return

    check(
        [one["tag"] for one in shut["shapes"]] == [one["tag"] for one in opened["shapes"]],
        f"[{label}] the sidebar button is made of the same shapes in both states",
    )
    check(
        shut["pressed"] != opened["pressed"],
        f"[{label}] and says which state it is in ({shut['pressed']} then {opened['pressed']})",
    )

    for one, other in zip(shut["shapes"], opened["shapes"]):
        moved = max(abs(one["x"] - other["x"]), abs(one["y"] - other["y"]))
        check(
            moved <= SLACK and abs(one["width"] - other["width"]) <= SLACK,
            f"[{label}] the {one['tag']} is in the same place in both states"
            f" (moved {moved}px: {one} then {other})",
        )

    for state, seen in (("shut", shut), ("open", opened)):
        faint = [one for one in seen["shapes"] if float(one["opacity"]) < 0.95]
        check(
            not faint,
            f"[{label}] every part of the sidebar button is drawn while it is {state} ({faint})",
        )

def panel_ends(page: Page, label: str) -> None:
    head = page.evaluate(HEAD)
    say(f"[{label}] the head: {head}")
    if not head:
        check(False, f"[{label}] the panel has a head to measure")
    else:
        room = 2 * head["gap"] + SLACK
        check(
            head["spare"] <= room,
            f"[{label}] the space switcher spans the panel ({head['name']}px wide, with"
            f" {head['spare']}px spare beside {head['others']})",
        )
        check(
            head["grow"] != "0",
            f"[{label}] and takes the width rather than being given the word's ({head['grow']})",
        )

    foot = page.evaluate(FOOT)
    say(f"[{label}] the foot: {foot}")
    if not foot:
        check(False, f"[{label}] the panel has a foot to measure")
        return

    kept = [one["name"] for one in foot["acts"] if one["name"] != "Download the app"]
    check(
        len(kept) == 3 and kept[0] == "Send feedback" and kept[2] == "Settings",
        f"[{label}] the foot holds Send feedback, the theme and the settings ({kept})",
    )
    for one in foot["acts"]:
        check(
            abs(one["markX"]) <= SLACK and abs(one["markY"]) <= SLACK,
            f"[{label}] the {one['name']!r} mark is centred in its button"
            f" (off {one['markX']}px across, {one['markY']}px down)",
        )
        check(
            abs(one["off"]) <= SLACK,
            f"[{label}] and {one['name']!r} sits on the row's centre line"
            f" (off by {one['off']}px)",
        )

    sizes = {(one["width"], one["height"]) for one in foot["acts"]}
    check(len(sizes) == 1, f"[{label}] both switches are the same square ({sizes})")

    if foot["who"] is not None:
        check(
            abs(foot["who"]) <= SLACK,
            f"[{label}] and the account row is on that line too (off by {foot['who']}px)",
        )

def on_phone(browser: Browser, scheme: str = "light") -> None:
    label = f"phone {scheme}"
    width = 420
    page = fresh(browser, label, {"width": width, "height": 880}, scheme)
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        say(f"[{label}] {page.evaluate(SEED)}")
        say(f"[{label}] {page.evaluate(MORE_SPACES)}")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

        page.locator("header").first.screenshot(path=str(SHOTS / f"bar-phone-{scheme}.png"))
        say(f"[{label}] wrote bar-phone-{scheme}.png")

        page.screenshot(path=str(SHOTS / f"screen-phone-{scheme}.png"))
        say(f"[{label}] wrote screen-phone-{scheme}.png")
        say(f"[{label}] the drawer sits at {page.evaluate(ASIDE_AT)}")

        opened_button = page.evaluate(TOGGLE)
        say(f"[{label}] the drawer's own button, open: {opened_button}")
        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(600)
        shut_button = page.evaluate(TOGGLE)
        say(f"[{label}] the drawer's own button, shut: {shut_button}")
        same_glyph(label, shut_button, opened_button)

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

        panel_ends(page, label)
        page.locator("aside .head").first.screenshot(path=str(SHOTS / f"head-phone-{scheme}.png"))
        page.locator("aside .foot").first.screenshot(path=str(SHOTS / f"foot-phone-{scheme}.png"))
        say(f"[{label}] wrote head-phone-{scheme}.png and foot-phone-{scheme}.png")

        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(400)
        say(f"[{label}] holding {page.evaluate(SELECT)!r}")

        say(f"[{label}] the keys come up: {page.evaluate(KEYS, 320)}")
        page.wait_for_timeout(400)
        up = page.evaluate(FORMAT_BAR)
        say(f"[{label}] the bar with the keys up: {up}")
        page.screenshot(path=str(SHOTS / f"format-bar-up-{scheme}.png"))
        check(not up["none"] and up["docked"], f"[{label}] the bar over the keys is the strip")
        if not up["none"]:
            check(
                abs(up["bottom"] - (up["page"] - 320)) <= SLACK,
                f"[{label}] and it sits on them ({up['bottom']}px of {up['page']}px)",
            )
            found = page.evaluate(FORMAT_MARKS)
            inked = drawn_off(page)
            for one in found.get("marks", []):
                if one["as"] == "letter" and one["name"] in inked:
                    one["metrics"], one["off"] = one["off"], inked[one["name"]]
                say(f"[{label}]   {one}")

            letters = [one for one in found.get("marks", []) if one["as"] == "letter"]
            glyphs = [one for one in found.get("marks", []) if one["as"] == "glyph"]
            check(len(letters) >= 5, f"[{label}] the bar's marks were read ({len(letters)})")
            check(
                any(one["name"] == "Link" for one in glyphs),
                f"[{label}] Link is a glyph rather than a character that means a tag",
            )

            if letters:
                level = sorted(one["off"] for one in letters)[len(letters) // 2]
                for one in letters + glyphs:
                    check(
                        abs(one["off"] - level) <= 1.5,
                        f"[{label}] {one['name']} reads on the row's own line"
                        f" (ink {one['off']}px against {level}px)",
                    )

            check(
                up["left"] <= SLACK and abs(up["right"] - width) <= SLACK,
                f"[{label}] and spans the screen ({up['left']} to {up['right']} of {width})",
            )

        page.evaluate(KEYS, 180)
        page.wait_for_timeout(300)
        lower = page.evaluate(FORMAT_BAR)
        say(f"[{label}] and with a shallower keyboard: {lower}")
        check(
            not lower["none"] and abs(lower["bottom"] - (lower["page"] - 180)) <= SLACK,
            f"[{label}] the bar follows the keys rather than staying where it was put",
        )

        say(f"[{label}] the keys go down: {page.evaluate(KEYS, 0)}")
        page.wait_for_timeout(400)
        down = page.evaluate(FORMAT_BAR)
        say(f"[{label}] the bar with the keys down: {down}")
        page.screenshot(path=str(SHOTS / f"format-bar-down-{scheme}.png"))
        check(
            down["none"],
            f"[{label}] nothing of the bar is left once the keyboard goes ({down})",
        )

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(500)

        page.evaluate("() => document.querySelector('aside .name')?.click()")
        page.wait_for_timeout(600)
        page.locator(".spaces").first.screenshot(path=str(SHOTS / f"switcher-phone-{scheme}.png"))
        say(f"[{label}] wrote switcher-phone-{scheme}.png")

        for one in page.evaluate(BADGES):
            say(f"[{label}]   {one}")
            check(
                abs(one["box_off"]) <= SLACK,
                f"[{label}] the mark on {one['row']!r} is centred in its badge"
                f" (off by {one['box_off']}px)",
            )

        shared = page.evaluate(SHARED)
        say(f"[{label}] what says shared: {[one['klass'] for one in shared]}")
        for one in shared:
            check(
                one["marks"] >= 1 and one["radius"] != "50%",
                f"[{label}] {one['where']!r} says shared with a mark rather than a dot",
            )
    finally:
        page.context.close()

def drive(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> None:
    page = fresh(browser, label, viewport, scheme)
    try:
        say(f"[{label}] {page.evaluate(SEED)}")
        say(f"[{label}] {page.evaluate(MORE_SPACES)}")
        page.wait_for_timeout(400)

        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(400)

        bar = page.evaluate(BAR)
        say(f"[{label}] the bar is {bar['height']}px, token {bar['token']}")
        for part in bar["parts"]:
            say(f"[{label}]   {part}")

        header = page.locator("header").first
        header.screenshot(path=str(SHOTS / f"bar-{label}.png"))
        say(f"[{label}] wrote bar-{label}.png")

        placed = [one for one in bar["parts"] if not one.get("missing")]
        check(
            len(placed) >= 3,
            f"[{label}] the bar holds the menu, the button and a tab",
        )
        for one in placed:
            check(
                abs(one["off"]) <= SLACK,
                f"[{label}] {one['name']} is on the bar's centre line (off by {one['off']}px)",
            )

        shut = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button shut: {shut}")
        page.locator(".toggle").first.screenshot(path=str(SHOTS / f"toggle-shut-{label}.png"))

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(500)
        opened = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button open: {opened}")
        page.locator(".toggle").first.screenshot(path=str(SHOTS / f"toggle-open-{label}.png"))
        say(f"[{label}] wrote toggle-shut-{label}.png and toggle-open-{label}.png")

        same_glyph(label, shut, opened)

        panel_ends(page, label)
        page.locator("aside .head").first.screenshot(path=str(SHOTS / f"head-{label}.png"))
        page.locator("aside .foot").first.screenshot(path=str(SHOTS / f"foot-{label}.png"))
        say(f"[{label}] wrote head-{label}.png and foot-{label}.png")

        page.locator("aside .name").first.click()
        page.wait_for_timeout(500)
        page.locator(".spaces").first.screenshot(path=str(SHOTS / f"switcher-{label}.png"))
        say(f"[{label}] wrote switcher-{label}.png")

        for one in page.evaluate(BADGES):
            say(f"[{label}]   {one}")
            check(
                abs(one["box_off"]) <= SLACK,
                f"[{label}] the mark on {one['row']!r} is centred in its badge"
                f" (off by {one['box_off']}px)",
            )

        shared = page.evaluate(SHARED)
        say(f"[{label}] what says shared: {shared}")
        check(len(shared) >= 2, f"[{label}] the shared spaces say so at all")
        page.evaluate("() => document.querySelector('.catch')?.click()")
        page.wait_for_timeout(400)

        say(f"[{label}] somebody else joined {page.evaluate(WITH_SOMEBODY)}")
        page.wait_for_timeout(400)
        rows = page.evaluate(TREE_MARKS)
        for one in rows:
            say(f"[{label}]   {one}")

        marked = [one["row"] for one in rows if one["shared"]]
        check(
            len(marked) == 1,
            f"[{label}] one note wears the mark and no other row does ({marked})",
        )
        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"tree-{label}.png"))
        say(f"[{label}] wrote tree-{label}.png")
        for one in shared:
            check(
                one["marks"] >= 1 and one["radius"] != "50%",
                f"[{label}] {one['where']!r} says shared with a mark rather than a dot"
                f" ({one['klass']}, radius {one['radius']})",
            )
            check(
                bool(one["label"]),
                f"[{label}] and says it in a word too ({one['label']!r})",
            )

        page.evaluate("() => window.nibApp.settings.show()")
        page.wait_for_timeout(600)
        page.evaluate(
            "() => { window.nibApp.settings.section = 'appearance';"
            " window.nibApp.settings.listing = false }"
        )
        page.wait_for_timeout(700)
        segment = page.evaluate(SEGMENTED)
        say(f"[{label}] the segmented control: {segment}")
        check(not segment["none"], f"[{label}] the appearance pane draws a segmented control")
        if not segment["none"]:
            page.locator(".nib-segmented").first.screenshot(
                path=str(SHOTS / f"segmented-{label}.png")
            )
            say(f"[{label}] wrote segmented-{label}.png")
            check(
                segment["lighter"],
                f"[{label}] the chosen half is lighter than the groove it sits in"
                f" ({segment['thumb']} over {segment['track']})",
            )
            check(
                segment["ratio"] >= 1.05,
                f"[{label}] and lifted far enough out of it to see ({segment['ratio']})",
            )
            check(segment["shadow"], f"[{label}] and casts the shadow that says so")
        page.evaluate(
            "() => window.nibApp.settings.hide?.() ?? (window.nibApp.settings.open = false)"
        )
        page.wait_for_timeout(300)
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser, "light", {"width": 1180, "height": 760}, "light")
        drive(browser, "dark", {"width": 1180, "height": 760}, "dark")
        on_phone(browser, "light")
        on_phone(browser, "dark")

    return DRIVE.verdict("the bar is one row and every mark is centred")

if __name__ == "__main__":
    sys.exit(main())
