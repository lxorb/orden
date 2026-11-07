from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  for (const name of ['Medizin', 'Work']) {
    await ws.addSpace(name)
    const space = ws.spaces.find((one) => one.name === name)
    await ws.selectSpace(space.id)
    ws.openBlank(name + ' one', '# ' + name)
    await new Promise((go) => setTimeout(go, 300))
  }
  await ws.selectSpace(home.id)
  ws.openBlank('Here', '# Here\\n\\nwords')
  localStorage.setItem('orden:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
}
"""

FOREIGN = """
() => {
  const own = (node) => !!node.closest('.canvas, .under, .ground, header[data-chrome="top"], [data-notices]')
  const found = new Map()
  const bar = document.querySelector('header[data-chrome="top"]')?.getBoundingClientRect().bottom ?? 0
  for (let x = 4; x < innerWidth; x += 24) {
    for (let y = bar + 4; y < innerHeight; y += 24) {
      const top = document.elementFromPoint(x, y)
      if (!top || own(top)) continue
      const name = top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')
      if (!found.has(name)) found.set(name, [x, y])
    }
  }
  return [...found].map(([name, at]) => name + ' at ' + at.join(','))
}
"""

CLEAR_TOP = """
() => {
  const top = document.querySelector('.canvas .top')
  if (!top) return { crossing: 0, through: ['no row at the top'] }
  const buttons = [...top.querySelectorAll('button, [role=combobox]')].map((one) => one.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0)
  const left = Math.min(...buttons.map((b) => b.left))
  const right = Math.max(...buttons.map((b) => b.right))
  const y = buttons[0].top + buttons[0].height / 2
  const row = { top: Math.min(...buttons.map((b) => b.top)), bottom: Math.max(...buttons.map((b) => b.bottom)) }
  const crossing = [...document.querySelectorAll('.canvas .window, .bubble')].filter((w) => {
    const b = w.getBoundingClientRect()
    return b.bottom > row.top && b.top < row.bottom
  }).length
  const through = []
  for (const x of [left / 2, left - 12, ...buttons.map((b) => b.left + b.width / 2), right + 12, (right + innerWidth) / 2]) {
    const hit = document.elementFromPoint(x, y)
    if (!hit || !hit.closest('.canvas .band, .canvas .top')) through.push(Math.round(x) + ': ' + (hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0] : 'nothing'))
  }
  return { crossing, through }
}
"""

def open_overview(page: Page) -> None:
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    page.wait_for_selector(".canvas .window", timeout=8000)
    page.wait_for_timeout(1500)

def pan_up(page: Page) -> None:
    page.mouse.move(700, 860)
    page.mouse.down()
    for step in range(1, 25):
        page.mouse.move(700, 860 - step * 22)
        page.wait_for_timeout(16)
    page.mouse.up()
    page.wait_for_timeout(700)

def drive(browser: Browser) -> None:
    for side in (False, True):
        label = "sidebar" if side else "plain"
        page = DRIVE.page(browser, viewport={"width": 1400, "height": 900})
        DRIVE.open(page)
        page.evaluate(SEED)
        if side:
            page.evaluate("() => { const ws = window.nibApp.workspace; if (!ws.openOn('left')) ws.toggleSidebar('left') }")
        page.wait_for_timeout(500)
        page.locator(".cm-content").first.click()
        page.keyboard.type("x")
        open_overview(page)
        focus = page.evaluate("() => { const a = document.activeElement; return !!a && (a.isContentEditable || ['INPUT', 'TEXTAREA'].includes(a.tagName)) }")
        if focus:
            wrong(f"[{label}] the overview left the keyboard in a text field, where the system keeps its caret marks")
        else:
            say(f"ok   [{label}] no text field holds the keyboard over the overview")
        foreign = page.evaluate(FOREIGN)
        shot(page, f"{label}-open")
        if foreign:
            wrong(f"[{label}] drawn over the overview: {foreign}")
        else:
            say(f"ok   [{label}] nothing of the app behind is drawn over the overview")
        pan_up(page)
        shot(page, f"{label}-panned")
        said = page.evaluate(CLEAR_TOP)
        clear = said["through"]
        if not said["crossing"]:
            wrong(f"[{label}] panning brought no bubble under the row at the top, so it shows nothing")
        if clear:
            wrong(f"[{label}] the row of buttons at the top and the bubbles lie on each other: {clear}")
        else:
            say(f"ok   [{label}] panned under it, the bubbles stay clear of the buttons at the top")
        page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "nothing floats over the overview, and its buttons stay clear of the bubbles"))
