"""The row across the top of the app, and the badges in the space switcher.

Five things, all of them a pixel or a glyph rather than a behaviour, so the run
measures rather than clicks:

  - the title bar's label for the open space wears the space's own mark;
  - every mark in a badge is centred in it, optically, emoji and stroke alike;
  - a shared space and a shared note wear a shared mark, not a dot;
  - the sidebar button is one glyph whichever state it is in;
  - the bar is one row: the menu, the button, the space label and the first tab
    all sit on one centre line, inside `--header-height`.

Builds the web app, serves `dist` on a port of its own, measures and shoots on a
desktop in both schemes and on a phone, and stops everything again. Screenshots
go beside this file under `shots/shell-polish/`.

Run it from the repository root:

    python apps/desktop/test/e2e/shell-polish.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "shell-polish"

# A port of this run's own, above the dev server's 1420 and clear of the others.
PORT = 18896
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40

# How far off centre a mark may sit before it is a mark that looks wrong. Half a
# pixel is what rounding costs; anything past one is visible.
SLACK = 1.0

failures: list[str] = []

# A badge may hold an emoji, and this console is code page 1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build that is there")
        return

    say("building the web app")
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    # A first visit in a browser is given a welcome note, and the app opens it
    # after the space is there rather than with it; see `restore` in
    # workspace.svelte.ts. A panel opened before that has happened is shut again
    # underneath whatever was about to be photographed.
    wait_for(page, "() => !!window.nibApp.workspace.active", f"[{label}] the app's own note")
    return page


# Three spaces, so the switcher has rows to compare: the one that is open wearing
# a stroked mark, one wearing an emoji, and one shared with somebody.
#
# Sharing is an account fact, and this build has no account, so the two things the
# app reads are stood in for: `sync.remoteIdFor` and `account.spaces`. That is the
# only way a drive with no Worker behind it can see a shared row at all.
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

# A second and a third space in the list, and one of them shared.
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

# Where each of the marks in the switcher sits inside its badge, and where each
# thing in the title bar sits inside the bar. Boxes rather than a screenshot,
# because a pixel of drift is not something an eye reads off a picture.
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
    ['the space label', 'header .space'],
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

# The label beside the sidebar button: does it carry the space's own mark.
LABEL = """
() => {
  const label = document.querySelector('header .space')
  if (!label) return null

  return {
    text: label.textContent.trim(),
    marks: label.querySelectorAll('svg, .glyph, .nib-badge').length,
    html: label.innerHTML.slice(0, 200),
  }
}
"""

# The sidebar button's glyph, in both states: the same shapes, or two drawings.
TOGGLE = """
() => {
  const button = document.querySelector('header .toggle')
  if (!button) return null

  const shapes = [...button.querySelectorAll('svg *')].map((one) => {
    const style = getComputedStyle(one)
    return {
      tag: one.tagName.toLowerCase(),
      d: one.getAttribute('d') ?? one.getAttribute('x') ?? '',
      fill: style.fill,
      opacity: style.opacity,
    }
  })

  return { pressed: button.getAttribute('aria-pressed'), shapes }
}
"""

# What says a space is shared: a bare dot, or a mark. Both are looked for, so a
# run says which of the two it found rather than only whether it found one.
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


# What makes the window a phone. A headless browser has no touch screen for the
# app to recognise, so the device is set the way the other drives set it, along
# with the attributes the tokens read for the touch scale.
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


# Somebody else in the open note, which is what puts the shared mark on its row
# in the file list. There is no second device behind this run, so the count the
# rooms keep is written by hand; the mark and the rule that draws it are real.
WITH_SOMEBODY = """
() => {
  const app = window.nibApp
  const tab = app.workspace.tabs.find((one) => one.path && one.path.endsWith('.md'))
  if (!tab) return null

  app.rooms.present = { ...app.rooms.present, [tab.note.key]: 1 }
  return tab.path
}
"""

# Which rows in the file list wear it.
TREE_MARKS = """
() => [...document.querySelectorAll('aside .row')].map((row) => ({
  row: row.textContent.trim(),
  shared: row.querySelectorAll('.shared').length,
}))
"""


# Where the drawer is, so a shot of nothing is a reading rather than a puzzle.
ASIDE_AT = """
() => {
  const aside = document.querySelector('aside')
  if (!aside) return null

  const box = aside.getBoundingClientRect()
  return { left: Math.round(box.left), width: Math.round(box.width) }
}
"""


def on_phone(browser: Browser, scheme: str = "light") -> None:
    """The same two surfaces under a thumb. The bar says the note's name there
    rather than the space's, so what is checked is the drawer's own head: the
    same switcher, the same badges, at the touch scale."""
    label = "phone"
    page = fresh(browser, label, {"width": 390, "height": 844}, scheme)
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        say(f"[{label}] {page.evaluate(SEED)}")
        say(f"[{label}] {page.evaluate(MORE_SPACES)}")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

        page.locator("header").first.screenshot(path=str(SHOTS / "bar-phone.png"))
        say(f"[{label}] wrote bar-phone.png")

        # The screen, which at this width is the note with the bar over it: the
        # list is a drawer behind it, and the note is the layer a thumb slides
        # aside to uncover it. A headless run has no thumb, so what the phone pass
        # is really for is the numbers below - the badges are drawn at the touch
        # scale whether or not a picture can be taken of them.
        page.screenshot(path=str(SHOTS / "screen-phone.png"))
        say(f"[{label}] wrote screen-phone.png")
        say(f"[{label}] the drawer sits at {page.evaluate(ASIDE_AT)}")

        toggle = page.evaluate(TOGGLE)
        say(f"[{label}] the drawer's own button: {toggle}")
        if toggle:
            faint = [one for one in toggle["shapes"] if float(one["opacity"]) < 0.95]
            check(not faint, f"[{label}] every part of the drawer's button is drawn ({faint})")

        # The drawer is a layer that slides, so the button in it is only a target
        # once it has arrived. Pressed through the page rather than aimed at, for
        # the same reason: a headless run has no finger to open the drawer with.
        page.evaluate("() => document.querySelector('aside .name')?.click()")
        page.wait_for_timeout(600)
        page.locator(".spaces").first.screenshot(path=str(SHOTS / "switcher-phone.png"))
        say(f"[{label}] wrote switcher-phone.png")

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

        # ── The bar, with the panel shut, which is when it carries the label ──
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
            f"[{label}] the bar holds the menu, the button, the label and a tab",
        )
        for one in placed:
            check(
                abs(one["off"]) <= SLACK,
                f"[{label}] {one['name']} is on the bar's centre line (off by {one['off']}px)",
            )

        label_seen = page.evaluate(LABEL)
        say(f"[{label}] the space label: {label_seen}")
        if label_seen:
            check(
                label_seen["marks"] >= 1,
                f"[{label}] the space label wears the space's own mark",
            )

        shut = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button shut: {shut}")

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(500)
        opened = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button open: {opened}")

        check(
            [one["tag"] for one in shut["shapes"]] == [one["tag"] for one in opened["shapes"]],
            f"[{label}] the sidebar button is made of the same shapes in both states",
        )
        # The shut state is the one that used to be a different glyph: the panel's
        # edge was faded out of it, leaving a plain window.
        for state, seen in (("shut", shut), ("open", opened)):
            faint = [one for one in seen["shapes"] if float(one["opacity"]) < 0.95]
            check(
                not faint,
                f"[{label}] every part of the sidebar button is drawn while it is"
                f" {state} ({faint})",
            )

        # ── The switcher, open, which is where the badges are ──
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

        # The file list's half of the same mark: a note somebody else is in.
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
        page.locator("aside").screenshot(path=str(SHOTS / f"tree-{label}.png"))
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
    finally:
        page.context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                drive(browser, "light", {"width": 1180, "height": 760}, "light")
                drive(browser, "dark", {"width": 1180, "height": 760}, "dark")
                on_phone(browser)
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print("\nwhat is still wrong:", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe bar is one row and every mark is centred", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
