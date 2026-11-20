import json
import os
from harness import Drive
DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong
STATE = r"""
async () => {
  const ws = window.ordenApp.workspace
  const links = window.ordenApp.links
  const root = ws.activeSpace.root.replace(/\/$/, '')
  const { invoke } = await import('/src/lib/platform/src/api.ts')
  await new Promise((go) => setTimeout(go, 2000))
  await ws.loadTree()
  const walk = (entry) => entry.children.flatMap((one) => one.is_dir ? walk(one) : [one.path.slice(root.length + 1)])
  const files = walk(ws.tree).sort()
  const out = {}
  for (const f of files) if (f.endsWith('.md') && f !== 'Read me.md') out[f] = await invoke('read_note', { path: root + '/' + f }).catch(() => null)
  const held = links.held().map((n) => n.path).sort()
  return { files, out, held, active: ws.active?.path?.slice(root.length + 1) ?? null, shown: ws.active?.note?.text ?? null, undo: ws.undoLabel }
}
"""
SELECT = os.environ.get("SELECT") == "1"
def retitle(page, name, keys, leave="ArrowDown"):
    DRIVE.open_note(page, name)
    line = page.locator(".cm-line").first
    line.click()
    page.keyboard.press("End")
    for _ in range(len(name)):
        page.keyboard.press("Shift+ArrowLeft" if SELECT else "Backspace")
    page.keyboard.type(keys)
    if leave:
        page.keyboard.press(leave)
        page.keyboard.press("End")
        page.keyboard.type(" body")
def drive(browser):
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    page.evaluate("""async () => {
      const ws = window.ordenApp.workspace
      const root = ws.activeSpace.root.replace(/\\/$/, '')
      await ws.noteFrom('# Plan\\n\\nplan words\\n', root)
      await ws.noteFrom('# Odd\\n\\nodd words\\n', root)
      await ws.noteFrom('# Shut\\n\\nshut words\\n', root)
      await ws.noteFrom('# Alpha\\n\\n[[Plan]] [[Odd]] [[Shut]] [p](Plan.md)\\n', root)
      await ws.loadTree()
    }""")
    retitle(page, "Plan", "Roadmap")
    got = page.evaluate(STATE)
    say("plain " + json.dumps(got))
    if "Roadmap.md" not in got["files"] or "[[Roadmap]]" not in (got["out"].get("Alpha.md") or ""):
        wrong(f"a typed title did not rename the note or its links: {got['files']} {got['out'].get('Alpha.md')!r}")
    if " body" not in (got["out"].get("Roadmap.md") or ""):
        wrong(f"words typed after the title were lost: {got['out']}")
    if got["held"].count("Roadmap.md") != 1:
        wrong(f"the index holds {got['held']}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    page.keyboard.press("ArrowDown")
    got = page.evaluate(STATE)
    say("editor undo " + json.dumps(got))
    retitle(page, "Odd", "Q3: plan/review?")
    got = page.evaluate(STATE)
    say("odd " + json.dumps(got))
    retitle(page, "Shut", "Closed now", leave=None)
    page.evaluate("() => { const ws = window.ordenApp.workspace; const tab = ws.tabs.find((one) => one.id === ws.activeTabId); ws.close(tab.id) }")
    got = page.evaluate(STATE)
    say("closed " + json.dumps(got))
    if "Closed now.md" not in got["files"]:
        wrong(f"a title typed and the tab closed at once did not rename: {got['files']}")
raise SystemExit(DRIVE.run(drive))
