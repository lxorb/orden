from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = r"""
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  const other = await ws.addSpace('Other')
  await ws.showSpace(home.id)
  const { invoke } = await import('/src/lib/tauri.ts')
  const near = home.root + '/Near.md'
  await invoke('write_note', { path: near, content: '# Near\n\nwords\n' })
  await ws.loadTree()
  await ws.openEntry(near)
  ws.keep(ws.activeTabId)
  await ws.writesSettled()
  return other.id
}
"""

LAUNCHERS = """() => [...document.querySelectorAll('[data-pane]')]
  .filter((pane) => pane.querySelector(':scope > .here'))
  .map((pane) => Number(getComputedStyle(pane).opacity))"""

def toggle(page: Page) -> None:
    page.evaluate(
        "async () => { const { toggleTabOverview } = await import('/src/lib/surfaces.svelte.ts');"
        " toggleTabOverview() }"
    )

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 900})
    DRIVE.open(page)
    other = page.evaluate(SEED)

    toggle(page)
    page.wait_for_selector(".canvas .window", timeout=8000)
    page.wait_for_timeout(1200)
    page.evaluate("async (id) => { await window.nibApp.workspace.showSpace(id) }", other)
    wait_for(page, f"({LAUNCHERS})().length > 0", "the launcher of the space gone to")
    page.wait_for_timeout(800)
    seen = page.evaluate(LAUNCHERS)
    say(f"a launcher of a space gone to while the overview was open: opacity {seen}")
    shot(page, "launcher-came")
    if any(one > 0.05 for one in seen):
        wrong(f"a launcher of a space gone to while the overview was open shows through it: {seen}")

    toggle(page)
    wait_for(page, "!document.querySelector('.canvas .window')", "the overview away")
    page.wait_for_timeout(600)
    back = page.evaluate(LAUNCHERS)
    say(f"the overview away, the launcher: opacity {back}")
    if not back or any(one < 0.95 for one in back):
        wrong(f"the launcher is not back once the overview is away: {back}")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a launcher that comes while the overview is open stays under it"))
