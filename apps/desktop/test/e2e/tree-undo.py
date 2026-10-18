"""Ctrl+Z after something done in the file list, and Ctrl+Shift+Z and Ctrl+Y after that.

#399: a note deleted from the sidebar could not be had back with Ctrl+Z. The list
answered the key only while a row held the keyboard, and the row that was deleted
took the keyboard with it. This deletes a note inside a folder, a whole folder and a
selection of two, renames a note, moves one into a folder and makes a new one, each
from the list as somebody would, and after each presses Ctrl+Z with the keyboard
wherever the app left it: the thing is back where it was, folder and all. Then it is
done again with the redo keys, and taken back once more. A selection is one press.

And the note keeps its own undo: words typed into it and Ctrl+Z take the words back
and leave the file list alone.

Run it from the repository root:

    python apps/desktop/test/e2e/tree-undo.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import json
import re

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 40

# A note at the top of the space and a folder of two, which is a plain folder: no
# note in it has the folder's name, so nothing nests or unnests along the way.
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

# Every file the tree holds, as paths under the space, folders ending in a slash.
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

# And the note every new space starts with, which nothing here touches.
START = ["Plan.md", "Read me.md", "Work/", "Work/Goal.md", "Work/Ideas.md"]


def but(*gone: str, also: tuple[str, ...] = ()) -> list[str]:
    """The seeded space without `gone`, and with `also`."""
    return [one for one in START if one not in gone] + list(also)


def files(page: Page) -> list[str]:
    return page.evaluate(FILES)


def until(page: Page, want: list[str], what: str) -> bool:
    """Until the tree holds exactly `want`; a miss is counted, and says what it holds."""
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
    """Presses one entry of the menu that is open, by the words on it, and only those:
    Move is not Move up."""
    item = page.locator(".menu .nib-row", has_text=re.compile(rf"^\s*{re.escape(label)}\s*$")).first
    item.wait_for(state="visible", timeout=PATIENCE * 1000)
    item.click()


def keys(page: Page, chord: str, what: str) -> None:
    """A chord pressed with the keyboard wherever the app left it, said with where."""
    held = page.evaluate(
        "() => { const el = document.activeElement; return el ? el.tagName.toLowerCase()"
        " + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') : 'nothing' }"
    )
    say(f"{what}: {chord} with the keyboard on {held}")
    page.keyboard.press(chord)


MARK = "() => { window.__undoMark = window.nibApp.workspace.undone.last }"
MOVED = "() => window.nibApp.workspace.undone.last !== window.__undoMark"


def marked(page: Page) -> None:
    """The step on top of the undo stack now, so `recorded` can tell a new one."""
    page.evaluate(MARK)


def recorded(page: Page, what: str) -> None:
    """Until what was just done is on the stack: the row goes at once, and the step a
    moment later, once the disk has answered."""
    wait_for(page, MOVED, f"{what} on the undo stack", PATIENCE)


def step(page: Page, chord: str, want: list[str], what: str) -> None:
    """One chord, and the tree it should leave once the step it took has landed."""
    marked(page)
    keys(page, chord, what)
    until(page, want, what)
    recorded(page, what)


def back_and_forth(page: Page, before: list[str], after: list[str], what: str) -> None:
    """Undo, then both redo keys and an undo after each: before, after, before."""
    recorded(page, what)
    step(page, "Control+z", before, f"{what}, undone")
    step(page, "Control+Shift+z", after, f"{what}, done again with Ctrl+Shift+Z")
    step(page, "Control+z", before, f"{what}, undone again")
    step(page, "Control+y", after, f"{what}, done again with Ctrl+Y")
    step(page, "Control+z", before, f"{what}, undone at last")


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    page = context.new_page()
    # The cards that point at the palette and the graph sit over the list's top rows.
    page.add_init_script(
        "try { localStorage.setItem('nib:hints', JSON.stringify(['sign-in', 'graph', 'palette'])) } catch {}"
    )
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        say(f"the space is {page.evaluate(SEED)}")
        until(page, START, "the seeded space")
        wait_for(page, "() => !!document.querySelector('aside .row')", "the file list")

        # A note inside a folder, from its row's menu: no question, it simply goes.
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

        # The whole folder: its menu asks first, and both notes go and come back.
        marked(page)
        row(page, "Work").click(button="right")
        entry(page, "Delete")
        page.locator('[role="dialog"] button', has_text="Delete").last.click()
        folder = but("Work/", "Work/Goal.md", "Work/Ideas.md")
        until(page, folder, "a folder deleted")
        back_and_forth(page, START, folder, "a folder deleted")

        # Renamed in its row's field.
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

        # Moved into the folder, through Move to.
        marked(page)
        row(page, "Plan.md").click(button="right")
        entry(page, "Move")
        picker = page.locator('[role="dialog"] input').first
        picker.wait_for(state="visible", timeout=PATIENCE * 1000)
        picker.fill("Work")
        page.wait_for_timeout(200)
        picker.press("Enter")
        moved = but("Plan.md", also=("Work/Plan.md",))
        until(page, moved, "a note moved")
        back_and_forth(page, START, moved, "a note moved")

        # Two picked, the second with Alt, and deleted with the key: one press of Ctrl+Z
        # takes back both.
        marked(page)
        row(page, "Plan.md").click()
        row(page, "Work/Ideas.md").click(modifiers=["Alt"])
        # The click opened Plan, whose note took the keyboard; Delete is the list's.
        row(page, "Work/Ideas.md").focus()
        page.keyboard.press("Delete")
        two = but("Plan.md", "Work/Ideas.md")
        until(page, two, "two deleted at once")
        recorded(page, "two deleted at once")
        step(page, "Control+z", START, "two deleted at once, undone with one press")

        # Made new from the empty stretch: the note opens with the keyboard in it,
        # and has nothing of its own to undo yet.
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

        # The note's own undo is the note's: typed words go, and no file comes back.
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
