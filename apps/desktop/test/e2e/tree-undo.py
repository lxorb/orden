from __future__ import annotations

import json
import re

from playwright.sync_api import Browser, Page

from harness import WEBKIT, Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 40

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.noteFrom('# Plan\\n\\nthe plan\\n', root)
  await ws.noteFrom('# Goal\\n\\nthe goal\\n', at('Work'))
  await ws.noteFrom('# Ideas\\n\\nsome ideas\\n', at('Work'))
  ws.device.expand(at('Work'))
  return root
}
"""

FILES = """
() => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/\\/$/, '')
  const walk = (entry) => entry.children.flatMap((one) => {
    const at = one.path.slice(root.length + 1)
    return one.is_dir ? [at + '/', ...walk(one)] : [at]
  })
  return walk(ws.tree).sort()
}
"""

START = ["Plan.md", "Read me.md", "Work/", "Work/Goal.md", "Work/Ideas.md"]

def but(*gone: str, also: tuple[str, ...] = ()) -> list[str]:
    return [one for one in START if one not in gone] + list(also)

def files(page: Page) -> list[str]:
    return page.evaluate(FILES)

def until(page: Page, want: list[str], what: str) -> bool:
    want = sorted(want)
    try:
        wait_for(page, f"() => JSON.stringify(({FILES})()) === {json.dumps(json.dumps(want, separators=(",", ":")))}", what, PATIENCE)
        return True
    except BaseException:
        wrong(f"{what}: the tree holds {files(page)}, not {want}")
        return False

def row(page: Page, at: str):
    return page.locator(f"aside .row[data-path$='/{at}']").first

def entry(page: Page, label: str) -> None:
    item = page.locator(".menu .nib-row", has_text=re.compile(rf"^\s*{re.escape(label)}\s*$")).first
    item.wait_for(state="visible", timeout=PATIENCE * 1000)
    item.click()

def keys(page: Page, chord: str, what: str) -> None:
    held = page.evaluate(
        "() => { const el = document.activeElement; return el ? el.tagName.toLowerCase()"
        " + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') : 'nothing' }"
    )
    say(f"{what}: {chord} with the keyboard on {held}")
    page.keyboard.press(chord)

MARK = "() => { window.__undoMark = window.nibApp.workspace.undone.last }"
MOVED = "() => window.nibApp.workspace.undone.last !== window.__undoMark"

def marked(page: Page) -> None:
    page.evaluate(MARK)

def recorded(page: Page, what: str) -> None:
    wait_for(page, MOVED, f"{what} on the undo stack", PATIENCE)

def step(page: Page, chord: str, want: list[str], what: str) -> None:
    marked(page)
    keys(page, chord, what)
    until(page, want, what)
    recorded(page, what)

def back_and_forth(page: Page, before: list[str], after: list[str], what: str) -> None:
    recorded(page, what)
    step(page, "Control+z", before, f"{what}, undone")
    step(page, "Control+Shift+z", after, f"{what}, done again with Ctrl+Shift+Z")
    step(page, "Control+z", before, f"{what}, undone again")
    step(page, "Control+y", after, f"{what}, done again with Ctrl+Y")
    step(page, "Control+z", before, f"{what}, undone at last")

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    page = context.new_page()
    page.add_init_script(
        "try { localStorage.setItem('orden:hints', JSON.stringify(['graph', 'palette'])) } catch {}"
    )
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        say(f"the space is {page.evaluate(SEED)}")
        until(page, START, "the seeded space")
        wait_for(page, "() => !!document.querySelector('aside .row')", "the file list")

        marked(page)
        row(page, "Work/Goal.md").click(button="right")
        entry(page, "Delete")
        gone = but("Work/Goal.md")
        until(page, gone, "a note deleted")
        back_and_forth(page, START, gone, "a note deleted")
        words = page.evaluate(
            """async () => {
              const ws = window.nibApp.workspace
              const at = ws.tree.children.find((one) => one.name === 'Work')
                ?.children.find((one) => one.name === 'Goal.md')?.path
              return at ? await ws.readNoteText?.(at) ?? at : null
            }"""
        )
        say(f"the note back is {words}")

        marked(page)
        row(page, "Work").click(button="right")
        entry(page, "Delete")
        page.locator('[role="dialog"] button', has_text="Delete").last.click()
        folder = but("Work/", "Work/Goal.md", "Work/Ideas.md")
        until(page, folder, "a folder deleted")
        back_and_forth(page, START, folder, "a folder deleted")

        marked(page)
        row(page, "Plan.md").click(button="right")
        entry(page, "Rename")
        field = page.locator("aside .row .naming input")
        field.wait_for(state="visible", timeout=PATIENCE * 1000)
        field.fill("Roadmap")
        field.press("Enter")
        renamed = but("Plan.md", also=("Roadmap.md",))
        until(page, renamed, "a note renamed")
        back_and_forth(page, START, renamed, "a note renamed")

        marked(page)
        row(page, "Plan.md").click()
        wait_for(page, "() => !!window.nibApp.workspace.active?.path?.endsWith('/Plan.md')", "Plan open")
        row(page, "Plan.md").focus()
        page.keyboard.press("Control+Shift+KeyP")
        page.wait_for_selector(".palette input")
        page.keyboard.type("Move this note")
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        picker = page.locator('.sheet[role="dialog"] input').first
        picker.wait_for(state="visible", timeout=PATIENCE * 1000)
        picker.fill("Work")
        page.wait_for_timeout(200)
        picker.press("Enter")
        moved = but("Plan.md", also=("Work/Plan.md",))
        until(page, moved, "a note moved")
        back_and_forth(page, START, moved, "a note moved")

        marked(page)
        row(page, "Plan.md").click()
        page.evaluate("() => window.nibApp.workspace.device.expand(window.nibApp.workspace.activeSpace.root.replace(/\\/$/, '') + '/Work')")
        row(page, "Work/Ideas.md").click(modifiers=["Alt"])
        row(page, "Work/Ideas.md").focus()
        page.keyboard.press("Meta+Backspace" if WEBKIT else "Delete")
        two = but("Plan.md", "Work/Ideas.md")
        until(page, two, "two deleted at once")
        recorded(page, "two deleted at once")
        step(page, "Control+z", START, "two deleted at once, undone with one press")

        marked(page)
        page.locator("aside .rest").click(button="right", position={"x": 20, "y": 8})
        entry(page, "New note")
        field = page.locator("aside .row .naming input")
        field.wait_for(state="visible", timeout=PATIENCE * 1000)
        page.wait_for_timeout(400)
        field.fill("Fresh")
        field.press("Enter")
        made = ["Fresh.md", *START]
        until(page, made, "a note made")
        page.wait_for_timeout(300)
        back_and_forth(page, START, made, "a note made")

        row(page, "Plan.md").click()
        editor = page.locator(".cm-content").first
        editor.wait_for(state="visible", timeout=PATIENCE * 1000)
        editor.click()
        page.keyboard.press("Control+End")
        page.keyboard.type(" and more")
        wait_for(
            page,
            "() => document.querySelector('.cm-content')?.textContent.includes('and more')",
            "the typed words",
        )
        steps = page.evaluate("() => window.nibApp.workspace.undone.stack.length")
        keys(page, "Control+z", "words typed in the note, undone")
        try:
            wait_for(
                page,
                "() => !document.querySelector('.cm-content')?.textContent.includes('and more')",
                "the typed words taken back",
            )
        except BaseException:
            wrong("Ctrl+Z in the note did not take its typed words back")
        page.wait_for_timeout(300)
        if page.evaluate("() => window.nibApp.workspace.undone.stack.length") != steps:
            wrong("Ctrl+Z in the note took a file action back as well")
        until(page, START, "the tree after the note's own undo")
        DRIVE.shot(page, "tree-undo")
    finally:
        context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the file list's undo and redo take back and do again what was done in it"))
