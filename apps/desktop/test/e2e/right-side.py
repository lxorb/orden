from __future__ import annotations

import sys

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\n## What went in\\n\\nA kestrel over the field.\\n\\n### Wind\\n\\nSteady all week.', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor.', undefined)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

MEASURED = """
() => {
  const box = (what) => {
    const found = document.querySelector(what)
    if (!found) return null

    const rect = found.getBoundingClientRect()
    return [rect.left, rect.top, rect.width, rect.height].map((one) => Math.round(one * 100) / 100)
  }

  return {
    left: box('.panels:not(.right) aside'),
    foot: box('[data-region="foot"]'),
    tabs: box('[data-region="tabs"]'),
    editor: box('[data-region="editor"]'),
    // And whether there is a right side in the page at all.
    right: document.querySelectorAll('.panels.right').length,
    toggles: document.querySelectorAll('button.toggle').length,
  }
}
"""

SIDES = """
() => {
  const ws = window.nibApp.workspace
  return { right: [...ws.right], left: ws.panel, rightOpen: ws.rightPanel }
}
"""

STRIPS = """
() => [...document.querySelectorAll('.panels')].map((one) => ({
  side: one.classList.contains('right') ? 'right' : 'left',
  tabs: [...one.querySelectorAll('[role=tab]')].map((tab) => tab.getAttribute('aria-label')),
  showing: [...one.querySelectorAll('[role=tab][aria-selected=true]')].map((tab) =>
    tab.getAttribute('aria-label'),
  ),
}))
"""

WHERE = """
() => {
  const at = document.activeElement
  if (!at) return 'nothing'

  const region = at.closest('[data-region]')?.dataset.region ?? '-'
  const named =
    at.getAttribute('aria-label') ?? (at.textContent ?? '').trim().slice(0, 24)
  return `${region} | ${at.tagName.toLowerCase()} | ${JSON.stringify(named)}`
}
"""

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def started(browser, name: str, width: int, height: int, agent: str, finger: bool):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="dark" if not finger else "light",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    DRIVE.open(page)
    say(f"[{name}] the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(700)

    return context, page

def onDesktop(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    context, page = started(browser, "desktop", 1440, 900, DESKTOP_AGENT, False)

    def shot(tag: str) -> None:
        page.screenshot(path=str(SHOTS / f"desktop-{tag}.png"))
        say(f"    shot desktop-{tag}.png")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)

    before = page.evaluate(MEASURED)
    say(f"as it arrives: {before}")
    say(f"the strips: {page.evaluate(STRIPS)}")
    shot("nothing-moved")

    say("--- a panel moved over ---")
    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(400)
    page.evaluate("() => window.nibApp.workspace.movePanel('search', 'right')")
    page.wait_for_timeout(700)

    say(f"the sides say: {page.evaluate(SIDES)}")
    say(f"the strips: {page.evaluate(STRIPS)}")
    moved = page.evaluate(MEASURED)
    say(f"with a panel on the right: right columns {moved['right']}, toggles {moved['toggles']}")
    say(f"the note is now {moved['editor']} (it was {before['editor']})")
    shot("search-on-the-right")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)
    say(f"both sides open: {page.evaluate(SIDES)}")
    shot("both-sides")

    say("--- F6 reaches it ---")
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)
    walked = []
    for _ in range(10):
        page.keyboard.press("F6")
        page.wait_for_timeout(220)
        walked.append(page.evaluate("() => document.activeElement?.closest('[data-region]')?.dataset.region ?? '-'"))
    say(f"F6 went round: {' -> '.join(walked)}")
    say(f"and where it stopped: {page.evaluate(WHERE)}")

    say("--- the window remembers which side ---")
    page.evaluate("() => window.nibApp.workspace.flush?.()")
    page.wait_for_timeout(400)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    page.wait_for_timeout(1200)
    say(f"after a restart: {page.evaluate(SIDES)}")
    shot("after-a-restart")

    say("--- and moved back ---")
    page.evaluate("() => window.nibApp.workspace.movePanel('search', 'left')")
    page.wait_for_timeout(700)
    after = page.evaluate(MEASURED)
    say(f"the sides say: {page.evaluate(SIDES)}")

    for what in ["left", "foot", "tabs", "editor"]:
        same = before[what] == after[what]
        say(f"{what}: {after[what]} {'same as before' if same else f'MOVED (was {before[what]})'}")
    say(f"right columns now {after['right']}, toggles {after['toggles']}")
    shot("moved-back")

    context.close()

