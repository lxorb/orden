"""The overview across spaces, by a real mouse on the web build.

A window dragged onto another space's cell and Ctrl+Z: the file and the tab come back
together. A drop refused for a name already there says so and the window does not stay
parked among the other space's. The camera left on one space does not open on nothing in
the next. A tab closed in another space comes back in that space.

    CHOKIDAR_USEPOLLING=1 python apps/desktop/test/e2e/overview-spaces.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = r"""
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  const bee = await ws.addSpace('Bee')
  await ws.showSpace(home.id)
  const { invoke } = await import('/src/lib/tauri.ts')
  const put = async (root, name) => {
    const path = root + '/' + name + '.md'
    await invoke('write_note', { path, content: '# ' + name + '\n\nwords\n' })
    await ws.loadTree()
    await ws.openEntry(path)
    ws.keep(ws.activeTabId)
    await ws.writesSettled()
  }
  await put(home.root, 'A1')
  await put(home.root, 'A2')
  await ws.showSpace(bee.id)
  await put(bee.root, 'B1')
  await put(bee.root, 'B2')
  await ws.showSpace(home.id)
  return { home: home.id, bee: bee.id, homeRoot: home.root, beeRoot: bee.root }
}
"""

TAB = """(name) => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => one.shown === name)
  return tab ? { path: tab.path, here: !!ws.panes.at(tab.paneId) } : null
}"""


def tab(page: Page, name: str) -> dict:
    return page.evaluate(TAB, name)


def open_overview(page: Page) -> None:
    page.evaluate(
        "async () => { const { toggleTabOverview } = await import('/src/lib/surfaces.svelte.ts');"
        " toggleTabOverview() }"
    )
    page.wait_for_selector(".canvas .window", timeout=8000)
    page.wait_for_timeout(1200)


def close_overview(page: Page) -> None:
    page.evaluate(
        "async () => { const { tabOverview } = await import('/src/lib/surfaces.svelte.ts');"
        " tabOverview.open = false }"
    )
    wait_for(page, "!document.querySelector('.canvas .window')", "the overview away")


def box(page: Page, name: str) -> dict | None:
    return page.evaluate(
        """(name) => {
          const one = [...document.querySelectorAll('.canvas .window')]
            .find((node) => node.getAttribute('aria-label') === name)
          if (!one) return null
          const r = one.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }""",
        name,
    )


def on_screen(page: Page) -> list[str]:
    return page.evaluate(
        """() => [...document.querySelectorAll('.canvas .window')].filter((one) => {
          const r = one.getBoundingClientRect()
          return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
        }).map((one) => one.getAttribute('aria-label'))"""
    )


def drag(page: Page, start: dict, end: dict) -> None:
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    for step in range(1, 21):
        page.mouse.move(
            start["x"] + (end["x"] - start["x"]) * step / 20,
            start["y"] + (end["y"] - start["y"]) * step / 20,
        )
        page.wait_for_timeout(16)
    page.wait_for_timeout(200)
    page.mouse.up()
    page.wait_for_timeout(1000)


def all_spaces(page: Page) -> None:
    page.get_by_role("button", name="Tidy up").click()
    page.wait_for_timeout(1200)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 900})
    DRIVE.open(page)
    ids = page.evaluate(SEED)

    # A window carried to the other space, and Ctrl+Z.
    open_overview(page)
    all_spaces(page)
    drag(page, box(page, "A2"), box(page, "B2"))
    if tab(page, "A2")["here"] or not tab(page, "A2")["path"].startswith(ids["beeRoot"]):
        wrong(f"the drag did not move the tab and its file: {tab(page, 'A2')}")
    close_overview(page)
    page.evaluate("async () => { await window.nibApp.workspace.undoFileAction() }")
    moved = tab(page, "A2")
    say(f"undone: {moved}")
    if not moved["path"].startswith(ids["homeRoot"]) or not moved["here"]:
        wrong(f"undone, the file and its tab are not back together: {moved}")
    page.evaluate("async () => { await window.nibApp.workspace.redoFileAction() }")
    moved = tab(page, "A2")
    say(f"redone: {moved}")
    if not moved["path"].startswith(ids["beeRoot"]) or moved["here"]:
        wrong(f"redone, the file and its tab did not go together: {moved}")
    page.evaluate("async () => { await window.nibApp.workspace.undoFileAction() }")

    # A drop onto a name that is taken there.
    page.evaluate(
        """async (root) => {
          const { invoke } = await import('/src/lib/tauri.ts')
          await invoke('write_note', { path: root + '/A2.md', content: '# theirs\\n' })
        }""",
        ids["beeRoot"],
    )
    open_overview(page)
    all_spaces(page)
    before = box(page, "A2")
    drag(page, before, box(page, "B2"))
    told = page.locator("text=Not moved").count()
    after = box(page, "A2")
    say(f"refused: told {told}, window from {before} to {after}")
    shot(page, "refused")
    if not told:
        wrong("a drop refused says nothing")
    if abs(after["x"] - before["x"]) > 8 or abs(after["y"] - before["y"]) > 8:
        wrong(f"a refused window stays parked in the other cell: {before} to {after}")
    if not tab(page, "A2")["here"]:
        wrong("a refused window's tab left")
    close_overview(page)
    page.evaluate(
        """async (root) => {
          const { invoke } = await import('/src/lib/tauri.ts')
          await invoke('delete_note', { path: root + '/A2.md' }).catch(() => undefined)
        }""",
        ids["beeRoot"],
    )

    # The camera left on this space, and the other one's windows.
    open_overview(page)
    page.get_by_role("combobox", name="Spaces").click()
    page.get_by_role("option", name="This space").click()
    page.wait_for_timeout(600)
    close_overview(page)
    page.evaluate("async (id) => { await window.nibApp.workspace.showSpace(id) }", ids["bee"])
    page.wait_for_timeout(400)
    open_overview(page)
    visible = on_screen(page)
    say(f"in Bee the overview shows {visible}")
    shot(page, "other-space")
    if "B1" not in visible and "B2" not in visible:
        wrong(f"the overview opened on nothing of the space worked in: {visible}")
    close_overview(page)

    # Closed here, reopened from the other space.
    page.evaluate(
        """async ([id, home]) => {
          const ws = window.nibApp.workspace
          ws.close(ws.tabs.find((one) => one.shown === 'B1').id)
          await ws.showSpace(home)
          await ws.reopenClosed()
        }""",
        [ids["bee"], ids["home"]],
    )
    space = page.evaluate("() => window.nibApp.workspace.activeSpaceId")
    back = tab(page, "B1")
    say(f"reopened: {back} in {space}")
    if space != ids["bee"] or not back or not back["here"]:
        wrong(f"a tab closed in Bee did not come back in Bee: {back} in {space}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
