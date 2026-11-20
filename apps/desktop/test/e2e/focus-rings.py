import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const path = await ws.noteFrom(`# ${name}\\n\\n- [ ] a task\\n`, root)
    await ws.openEntry(path, { activate: true })
    ws.keep(ws.activeTabId)
  }
  if (!ws.panel) ws.showPanel('tree')
}
"""
LOOK = """
() => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const style = getComputedStyle(el)
  const box = el.getBoundingClientRect()
  const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map((one) => parseFloat(style[one]) || 0)
  const after = getComputedStyle(el, '::after')
  const path = []
  for (let at = el; at && at !== document.body && path.length < 4; at = at.parentElement) path.push(at.tagName.toLowerCase() + (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''))
  return {
    path: path.join(' < '),
    label: el.getAttribute('aria-label') || (el.innerText || '').trim().slice(0, 30),
    outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 ? `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}` : null,
    square: Math.max(...radii) === 0,
    width: Math.round(box.width),
    height: Math.round(box.height),
    ring: after.content !== 'none' && after.borderTopStyle !== 'none' ? `after ${after.borderTopWidth} radius ${after.borderTopLeftRadius}` : null,
  }
}
"""
def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
        DRIVE.open(page)
        page.evaluate(SEED)
        page.wait_for_timeout(800)
        page.evaluate("() => document.activeElement?.blur()")
        seen = {}
        tabs = 0
        for _ in range(160):
            page.keyboard.press("Tab")
            one = page.evaluate(LOOK)
            if not one:
                continue
            key = one["path"] + "|" + one["label"]
            if key in seen:
                continue
            seen[key] = one
            if one["outline"] and one["square"] and one["width"] > 24 and one["height"] > 16:
                DRIVE.wrong(f"[{scheme}] a square ring: {json.dumps(one)}")
            if "button.pick" in one["path"]:
                tabs += 1
                if not one["outline"]:
                    DRIVE.wrong(f"[{scheme}] the tab {one['label']} shows no focus at all")
                elif one["square"]:
                    DRIVE.wrong(f"[{scheme}] the tab {one['label']} wears a square ring: {one['outline']}")
                else:
                    DRIVE.shot(page, f"tab-focus-{scheme}", clip={"x": 0, "y": 0, "width": 900, "height": 60})
        say(f"[{scheme}] {len(seen)} places took the focus, {tabs} of them tabs")
        if not tabs:
            DRIVE.wrong(f"[{scheme}] the Tab key never reached a tab")
        page.context.close()
raise SystemExit(DRIVE.run(drive, "keyboard focus is a ring in the shape of what holds it, never a square one"))
