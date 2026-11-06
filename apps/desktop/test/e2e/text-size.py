from __future__ import annotations

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\nThe words here are what the size is about.', undefined)
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

SIZE = """
() => {
  const root = document.documentElement
  const badge = document.querySelector('.size')
  return {
    zoom: getComputedStyle(root).getPropertyValue('--zoom').trim(),
    kept: window.nibApp.modes.zoom,
    badge: badge ? badge.textContent.trim() : null,
    // What the app must never be doing: the page's own scale, which a webview
    // zoom would move.
    scale: Math.round(window.devicePixelRatio * 100) / 100,
  }
}
"""

def wheel(page, where: str, ctrl: bool, up: bool) -> None:
    box = page.locator(where).first.bounding_box()
    if not box:
        raise SystemExit(f"nothing at {where}")

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    if ctrl:
        page.keyboard.down("Control")
    page.mouse.wheel(0, -120 if up else 120)
    if ctrl:
        page.keyboard.up("Control")
    page.wait_for_timeout(260)

def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(600)

    page.evaluate("() => window.nibApp.modes.resetZoom()")
    page.wait_for_timeout(400)
    say(f"at rest: {page.evaluate(SIZE)}")

    say("--- Ctrl and the wheel over the note ---")
    wheel(page, "#write", ctrl=True, up=True)
    say(f"one notch in:  {page.evaluate(SIZE)}")
    page.screenshot(path=str(SHOTS / "badge.png"))
    say("shot badge.png")

    wheel(page, "#write", ctrl=True, up=True)
    say(f"two notches in: {page.evaluate(SIZE)}")

    for _ in range(3):
        wheel(page, "#write", ctrl=True, up=False)
    say(f"three notches out: {page.evaluate(SIZE)}")

    page.wait_for_timeout(1200)
    say(f"a moment later: {page.evaluate(SIZE)}")

    say("--- what must not change it ---")
    before = page.evaluate("() => window.nibApp.modes.zoom")
    wheel(page, "#write", ctrl=False, up=True)
    say(f"a notch without Ctrl: {before} -> {page.evaluate('() => window.nibApp.modes.zoom')}")

    page.keyboard.press("Control+Shift+L")
    page.wait_for_timeout(500)
    wheel(page, "[data-region='list']", ctrl=True, up=True)
    say(f"a notch over the file list: {page.evaluate('() => window.nibApp.modes.zoom')}")

    say("--- the keys ---")

    def focus() -> None:
        page.evaluate(
            "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"
        )

    def size() -> float:
        return page.evaluate("() => window.nibApp.modes.zoom")

    def line() -> str:
        return page.evaluate(LINE)

    def pressed(key: str) -> None:
        page.keyboard.press(key)
        page.wait_for_timeout(260)

    focus()
    page.evaluate("() => window.nibApp.modes.resetZoom()")
    page.wait_for_timeout(300)

    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          view?.dispatch({ selection: { anchor: 6 } })
        }"""
    )
    page.wait_for_timeout(200)
    heading = line()
    say(f"the caret is in {heading!r} at {size()}")

    pressed("Control+Equal")
    bigger = size()
    say(f"Control+=              -> {bigger}")
    if bigger <= 1:
        wrong(f"Ctrl+= did not make the words bigger: {bigger}")
    if line() != heading:
        wrong(f"Ctrl+= changed the line as well: {line()!r}")

    pressed("Control+Equal")
    if size() <= bigger:
        wrong(f"a second Ctrl+= did not step again: {size()}")
    say(f"Control+= twice        -> {size()}")

    pressed("Control+Minus")
    if size() != bigger:
        wrong(f"Ctrl+- did not step back down: {size()} rather than {bigger}")
    say(f"Control+-              -> {size()}")

    pressed("Control+Digit0")
    said = page.evaluate(SIZE)
    if said["kept"] != 1:
        wrong(f"Ctrl+0 did not reset the size: {said}")
    if not said["badge"]:
        wrong("Ctrl+0 said nothing: the badge is what says what just happened")
    say(f"Control+0              -> {said}")
    page.screenshot(path=str(SHOTS / "reset-badge.png"))
    say("shot reset-badge.png")

    pressed("Control+Equal")
    if size() <= 1:
        wrong("Ctrl+= would not step, so the layout case cannot be told apart")
    pressed("Control+Shift+Digit0")
    if size() != 1:
        wrong(f"Ctrl+Shift+0 - which is Ctrl+0 on AZERTY - did not reset: {size()}")
    else:
        say("Control+Shift+0        -> reset, which is the AZERTY road to Ctrl+0")

    say("--- and the three that moved ---")
    was = size()

    pressed("Control+Shift+Equal")
    if line() == heading:
        wrong(f"Ctrl+Shift+= did not change the heading: {line()!r}")
    else:
        say(f"Control+Shift+=        -> {line()!r}")
    if size() != was:
        wrong(f"Ctrl+Shift+= changed the size as well: {size()}")

    pressed("Control+Shift+Minus")
    if line() != heading:
        wrong(f"Ctrl+Shift+- did not put the heading back: {line()!r}")
    else:
        say(f"Control+Shift+-        -> {line()!r}")

    pressed("Control+Digit1")
    if line().startswith("#"):
        wrong(f"Ctrl+1 on a first-level heading did not make it prose: {line()!r}")
    else:
        say(f"Control+1 again        -> {line()!r}")
    if size() != was:
        wrong(f"Ctrl+1 changed the size as well: {size()}")

    pressed("Control+Digit1")
    if line() != heading:
        wrong(f"Ctrl+1 did not make it a heading again: {line()!r}")
    else:
        say(f"Control+1              -> {line()!r}")

    pressed("Control+Shift+KeyP")
    field = page.evaluate("() => document.querySelector('.palette input')?.value ?? null")
    if field != ">":
        wrong(f"Ctrl+Shift+P did not open the palette on the commands: {field!r}")
    else:
        say("Control+Shift+P        -> the palette, on the commands")
    if line() != heading:
        wrong(f"Ctrl+Shift+P changed the line as well: {line()!r}")
    if size() != was:
        wrong(f"Ctrl+Shift+P changed the size as well: {size()}")

    page.screenshot(path=str(SHOTS / "commands.png"))
    say("shot commands.png")
    pressed("Escape")
    try:
        page.wait_for_function("() => !document.querySelector('.palette input')", timeout=3000, polling=50)
    except Exception:
        wrong("Escape did not close the palette")

    page.screenshot(path=str(SHOTS / "after.png"))
    say("shot after.png")
    context.close()

LINE = """
() => {
  const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("everything the drive checked was right")

if __name__ == "__main__":
    raise SystemExit(main())
