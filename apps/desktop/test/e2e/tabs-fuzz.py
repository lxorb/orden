from __future__ import annotations

import json
import os
import random

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
WS = "window.nibApp.workspace"
SEED = int(os.environ.get("FUZZ_SEED", "1"))
OPS = int(os.environ.get("FUZZ_OPS", "300"))

PICK = "const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]"

ACTS: list[tuple[str, str]] = [
    ("note", f"{WS}.openBlank('N' + Math.random().toString(36).slice(2, 6), '# N\\n\\nwords ' + Math.random())"),
    ("new tab", f"{WS}.newTab()"),
    ("split", f"{PICK}; const t = pick({WS}.tabs); if (t) {WS}.split(Math.random() < 0.5 ? 'row' : 'column', t.id)"),
    ("close", f"{PICK}; const t = pick({WS}.tabs); if (t) {WS}.close(t.id)"),
    ("close active", f"if ({WS}.activeTabId) {WS}.close({WS}.activeTabId)"),
    ("close pane", f"{PICK}; const p = pick({WS}.panes.all); if (p) {WS}.closePane(p.id)"),
    ("activate", f"{PICK}; const t = pick({WS}.tabs); if (t) {WS}.activate(t.id)"),
    ("focus pane", f"{PICK}; const p = pick({WS}.panes.all); if (p) {WS}.focusPane(p.id)"),
    ("move", f"{PICK}; const t = pick({WS}.tabs); const p = pick({WS}.panes.all); if (t && p) {WS}.moveTab(t.id, p.id, Math.random() < 0.5 ? null : Math.floor(Math.random() * 4))"),
    ("drop", f"{PICK}; const t = pick({WS}.tabs); const p = pick({WS}.panes.all); if (t && p) {WS}.dropTab(t.id, {{ kind: 'pane', paneId: p.id, zone: pick(['left', 'right', 'top', 'bottom', 'middle']) }})"),
    ("reopen", f"void {WS}.reopenClosed()"),
    ("reading", f"{WS}.toggleReading()"),
    ("deselect", f"{WS}.deselect()"),
]

KEYS = ["Control+Tab", "Control+Shift+Tab", "Control+w", "Control+Shift+t", "Control+t", "Alt", "Control+\\", "Escape"]

CHECK = f"""() => {{
  const ws = {WS}
  const bad = []
  const panes = ws.panes.all
  const paneIds = new Set(panes.map((p) => p.id))
  const ids = ws.tabs.map((t) => t.id)
  if (new Set(ids).size !== ids.length) bad.push('a tab is listed twice')
  for (const t of ws.tabs) if (!paneIds.has(t.paneId)) bad.push(`tab ${{t.name}} sits in a pane that is gone`)
  for (const p of panes) {{
    if (p.activeTabId !== null && !ws.tabs.some((t) => t.id === p.activeTabId && t.paneId === p.id))
      bad.push(`pane ${{p.id.slice(0, 6)}} shows a tab that is not in it`)
    if (panes.length > 1 && !ws.tabs.some((t) => t.paneId === p.id)) bad.push(`pane ${{p.id.slice(0, 6)}} stays empty beside others`)
  }}
  if (!paneIds.has(ws.panes.focusedId)) bad.push('the focused pane is gone')
  if (ws.activeTabId !== null && !ws.tabs.some((t) => t.id === ws.activeTabId)) bad.push('the active tab is gone')
  const shown = document.querySelectorAll('[role=tab]').length
  return {{ bad, tabs: ws.tabs.length, panes: panes.length, shown }}
}}"""

DOM = f"""() => {{
  const ws = {WS}
  const bad = []
  const panes = ws.panes.all
  const drawn = document.querySelectorAll('[data-pane]').length
  if (drawn !== panes.length) bad.push(`${{drawn}} panes drawn for ${{panes.length}}`)
  const shown = [...new Set([...document.querySelectorAll('.pick[data-tab]')].map((one) => one.dataset.tab))].sort()
  const want = panes.flatMap((p) => ws.tabsIn(p.id).map((t) => t.id)).sort()
  const extra = shown.filter((id) => !want.includes(id)).length
  const missing = want.filter((id) => !shown.includes(id)).length
  const named = (id) => (document.querySelector(`.pick[data-tab="${{id}}"]`)?.textContent ?? '').trim().slice(0, 20)
  if (extra) bad.push(`tabs drawn that are gone: ${{shown.filter((id) => !want.includes(id)).map(named).join(', ')}}`)
  if (missing) bad.push(`${{missing}} tabs not drawn`)
  return bad
}}"""

LONG = """
window.__long = []
new PerformanceObserver((list) => { for (const one of list.getEntries()) if (one.duration > 400) window.__long.push(Math.round(one.duration)) })
  .observe({ type: 'longtask', buffered: true })
"""


def drive(browser: Browser) -> None:
    rand = random.Random(SEED)
    page = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    page.add_init_script(LONG)
    DRIVE.open(page)
    page.evaluate(f"() => {{ Math.random = (() => {{ let s = {SEED}; return () => (s = (s * 16807) % 2147483647) / 2147483647 }})() }}")
    trail: list[str] = []
    seen_bad: set[str] = set()
    for step in range(OPS):
        roll = rand.random()
        if roll < 0.12:
            key = rand.choice(KEYS)
            trail.append(f"{step} key {key}")
            page.keyboard.press(key)
        elif roll < 0.16:
            width = rand.choice([320, 500, 900, 1600, 2400])
            trail.append(f"{step} width {width}")
            page.set_viewport_size({"width": width, "height": rand.choice([300, 800])})
        else:
            name, code = rand.choice(ACTS)
            trail.append(f"{step} {name}")
            try:
                page.evaluate(f"() => {{ {code} }}")
            except Exception as error:  # noqa: BLE001 - every failure is the finding
                wrong(f"step {step} {name}: {str(error)[:300]}")
        page.wait_for_timeout(rand.choice([0, 0, 16, 80, 300]))
        if step % 3 == 0:
            page.wait_for_timeout(60)
            said = page.evaluate(CHECK)
            for one in said["bad"]:
                key = one.split(" ")[0] + one[-20:]
                if key in seen_bad:
                    continue
                seen_bad.add(key)
                wrong(f"step {step}: {one} (tabs {said['tabs']}, panes {said['panes']}); last: " + " | ".join(trail[-12:]))
        if step % 25 == 0:
            page.wait_for_timeout(700)
            first = page.evaluate(DOM)
            if first:
                page.wait_for_timeout(2500)
            for one in page.evaluate(DOM) if first else []:
                if one in seen_bad:
                    continue
                seen_bad.add(one)
                wrong(f"step {step}: {one}; last: " + " | ".join(trail[-12:]))
        if step % 100 == 0:
            said = page.evaluate(CHECK)
            say(f"step {step}: tabs {said['tabs']}, panes {said['panes']}, strip tabs {said['shown']}, long tasks {page.evaluate('() => window.__long.splice(0)')}")
    say(f"seed {SEED}: {OPS} steps, long tasks {page.evaluate('() => window.__long')}")
    say("trail tail " + json.dumps(trail[-10:]))


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
