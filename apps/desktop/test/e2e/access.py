from __future__ import annotations

import json
import os

from playwright.sync_api import Browser

import harness
from harness import Drive
from settling import HIDE_CARET, steady

LABEL = os.environ.get("NIB_LABEL", "after")

DRIVE = Drive(__file__, shots=f"access/{LABEL}")
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

AXE = APP / "node_modules" / "axe-core" / "axe.min.js"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

WINDOWS = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone-light", 390, 844, PHONE_AGENT, True, "light"),
    ("phone-dark", 390, 844, PHONE_AGENT, True, "dark"),
]

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)
  const folder = join(root, 'Field notes')

  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\n## What went in this week\\n\\n- Pressure on the pen\\n\\n### Wind\\n\\nThe wind was steady all week, and a [[Reading list]] came of it.\\n', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor that formats what you write as you write it.\\n', undefined)
  await ws.noteFrom('# Reading list\\n\\nA paper about ink, and one about wind.\\n', undefined)
  await ws.noteFrom('# Ledger\\n\\nWhat the wind cost.\\n', folder)
  await ws.noteFrom('# Sketches\\n\\nInk on paper.\\n', folder)

  ws.device.expand(folder)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) {
    ws.bookmarks.toggle({ kind: 'note', path: first.name })
    await ws.openEntry(first.path, { activate: true })
  }
  const second = ws.notes.find((one) => one.name.startsWith('Read me'))
  if (second) await ws.openEntry(second.path, { activate: true })

  return ws.files.map((one) => one.name)
}
"""

FOCUSABLE = (
    "button, a[href], input, select, textarea, summary,"
    " [tabindex]:not([tabindex='-1']), [contenteditable='true']"
)

AXE_RUN = """
async () => {
  const found = await window.axe.run(document, {
    resultTypes: ['violations'],
    // The plane keeps its own keyboard, which is what `role="application"` is
    // for, and the rule that objects to one cannot tell that from a mistake.
    rules: { 'landmark-one-main': { enabled: true } },
  })

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  const named = []
  const quieter = []

  for (const one of found.violations) {
    const impact = one.impact ?? 'minor'
    counts[impact] = (counts[impact] ?? 0) + one.nodes.length
    const said = {
      id: one.id,
      impact,
      nodes: one.nodes.length,
      where: one.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }
    // The serious and the critical are what a run is judged on; the rest are
    // written down so a number that grows can be accounted for.
    if (impact === 'critical' || impact === 'serious') named.push(said)
    else quieter.push({ id: one.id, impact, nodes: one.nodes.length })
  }

  return { counts, named, quieter }
}
"""

RINGS = f"""
() => {{
  const within = (node) => node.getClientRects().length > 0 && !node.closest('[inert]')
  const found = [...document.querySelectorAll("{FOCUSABLE}")].filter(within)
  const was = document.activeElement

  const reads = (node) => {{
    const style = getComputedStyle(node)
    const width = parseFloat(style.outlineWidth) || 0
    return {{
      ring: style.outlineStyle !== 'none' && width > 0
        ? `${{style.outlineWidth}} ${{style.outlineStyle}} ${{style.outlineColor}}`
        : null,
      shadow: style.boxShadow,
      border: `${{style.borderColor}} ${{style.borderWidth}}`,
      background: style.backgroundColor,
    }}
  }}

  // At rest, all of them, before anything is focused: a style read after the focus
  // has moved on is the style of something else.
  const resting = new Map(found.map((node) => [node, reads(node)]))
  const out = []

  for (const node of found) {{
    try {{ node.focus({{ preventScroll: true }}) }} catch {{ continue }}
    if (document.activeElement !== node) continue

    const before = resting.get(node)
    const now = reads(node)
    // A box with a caret in it says so with the caret as well, which is the one
    // answer no stylesheet draws and no measurement can see.
    const caret =
      node.isContentEditable ||
      node.tagName === 'TEXTAREA' ||
      (node.tagName === 'INPUT' &&
        !['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit'].includes(node.type))

    out.push({{
      tag: node.tagName.toLowerCase(),
      cls: (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.'),
      said: node.getAttribute('aria-label') ?? (node.textContent ?? '').trim().slice(0, 24),
      keyed: node.matches(':focus-visible'),
      ring: now.ring,
      turned: before.border !== now.border,
      haloed: before.shadow !== now.shadow,
      lit: before.background !== now.background,
      caret,
    }})
  }}

  if (was instanceof HTMLElement) {{ try {{ was.focus({{ preventScroll: true }}) }} catch {{}} }}
  return out
}}
"""

UNNAMED = f"""
() => {{
  const within = (node) => node.getClientRects().length > 0 && !node.closest('[inert]')
  const wordless = (node) => (node.textContent ?? '').trim().length === 0

  return [...document.querySelectorAll("{FOCUSABLE}")]
    .filter(within)
    .filter(wordless)
    .filter((node) => {{
      if (node.getAttribute('aria-label')?.trim()) return false
      if (node.getAttribute('aria-labelledby')) return false
      if (node.getAttribute('title')?.trim()) return false
      // A field says what it is with its placeholder where it has no label, which
      // axe counts and so does this.
      if (node.getAttribute('placeholder')?.trim()) return false
      return true
    }})
    .map((node) => {{
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2)
      return `${{node.tagName.toLowerCase()}}.${{cls.join('.')}}`
    }})
}}
"""

HEADINGS = """
() => [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
  .filter((one) => one.getClientRects().length > 0 || one.classList.contains('nib-said'))
  .map((one) => `${one.tagName.toLowerCase()} ${(one.textContent ?? '').trim().slice(0, 28)}`)
"""

LANDMARKS = """
() => [...document.querySelectorAll('main, header, footer, nav, aside, article, [role]')]
  .filter((one) => ['main', 'header', 'footer', 'nav', 'aside', 'article'].includes(one.tagName.toLowerCase()))
  .map((one) => {
    const name = one.getAttribute('aria-label') ?? one.getAttribute('aria-labelledby') ?? ''
    return `${one.tagName.toLowerCase()}${name ? ` "${name.slice(0, 24)}"` : ' (unnamed)'}`
  })
"""

WHERE = """
() => {
  const at = document.activeElement
  if (!at) return 'nothing'

  const region = at.closest('[data-region]')?.dataset.region ?? '-'
  const named =
    at.getAttribute('aria-label') ?? (at.textContent ?? '').trim().slice(0, 28)
  const cls = (at.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')

  return `${region} | ${at.tagName.toLowerCase()}.${cls} | ${JSON.stringify(named)}`
}
"""

CLIPPED = """
() => {
  const root = document.documentElement
  const sideways = root.scrollWidth - root.clientWidth
  const over = []

  for (const node of document.querySelectorAll('button, a[href], input, [role=tab]')) {
    const box = node.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    // A sidebar put away waits beyond the window's edge, hidden and inert (#1038):
    // nothing in it can be seen or reached, so nothing in it is off the side.
    if (node.closest('[inert]') || getComputedStyle(node).visibility === 'hidden') continue
    if (box.right > root.clientWidth + 1 || box.left < -1) {
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean)[0] ?? ''
      over.push(`${node.tagName.toLowerCase()}.${cls}`)
    }
  }

  return { sideways, over: [...new Set(over)].slice(0, 8) }
}
"""

TARGETS = """
() => {
  const floor = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--touch-target'),
  )
  const small = []

  for (const node of document.querySelectorAll('button, a[href], [role=tab], input')) {
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    // The row in a list is the target, not the mark inside it.
    if (node.closest('[aria-hidden=true]')) continue
    if (box.height < floor - 0.5 || box.width < floor - 0.5) {
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')
      small.push(`${node.tagName.toLowerCase()}.${cls} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
  }

  return { floor, small: [...new Set(small)] }
}
"""

STILL = """
() => {
  const style = getComputedStyle(document.documentElement)
  const tokens = ['--dur-instant', '--dur-fast', '--dur-slow']
  const said = Object.fromEntries(tokens.map((one) => [one, style.getPropertyValue(one).trim()]))
  return { said, asked: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
}
"""

TOLERATED = ("orden.so", "nibeditor.com", "Failed to load resource", "net::ERR", "favicon")

KNOWN = {
    "scrollable-region-focusable": "the note is reached by being written in",
    "color-contrast": "the ink on an accent fill is a palette decision",
}

axe_table: dict[str, dict] = {}

class Window:

    def __init__(self, browser: Browser, name: str, width: int, height: int,
                 agent: str, finger: bool, scheme: str, **extra: object) -> None:
        self.name = name
        self.finger = finger
        self.width = width
        self.height = height
        self.context = browser.new_context(
            viewport={"width": width, "height": height},
            user_agent=agent,
            has_touch=finger,
            is_mobile=finger,
            color_scheme=scheme,
            **{"reduced_motion": "reduce", **extra},  # type: ignore[arg-type]
        )
        self.page = self.context.new_page()
        self.page.set_default_timeout(9000)
        self.page.add_init_script(HIDE_CARET)
        self.listen()
        self.page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
        self.page.wait_for_function("() => !!window.nibApp", timeout=25000)
        self.page.wait_for_function(
            "() => !!window.nibApp.workspace.activeSpace", timeout=25000
        )
        self.page.evaluate(
            "() => { for (let i = 0; i < 24; i++) history.pushState({ spare: i }, '') }"
        )
        self.page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
        self.page.wait_for_timeout(200)
        say(f"[{name}] the space holds {len(self.page.evaluate(SEED))} files")
        self.page.wait_for_timeout(700)
        DRIVE.inject(self.page, AXE)
        self.page.wait_for_function("() => !!window.axe", timeout=20000)

    def listen(self) -> None:
        self.page.on("pageerror", lambda error: wrong(f"[{self.name}] page error: {error}"))
        self.page.on(
            "console",
            lambda message: wrong(f"[{self.name}] console error: {message.text}")
            if message.type == "error" and not any(one in message.text for one in TOLERATED)
            else None,
        )

    def close(self) -> None:
        self.context.close()

    def shot(self, tag: str) -> None:
        SHOTS.mkdir(parents=True, exist_ok=True)
        picture = steady(self.page, self.page.screenshot, say, f"[{self.name}] {tag}")
        (SHOTS / f"{self.name}-{tag}.png").write_bytes(picture)

    def axe(self, surface: str) -> dict:
        found = self.page.evaluate(AXE_RUN)
        counts = found["counts"]
        key = f"{self.name}/{surface}"
        axe_table[key] = found

        line = " ".join(f"{kind[0]}{counts[kind]}" for kind in
                        ("critical", "serious", "moderate", "minor"))
        say(f"[{self.name}] {surface:<18} axe {line}")

        left = 0
        for one in found["named"]:
            excused = KNOWN.get(one["id"])
            mark = f" - {excused}" if excused else ""
            say(f"      {one['impact']:<8} {one['id']} x{one['nodes']} {one['where']}{mark}")
            if not excused:
                left += one["nodes"]

        if left:
            wrong(f"[{self.name}] {surface}: {left} serious or critical")

        return found

    def rings(self, surface: str) -> None:
        self.page.keyboard.press("Tab")
        self.page.wait_for_timeout(60)
        found = self.page.evaluate(RINGS)

        def answers(one: dict) -> bool:
            if one["ring"] or one["turned"] or one["haloed"] or one["lit"]:
                return True
            return bool(one["caret"])

        blind = [
            f"{one['tag']}.{one['cls']} {one['said']!r}"
            for one in found
            if one["keyed"] and not answers(one)
        ]
        if blind:
            wrong(f"[{self.name}] {surface}: nothing says the keyboard is here: {blind[:6]}")

        rings = sorted({one["ring"] for one in found if one["ring"]})
        if len(rings) > 1:
            wrong(f"[{self.name}] {surface}: more than one ring: {rings}")

        kinds = {
            "ring": sum(1 for one in found if one["ring"]),
            "border": sum(1 for one in found if one["turned"] and not one["ring"]),
            "caret only": sum(
                1
                for one in found
                if one["caret"]
                and not (one["ring"] or one["turned"] or one["haloed"] or one["lit"])
            ),
        }
        say(f"[{self.name}] {surface:<18} {len(found)} stops, {kinds}, ring {rings or ['-']}")

    def unnamed(self, surface: str) -> None:
        found = self.page.evaluate(UNNAMED)
        if found:
            wrong(f"[{self.name}] {surface}: controls with no name: {found[:8]}")

    def look(self, surface: str) -> None:
        self.axe(surface)
        self.unnamed(surface)
        self.rings(surface)
        self.shot(surface)

def press(window: Window, key: str, wait: int = 300) -> str:
    window.page.keyboard.press(key)
    window.page.wait_for_timeout(wait)
    return window.page.evaluate(WHERE)

def region(window: Window) -> str:
    return window.page.evaluate(
        "() => document.activeElement?.closest('[data-region]')?.dataset.region ?? '-'"
    )

def open_panel(window: Window) -> None:
    if not window.page.evaluate("() => !!window.nibApp.workspace.panel"):
        window.page.keyboard.press("Control+Shift+L")
        window.page.wait_for_timeout(450)

def into_tree(window: Window) -> bool:
    page = window.page
    if region(window) != "list":
        page.keyboard.press("Control+Shift+E")
        page.wait_for_timeout(550)

    for _ in range(4):
        if page.evaluate("() => !!document.activeElement?.matches('.row[data-path]')"):
            return True
        page.keyboard.press("Tab")
        page.wait_for_timeout(220)

    return page.evaluate("() => !!document.activeElement?.matches('.row[data-path]')")

def opens(window: Window, how: str, wait: int = 600) -> bool:
    try:
        window.page.evaluate(how)
    except Exception as error:  # noqa: BLE001 - a surface this build has not got
        say(f"[{window.name}] skipped: {str(error).splitlines()[0][:90]}")
        return False

    window.page.wait_for_timeout(wait)
    return True

STILL_UP = """
() => {
  const up = [...document.querySelectorAll(
    '[role=dialog], [role=menu], .nib-screen, .sheet, .palette',
  )].filter((node) => node.getClientRects().length > 0)

  return up.map((node) => (node.className ?? '').toString().split(' ')[0] || node.tagName)
}
"""

def shut(window: Window, times: int = 5) -> None:
    for _ in range(times):
        if not window.page.evaluate(STILL_UP):
            return
        window.page.keyboard.press("Escape")
        window.page.wait_for_timeout(320)

    left = window.page.evaluate(STILL_UP)
    if left:
        wrong(f"[{window.name}] {times} presses of Escape left these up: {left}")

def layer(window: Window, surface: str, how: str, wait: int = 600) -> None:
    if not opens(window, how, wait):
        return

    try:
        window.page.wait_for_selector(
            "[role=dialog], [role=menu], .nib-screen, .sheet, .palette",
            state="visible",
            timeout=15000,
        )
    except Exception:  # noqa: BLE001 - said below rather than walked out on
        say(f"[{window.name}] {surface}: nothing came up to look at")
        return

    window.look(surface)
    shut(window)

def drive(browser: Browser, name: str, width: int, height: int,
          agent: str, finger: bool, scheme: str) -> None:
    window = Window(browser, name, width, height, agent, finger, scheme)
    page = window.page

    try:
        say(f"[{name}] --- the shell ---")
        say(f"[{name}] landmarks: {page.evaluate(LANDMARKS)}")
        say(f"[{name}] headings:  {page.evaluate(HEADINGS)}")
        window.look("launch")

        for chord, panel in [
            ("Control+Shift+E", "files"),
            ("Control+Shift+O", "outline"),
            ("Control+Shift+F", "search"),
            ("Control+Shift+B", "links"),
        ]:
            page.keyboard.press(chord)
            page.wait_for_timeout(600)
            showing = page.evaluate(
                "(one) => window.nibApp.workspace.openOn(window.nibApp.workspace.sideOf(one))",
                "tree" if panel == "files" else panel,
            )
            if showing is None:
                say(f"[{name}] {panel}: the chord opened nothing")
                continue
            window.look(f"panel-{panel}")

        say(f"[{name}] --- the layers ---")
        open_panel(window)

        page.keyboard.press("Control+O")
        page.wait_for_timeout(600)
        window.look("palette")
        page.keyboard.type(">", delay=40)
        page.wait_for_timeout(500)
        window.look("palette-commands")
        shut(window)

        if not into_tree(window):
            say(f"[{name}] row-menu: the keyboard never reached a row of the tree")
        page.keyboard.press("Shift+F10")
        page.wait_for_timeout(600)
        if page.evaluate("() => !!document.querySelector('[role=menu]')"):
            window.look("row-menu")
        else:
            say(f"[{name}] row-menu: Shift+F10 opened nothing")
        shut(window)

        page.keyboard.press("Control+Shift+Space")
        page.wait_for_timeout(650)
        if page.evaluate("() => !!document.querySelector('[role=menu]')"):
            window.look("spaces")
        shut(window)

        layer(window, "settings", "() => window.nibApp.settings.show()")
        layer(window, "shortcuts", "() => window.nibApp.settings.show('shortcuts')")
        layer(window, "appearance", "() => window.nibApp.settings.show('appearance')")
        layer(
            window,
            "themes",
            "() => { window.nibApp.settings.show('appearance'); window.nibApp.themeStore.open = true }",
            900,
        )
        layer(
            window,
            "icons",
            """() => {
              const ws = window.nibApp.workspace
              const note = ws.notes.find((one) => one.name.startsWith('Kestrel'))
              window.nibApp.iconChoice.file(note?.path ?? ws.notes[0].path)
            }""",
        )
        layer(window, "import", "() => (window.nibApp.importing.open = true)")
        layer(
            window,
            "share",
            """async () => {
              const ws = window.nibApp.workspace
              await window.nibApp.share.show(ws.activeSpaceId, null)
            }""",
            900,
        )

        say(f"[{name}] --- what is read ---")
        if opens(window, "() => window.nibApp.workspace.toggleReading()", 900):
            window.look("reading")
            say(f"[{name}] reading headings: {page.evaluate(HEADINGS)}")
            say(f"[{name}] reading landmarks: {page.evaluate(LANDMARKS)}")
            opens(window, "() => window.nibApp.workspace.toggleReading()", 600)

        if opens(window, "() => void window.nibApp.workspace.createCanvas()", 1400):
            page.keyboard.press("Escape")
            try:
                page.wait_for_selector("[role=application]", state="visible", timeout=20000)
            except Exception:  # noqa: BLE001 - said below rather than walked out on
                pass
            page.wait_for_timeout(1200)
            if page.evaluate("() => !!document.querySelector('[role=application]')"):
                window.look("canvas")
                said = page.evaluate(
                    "() => document.querySelector('[role=application]')"
                    "?.getAttribute('aria-label')"
                )
                say(f"[{name}] the plane says: {said!r}")
            else:
                say(f"[{name}] canvas: the plane never came up")

        window.close()
    except Exception:
        window.close()
        raise

def walk(browser: Browser) -> None:
    window = Window(browser, "walk", 1440, 900, DESKTOP_AGENT, False, "dark")
    page = window.page

    try:
        open_panel(window)
        page.evaluate(
            "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"
        )
        page.wait_for_timeout(250)

        say("--- F6 round the regions and back ---")
        forwards = []
        for _ in range(9):
            press(window, "F6")
            forwards.append(region(window))
        say(f"    forwards: {' -> '.join(forwards)}")
        if len(set(forwards)) < 4:
            wrong(f"F6 walked {len(set(forwards))} regions: {forwards}")
        if forwards[0] not in forwards[1:]:
            wrong("F6 never came back round to where it started")

        backwards = []
        for _ in range(4):
            press(window, "Shift+F6")
            backwards.append(region(window))
        say(f"    backwards: {' -> '.join(backwards)}")
        if backwards == forwards[:4]:
            wrong("Shift+F6 walks the same way round as F6")

        say("--- Tab stops once per list, not once per row ---")
        page.keyboard.press("Control+Shift+E")
        page.wait_for_timeout(600)
        stops = page.evaluate(
            "() => document.querySelectorAll('[data-region=\"list\"] [tabindex=\"0\"]').length"
        )
        say(f"    the panel holds {stops} tab stops")
        if stops > 4:
            wrong(f"the open panel puts {stops} things in the tab sequence")

        say("--- the arrows, the ends and a spelled name ---")
        if not into_tree(window):
            wrong("the keyboard never reached a row of the file list")

        landed = []
        for key in ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]:
            landed.append(f"{key}={press(window, key).split(' | ')[-1]}")
        say(f"    {'  '.join(landed)}")
        if len({one.split('=')[1] for one in landed}) < 3:
            wrong(f"the arrows moved nowhere in the list: {landed}")

        page.keyboard.type("re", delay=70)
        page.wait_for_timeout(400)
        spelled = page.evaluate(WHERE)
        say(f"    typed 're' -> {spelled}")
        if "re" not in spelled.lower():
            wrong(f"spelling a name landed on {spelled}")

        say("--- every layer hands the keyboard back to what opened it ---")
        for chord, what in [
            ("Control+O", "the palette"),
            ("Control+Shift+Slash", "the shortcuts pane"),
            ("Control+Comma", "the settings"),
            ("Control+Space", "the space switcher"),
            ("Control+Shift+Space", "the space switcher, by its second key"),
        ]:
            into_tree(window)
            from_here = page.evaluate(WHERE)

            page.keyboard.press(chord)
            page.wait_for_timeout(700)
            inside = page.evaluate(WHERE)
            depth = page.evaluate("() => window.nibApp.overlays?.depth ?? -1")

            page.keyboard.press("Tab")
            page.wait_for_timeout(250)
            held = page.evaluate(
                "() => !!document.activeElement?.closest("
                "'[role=dialog], .sheet, .panel, .palette, [role=menu]')"
            )
            if not held:
                wrong(f"{what}: Tab walked out of it")

            page.keyboard.press("Escape")
            page.wait_for_timeout(800)
            back = page.evaluate(WHERE)
            say(f"    {chord:<20} {what}: depth {depth}, {inside.split(' | ')[1]}")
            say(f"        Escape -> {back.split(' | ')[1]} (opened from {from_here.split(' | ')[1]})")

            if page.evaluate("() => document.activeElement === document.body"):
                wrong(f"{what}: Escape left the keyboard on nothing")

        window.close()
    except Exception:
        window.close()
        raise

def extras(browser: Browser) -> None:
    walk(browser)

    say("--- 200% zoom, which is half the room ---")
    window = Window(browser, "zoom", 720, 450, DESKTOP_AGENT, False, "light")
    try:
        open_panel(window)
        window.page.wait_for_timeout(500)
        found = window.page.evaluate(CLIPPED)
        say(f"    sideways {found['sideways']}px, off the side: {found['over']}")
        window.shot("zoom-200")
        if found["sideways"] > 1:
            wrong(f"at 200% the window scrolls {found['sideways']}px sideways")
        if found["over"]:
            wrong(f"at 200% these are off the side of it: {found['over']}")
        window.axe("zoom-200")
    finally:
        window.close()

    say("--- a system asking for more contrast ---")
    window = Window(
        browser, "contrast", 1440, 900, DESKTOP_AGENT, False, "dark", contrast="more"
    )
    try:
        open_panel(window)
        window.page.wait_for_timeout(500)
        window.look("contrast-more")
    finally:
        window.close()

    say("--- a system asking for less movement ---")
    window = Window(
        browser, "still", 1440, 900, DESKTOP_AGENT, False, "light", reduced_motion="reduce"
    )
    try:
        found = window.page.evaluate(STILL)
        say(f"    asked {found['asked']}, tokens {found['said']}")
        if not found["asked"]:
            wrong("the window was not asked for less movement")
        moving = [one for one, value in found["said"].items() if value not in ("0ms", "0s", "0")]
        if moving:
            wrong(f"these durations still move under reduced motion: {moving}")
        window.shot("reduced-motion")
    finally:
        window.close()

    say("--- every target a thumb has to hit ---")
    window = Window(browser, "thumb", 390, 844, PHONE_AGENT, True, "light")
    try:
        open_panel(window)
        window.page.wait_for_timeout(600)
        found = window.page.evaluate(TARGETS)
        say(f"    the floor is {found['floor']}px; under it: {found['small'] or 'nothing'}")
        window.shot("touch-targets")

        left = [one for one in found["small"] if "nib-fold-hinge" not in one]
        if left:
            wrong(f"under the touch floor: {left[:8]}")
    finally:
        window.close()

def main() -> int:
    if not AXE.exists():
        raise SystemExit(f"axe-core is not here: {AXE}. Run pnpm install.")

    with DRIVE.session() as browser:
        for one in WINDOWS:
            say(f"=== {one[0]} ===")
            try:
                drive(browser, *one)
            except Exception as error:  # noqa: BLE001
                wrong(f"[{one[0]}] the walk stopped: {str(error).splitlines()[0][:120]}")

        say("=== the window itself ===")
        try:
            extras(browser)
        except Exception as error:  # noqa: BLE001
            wrong(f"[extras] stopped: {str(error).splitlines()[0][:120]}")

    (SHOTS / "axe.json").write_text(json.dumps(axe_table, indent=2), encoding="utf-8")
    say(f"axe counts in {SHOTS / 'axe.json'}")

    return DRIVE.verdict("every surface answers a keyboard, and axe finds nothing serious")

if __name__ == "__main__":
    raise SystemExit(main())
