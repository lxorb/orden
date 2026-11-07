from __future__ import annotations

import os
import sys
from pathlib import Path

from settling import HIDE_CARET, steady as held

from harness import Drive

DRIVE = Drive(__file__, fresh=False)
say = DRIVE.say
ORIGIN = DRIVE.origin

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

DEVICES = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("tablet", 834, 1194, TABLET_AGENT, True, "light"),
    ("tablet-wide", 1194, 834, TABLET_AGENT, True, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
    ("phone-wide", 844, 390, PHONE_AGENT, True, "dark"),
]

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)

  // A folder with no note of its own, which is the one kind nib does not make: it
  // is here because the notes below are written into it, the way a vault's folders
  // are. Its row is a note nobody has written; see docs/tree.md.
  const folder = join(root, 'Field notes')

  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\n## What went in this week\\n\\n- Pressure on the pen\\n- Slides out of a note\\n\\n### Wind\\n\\nThe wind was steady all week.', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor that formats what you write as you write it.', undefined)
  await ws.noteFrom('# Reading list\\n\\nA paper about ink, and one about wind.', undefined)
  await ws.noteFrom('# Standup\\n\\nMonday: wind tunnel. Tuesday: ink.', undefined)
  await ws.noteFrom('# Ledger\\n\\nWhat the wind cost.', folder)
  await ws.noteFrom('# Sketches\\n\\nInk on paper.', folder)

  ws.device.expand(folder)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) {
    ws.bookmarks.toggle({ kind: 'note', path: first.name })
    await ws.openEntry(first.path, { activate: true })
  }
  const second = ws.notes.find((one) => one.name.startsWith('Read me'))
  if (second) await ws.openEntry(second.path, { activate: true })
  const third = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (third) await ws.openEntry(third.path, { activate: true })

  return ws.files.map((one) => one.name)
}
"""

LANGUAGES = """
() => {
  const trigger = [...document.querySelectorAll('button.trigger')].find(
    (one) => one.getAttribute('aria-label') === 'Language',
  )
  if (!trigger) return { none: true }

  trigger.click()
  return new Promise((go) =>
    requestAnimationFrame(() => {
      const rows = [...document.querySelectorAll('[role=option]')]
      const marked = rows.filter((one) => one.querySelector('.mark'))
      go({
        rows: rows.length,
        marked: marked.length,
        plain: rows
          .filter((one) => !one.querySelector('.mark'))
          .map((one) => one.querySelector('.text')?.textContent),
        says: marked[0]?.querySelector('.mark')?.getAttribute('title') ?? '',
        reads: marked[0]?.querySelector('.text')?.textContent ?? '',
      })
    }),
  )
}
"""

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAYERS = "[role=menu], .palette, .orden-screen.sheet"

def dismiss(page) -> None:
    for _ in range(4):
        if not page.locator(LAYERS).count():
            return

        page.keyboard.press("Escape")
        try:
            page.wait_for_selector(LAYERS, state="detached", timeout=1500)
            return
        except Exception:
            pass

        scrim = page.locator(".scrim:visible").last
        if not scrim.count():
            return
        try:
            scrim.click(force=True, position={"x": 4, "y": 4}, timeout=2000)
        except Exception:
            return

    if page.locator(LAYERS).count():
        say("a layer would not go")

def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)

    def steady(take) -> bytes:
        return held(page, take, say, f"[{name}]")

    def shot(tag: str) -> None:
        picture = steady(lambda: page.screenshot())
        (shots / f"{name}-{tag}.png").write_bytes(picture)
        say(f"shot {name}-{tag}.png")

    def strip(tag: str, selector: str, pad: int = 8) -> None:
        try:
            box = page.locator(selector).first.bounding_box()
        except Exception as why:
            say(f"[{name}] no {selector}: {why}")
            return
        if not box:
            say(f"[{name}] {selector} has no box")
            return

        clip = {
            "x": max(0, box["x"] - pad),
            "y": max(0, box["y"] - pad),
            "width": min(width, box["width"] + pad * 2),
            "height": box["height"] + pad * 2,
        }
        picture = steady(lambda: page.screenshot(clip=clip))
        (shots / f"{name}-{tag}.png").write_bytes(picture)
        say(f"shot {name}-{tag}.png")

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
        reduced_motion="reduce",
        first_look=bool(os.environ.get("ORDEN_FIRST_LOOK")),
    )
    page = context.new_page()
    page.add_init_script(HIDE_CARET)

    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    if os.environ.get("ORDEN_FIRST_LOOK"):
        DRIVE.wait_for(
            page,
            "getComputedStyle(document.documentElement).getPropertyValue('--glass-chrome')",
            "glass's sheet",
        )
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.wait_for_timeout(600)

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)
    shot("files")

    strip("foot", "aside .foot")

    if finger:
        strip("drawerhead", "aside .head")
        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(500)
        strip("titlebar", ".document header")
        shot("note")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)
    else:
        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(500)
        strip("collapsed", "header")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

    switcher = page.locator("aside .name")
    if switcher.count():
        try:
            switcher.click(force=True)
            page.wait_for_selector("[role=menu]", state="visible", timeout=8000)
            shot("spaces")
        except Exception as why:
            say(f"[{name}] no switcher: {why}")
        dismiss(page)

    rows = page.locator("aside .row")
    if rows.count():
        try:
            rows.nth(2).click(button="right", force=True)
            page.wait_for_selector("[role=menu]", state="visible", timeout=8000)
            shot("rowmenu")
        except Exception as why:
            say(f"[{name}] no row menu: {why}")
        dismiss(page)

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)
    shot("outline")

    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(400)
    box = page.locator("aside input").first
    if box.count():
        try:
            box.fill("wind")
            page.wait_for_timeout(900)
        except Exception as why:
            say(f"[{name}] nothing to type in: {why}")
    shot("search")

    page.evaluate("() => window.nibApp.workspace.showPanel('links')")
    page.wait_for_timeout(600)
    shot("links")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)

    page.evaluate("() => window.nibApp.workspace.openGraph()")
    try:
        page.wait_for_selector(".graph", timeout=20000)
        page.wait_for_timeout(1400)
        card = page.locator(".graph .corner > button").last
        if card.count():
            card.click(force=True)
            page.wait_for_timeout(600)
            shot("graph-card")
            strip("graph-card-close", ".graph .corner .card")
        else:
            say(f"[{name}] no card on the graph")
    except Exception as why:
        say(f"[{name}] no graph: {why}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
          if (first) await ws.openEntry(first.path, { activate: true })
        }"""
    )
    page.wait_for_timeout(700)

    page.keyboard.press("Control+KeyP")
    try:
        page.wait_for_selector(".palette", state="visible", timeout=8000)
        shot("palette")
    except Exception as why:
        say(f"[{name}] no palette: {why}")
    dismiss(page)

    if finger:
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

    page.evaluate("() => window.nibApp.settings.show()")
    page.wait_for_selector(".orden-screen.sheet, .sheet", state="visible", timeout=8000)
    shot("settings")

    page.evaluate(
        "() => { window.nibApp.settings.section = 'appearance'; window.nibApp.settings.listing = false }"
    )
    page.wait_for_selector(".sheet .segmented, .sheet", state="visible", timeout=8000)
    shot("settings-appearance")

    page.evaluate(
        "() => { window.nibApp.settings.section = 'general'; window.nibApp.settings.listing = false }"
    )
    page.wait_for_timeout(300)
    say(f"[{name}] the language list: {page.evaluate(LANGUAGES)}")
    shot("settings-language")

    page.evaluate("() => window.nibApp.settings.hide?.() ?? (window.nibApp.settings.open = false)")
    page.wait_for_timeout(400)

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const path = await ws.noteFrom('# A table\\n\\n| Platform | Sync | Publish |\\n| --- | --- | --- |\\n| Desktop | yes | yes |\\n| Phone | yes | no |\\n| Tablet | yes | yes |\\n')
          if (path) await ws.openEntry(path, { activate: true })
        }"""
    )
    page.wait_for_timeout(900)
    shot("table")

    context.close()

def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"
    out = DRIVE.shots / tag
    with DRIVE.session() as browser:
        for one in DEVICES:
            say(f"--- {one[0]} ---")
            drive(browser, out, *one)

    return DRIVE.verdict(f"shots in {out}")

if __name__ == "__main__":
    raise SystemExit(main())