def onPhone(browser) -> None:
    context, page = started(browser, "phone", 390, 844, PHONE_AGENT, True)

    def shot(tag: str) -> None:
        page.screenshot(path=str(SHOTS / f"phone-{tag}.png"))
        say(f"    shot phone-{tag}.png")

    say("--- a drawer from the right ---")
    page.evaluate("() => window.nibApp.workspace.movePanel('outline', 'right')")
    page.wait_for_timeout(500)
    say(f"the sides say: {page.evaluate(SIDES)}")

    more = page.locator("[data-phone-more]").first
    say(f"the note's More button is there: {more.count() == 1}")
    more.tap()
    page.locator('[role="menuitem"]:has-text("Outline")').tap()
    page.wait_for_timeout(700)
    say(f"after pressing it: {page.evaluate(SIDES)}")
    say(f"and the drawer is over the note: {page.evaluate(DRAWER)}")
    shot("drawer-open")

    page.mouse.click(40, 400)
    page.wait_for_timeout(700)
    say(f"after the scrim: {page.evaluate(SIDES)}")
    shot("drawer-shut")

    page.evaluate("() => window.nibApp.workspace.toggleSidebar()")
    page.wait_for_timeout(700)
    say(f"the left drawer still opens: {page.evaluate(SIDES)}")
    shot("left-drawer")

    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.wait_for_timeout(700)

    say("--- and a thumb drags it out ---")
    held = page.evaluate(DRAG, {"from": 380, "to": 200, "y": 420, "steps": 9, "hold": True})
    for one in held[::3]:
        say(f"    at x={one['x']}: right edge {one['right']}, scrim {one['scrim']:.2f}")
    say(f"the sides mid-drag: {page.evaluate(SIDES)}")
    shot("drag-half-way")

    page.evaluate(DRAG, {"from": 200, "to": 60, "y": 420, "steps": 6, "hold": False})
    page.wait_for_timeout(700)
    say(f"after the drag: {page.evaluate(SIDES)}")
    say(f"and where it landed: {page.evaluate(DRAWER)}")
    shot("drag-open")

    back = page.evaluate(DRAG, {"from": 120, "to": 380, "y": 420, "steps": 9, "hold": False})
    say(f"pushing it back: {[one['right'] for one in back]}")
    page.wait_for_timeout(700)
    say(f"after pushing it back: {page.evaluate(SIDES)}")
    shot("drag-shut")

    say("--- the left drawer's drag is what it was ---")
    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.evaluate("() => window.nibApp.workspace.closePanel('right')")
    page.wait_for_timeout(700)
    say(f"from shut: {page.evaluate(SIDES)}")
    left = page.evaluate(DRAG, {"from": 30, "to": 300, "y": 420, "steps": 9, "hold": True})
    say(f"the note follows: {[one['note'] for one in left]}")
    say(f"the sides mid-drag: {page.evaluate(SIDES)}")
    shot("left-drag-half-way")
    page.evaluate(DRAG, {"from": 300, "to": 380, "y": 420, "steps": 3, "hold": False})
    page.wait_for_timeout(700)
    say(f"after the left drag: {page.evaluate(SIDES)}")

    context.close()

DRAG = """
async (plan) => {
  const target = document.elementFromPoint(plan.from, plan.y) ?? document.body
  const fire = (kind, x) => {
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: plan.y })
    target.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const edge = (what) => {
    const one = document.querySelector(what)
    if (!one) return null
    return Math.round(one.getBoundingClientRect().left)
  }

  const seen = () => ({
    right: edge('.panels.right'),
    left: edge('.panels:not(.right)'),
    note: edge('.document'),
    scrim: Number(getComputedStyle(document.querySelector('.scrim') ?? document.body).opacity),
  })

  fire('touchstart', plan.from)
  const frames = []
  for (let step = 1; step <= plan.steps; step += 1) {
    const x = Math.round(plan.from + ((plan.to - plan.from) * step) / plan.steps)
    await new Promise((go) => requestAnimationFrame(go))
    fire('touchmove', x)
    frames.push({ x, ...seen() })
  }

  if (!plan.hold) fire('touchend', plan.to)
  return frames
}
"""

DRAWER = """
() => {
  const one = document.querySelector('.panels.right')
  if (!one) return { none: true }

  const box = one.getBoundingClientRect()
  const style = getComputedStyle(one)
  return {
    left: Math.round(box.left),
    right: Math.round(box.right),
    width: Math.round(box.width),
    window: window.innerWidth,
    fixed: style.position === 'fixed',
  }
}
"""

def main() -> int:
    with DRIVE.session() as browser:
        onDesktop(browser)
        onPhone(browser)

    return DRIVE.verdict(f"shots in {SHOTS}")

if __name__ == "__main__":
    raise SystemExit(main())
