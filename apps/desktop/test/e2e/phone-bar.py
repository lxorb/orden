from __future__ import annotations

import sys

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.', undefined)
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
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

BAR = """
() => {
  const bar = document.querySelector('.nib-bar.docked')
  if (!bar) return { none: true }

  const buttons = [...bar.querySelectorAll('button')]
  return {
    none: false,
    marks: buttons.map((one) => (one.textContent ?? '').trim()).filter(Boolean),
    names: buttons.map((one) => one.getAttribute('aria-label')),
    height: Math.round(bar.getBoundingClientRect().height),
    // Every one of them is something a thumb lands on.
    smallest: Math.min(...buttons.map((one) => Math.round(one.getBoundingClientRect().height))),
  }
}
"""

CARET = """
() => {
  const view = window.nib
  if (!view) return null
  const line = view.state.doc.line(1)
  view.dispatch({ selection: { anchor: line.to } })
  view.focus()
  return view.state.doc.line(1).text
}
"""

LINES = """
() => window.nib.state.doc.toString().split('\\n').slice(0, 4)
"""

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def pulling(page, down: int, across: int = 0, hold: bool = False):
    return page.evaluate(PULL, {"down": down, "across": across, "hold": hold})

def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="light",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(700)

    say("--- the bar as it arrives ---")
    page.evaluate("() => window.nibApp.toolbar.reset()")
    page.evaluate(CARET)
    say(f"the keyboard: {page.evaluate(KEYS, 320)}")
    page.wait_for_timeout(400)
    held = page.evaluate(BAR)
    say(f"the strip: {held}")
    page.screenshot(path=str(SHOTS / "default.png"))
    say("shot default.png")

    say("--- a button presses the command its key presses ---")
    page.evaluate(CARET)
    page.click('.nib-bar.docked button[aria-label="Bold"]')
    page.wait_for_timeout(300)
    say(f"after Bold: {page.evaluate(LINES)}")

    say("--- the reader's own list ---")
    page.evaluate(
        "() => { const bar = window.nibApp.toolbar; bar.reset();"
        " bar.add('paragraph.task-list'); bar.add('app.reading'); bar.remove('format.clear');"
        " bar.move(bar.ids.length - 1, 0); return bar.ids }"
    )
    page.wait_for_timeout(400)
    say(f"the strip now: {page.evaluate(BAR)}")
    page.screenshot(path=str(SHOTS / "chosen.png"))
    say("shot chosen.png")

    page.evaluate(CARET)
    page.click('.nib-bar.docked button[aria-label="Reading"]')
    page.wait_for_timeout(400)
    say(f"Reading from the bar turned the note: {page.evaluate('() => window.nibApp.workspace.active.reading')}")

    say("--- the pane it is put together in ---")
    page.evaluate(KEYS, 0)
    page.evaluate("() => window.nibApp.settings.show('mobile')")
    page.wait_for_timeout(700)
    say(f"the pane says: {page.evaluate(PANE)}")
    page.screenshot(path=str(SHOTS / "pane.png"))
    say("shot pane.png")

    page.fill(".sheet .search input", "Footnote")
    page.wait_for_timeout(400)
    say(f"the list offers: {page.evaluate(OFFERS)}")
    page.click('button[aria-label="Put it on the bar"]')
    page.wait_for_timeout(400)
    say(f"after adding from the list: {page.evaluate('() => window.nibApp.toolbar.ids')}")
    page.screenshot(path=str(SHOTS / "added.png"))
    say("shot added.png")

    page.click('button[aria-label="Move down"]')
    page.wait_for_timeout(300)
    say(f"after one press of Move down: {page.evaluate('() => window.nibApp.toolbar.ids')}")

    page.click('button[aria-label="Take it off"]')
    page.wait_for_timeout(300)
    say(f"after Take it off: {page.evaluate('() => window.nibApp.toolbar.ids')}")

    say("--- pulling the note down past its top ---")
    page.evaluate("() => (window.nibApp.settings.open = false)")
    page.wait_for_timeout(500)
    say(f"the pull runs {page.evaluate('() => window.nibApp.pull.id')}")

    say(f"a short pull: {pulling(page, 40)}")
    say(f"a long pull:  {pulling(page, 200, hold=True)}")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "pulling.png"))
    say("shot pulling.png, with the finger still down")

    say(f"and on the lift the panel holds: {page.evaluate(LIFT)}")
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / "pulled.png"))
    say(f"shot pulled.png; the panel is {page.evaluate(PANEL)}")

    say(f"a sideways drag: {pulling(page, 30, across=90)}")
    say(f"a scroll upwards: {pulling(page, -60)}")
    say(f"nothing is left held: {page.evaluate('() => window.nibApp.pull.at === 0')}")

    page.evaluate("() => window.nibApp.settings.show('mobile')")
    page.wait_for_timeout(600)
    page.click('button:text("Reset the bar")')
    page.wait_for_timeout(400)
    say(f"after the reset: {page.evaluate('() => window.nibApp.toolbar.ids')}")
    say(f"and the account is told: {page.evaluate('() => window.nibApp.toolbar.changed')}")
    page.screenshot(path=str(SHOTS / "reset.png"))
    say("shot reset.png")

    context.close()

OFFERS = """
() => [...document.querySelectorAll('.sheet .setting.button')]
  .map((one) => one.getAttribute('aria-label') ?? (one.querySelector('.name')?.textContent ?? '').trim())
  .slice(-4)
"""

PANEL = """
() => window.nibApp.workspace.panel
"""

PULL = """
async ({ down, across, hold }) => {
  const view = window.nib
  const scroller = view.scrollDOM
  scroller.scrollTop = 0

  const box = scroller.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + 20

  const finger = (clientX, clientY) =>
    new Touch({ identifier: 1, target: scroller, clientX, clientY })

  const send = (kind, touch) =>
    scroller.dispatchEvent(
      new TouchEvent(kind, {
        bubbles: true,
        cancelable: true,
        touches: touch ? [touch] : [],
        targetTouches: touch ? [touch] : [],
        changedTouches: touch ? [touch] : [],
      }),
    )

  send('touchstart', finger(x, y))
  // In steps, the way a finger arrives: the handler claims the gesture on one of
  // them and follows the rest.
  for (const part of [0.3, 0.6, 1]) {
    send('touchmove', finger(x + across * part, y + down * part))
    await new Promise((done) => requestAnimationFrame(done))
  }

  const at = window.nibApp.pull.at
  const ready = window.nibApp.pull.ready
  // Held, so the mark can be looked at: the lift is `LIFT`, next door.
  if (!hold) send('touchend', null)
  window.__pullFinger = () => send('touchend', null)

  return { at, ready }
}
"""

LIFT = """
() => {
  window.__pullFinger?.()
  return window.nibApp.workspace.panel
}
"""

PANE = """
() => {
  const sheet = document.querySelector('.sheet')
  if (!sheet) return { none: true }

  const rows = [...sheet.querySelectorAll('.setting.button')]
  const marks = rows.map((one) => (one.querySelector('.mark')?.textContent ?? '').trim())
  const named = rows.map((one) => one.getAttribute('aria-label')).filter(Boolean)
  const touch = Math.min(
    ...[...sheet.querySelectorAll('.setting.button .revert')].map((one) =>
      Math.round(one.getBoundingClientRect().height),
    ),
  )

  return { rows: rows.length, marks: marks.slice(0, 12), named: named.slice(0, 12), touch }
}
"""

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict(f"shots in {SHOTS}")

if __name__ == "__main__":
    raise SystemExit(main())
