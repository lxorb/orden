from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
SHOTS = DRIVE.shots

def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    return page

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  if (ws.panel !== 'tree') ws.showPanel('tree')
  // As an agent or a sync writes them: past the app's own naming.
  const { writeFile } = await window.nibApp.tasks()
  await ws.noteFrom('# Plain\\n', root)
  await ws.noteFrom('# Kept\\n', root + '/Folder')
  await writeFile(root + '/AGENTS.md', '# Rules\\n')
  await writeFile(root + '/Folder/AGENTS.md', '# Nested\\n')
  await ws.loadTree()
  return root
}
"""

def new_row(page: Page, name: str) -> None:
    page.evaluate(
        "() => { const ws = window.nibApp.workspace; ws.startNaming('note', ws.activeSpace.root) }"
    )
    page.wait_for_selector(".naming input")
    page.fill(".naming input", name)

def drive(browser: Browser) -> None:
    page = fresh(browser)
    try:
        root = page.evaluate(SEED)
        agents = f"{root}/AGENTS.md"

        wait_for(
            page,
            """() => {
              const ws = window.nibApp.workspace
              return ws.tree.children.some((one) => one.name === 'AGENTS.md')
                && !ws.shownTree.children.some((one) => one.name === 'AGENTS.md')
                && !ws.notes.some((one) => one.name === 'AGENTS.md' && !one.path.includes('Folder'))
            }""",
            "the file on disk, with no row",
        )
        say("the tree shows no root AGENTS.md")

        new_row(page, "agents")
        hint = page.locator(".reason.held button")
        hint.wait_for()
        hint.evaluate(
            "(one) => Promise.all(one.closest('.reason').getAnimations().map((a) => a.finished))"
        )
        page.screenshot(path=str(SHOTS / "agents-md-hint.png"))
        field_at = page.locator(".naming input").bounding_box()
        hint_at = hint.bounding_box()
        if (
            not field_at
            or not hint_at
            or hint_at["x"] < field_at["x"]
            or hint_at["x"] + hint_at["width"] > field_at["x"] + field_at["width"]
        ):
            raise SystemExit(f"the hint is not under the name: {hint_at} and {field_at}")
        if "AGENTS" not in hint.inner_text():
            raise SystemExit(f"the hint says {hint.inner_text()!r}")
        if page.locator(".reason[aria-live=polite] button").count() != 1:
            raise SystemExit("the hint is not in a live region")
        hint.click()

        box = page.locator(".nib-setting textarea")
        box.wait_for()
        wait_for(
            page,
            "() => document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value === '# Rules\\n'",
            "the caret in the field, on the file's words",
        )
        page.screenshot(path=str(SHOTS / "agents-md-field.png"))
        say("the hint lands in the field")

        page.keyboard.press("Control+End")
        page.keyboard.type("- tea\n")
        page.keyboard.press("Escape")
        wait_for(
            page,
            f"async () => (await window.nibApp.workspace.noteText({agents!r})) === '# Rules\\n- tea\\n'",
            "the words on the disk after a quick close",
        )
        say("a quick close keeps the words")
        names = page.evaluate(
            "() => { const walk = (e) => e.children.flatMap((c) => c.is_dir ? walk(c) : [c.name]); return walk(window.nibApp.workspace.tree) }"
        )
        if names.count("AGENTS.md") != 2 or any(n.lower().startswith("agents ") for n in names):
            raise SystemExit(f"the refused name wrote something: {names}")

        new_row(page, "AGENTS")
        page.wait_for_selector(".reason.held button")
        page.keyboard.press("Tab")
        wait_for(
            page,
            "() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.closest('.reason') !== null",
            "the keyboard on the hint",
        )
        page.keyboard.press("Enter")
        wait_for(
            page,
            "() => document.activeElement?.tagName === 'TEXTAREA'",
            "the caret in the field from the keyboard",
        )
        page.keyboard.press("Escape")
        say("the keyboard reaches the hint and goes through it")

        new_row(page, "AGENTS")
        page.wait_for_selector(".reason.held button")
        page.keyboard.press("Enter")
        toast = page.locator(".toast button")
        toast.wait_for()
        toast.evaluate(
            "(one) => Promise.all(one.closest('.toast').getAnimations().map((a) => a.finished))"
        )
        page.screenshot(path=str(SHOTS / "agents-md-toast.png"))
        toast.click()
        wait_for(
            page,
            "() => document.activeElement?.tagName === 'TEXTAREA'",
            "the toast's way to the field",
        )
        page.keyboard.press("Escape")
        say("Enter refuses, and the toast goes to the field")

        page.keyboard.press("Control+o")
        page.wait_for_selector(".palette input")
        page.keyboard.type("Folder/AGENTS.md")
        page.wait_for_function("() => document.body.innerText.includes('agent instructions')")
        page.keyboard.press("Enter")
        page.locator(".nib-setting textarea").wait_for()
        page.keyboard.press("Escape")
        say("the palette's row goes to the field")

        nested = f"{root}/Folder/AGENTS.md"
        page.evaluate("(path) => window.nibApp.workspace.open(path)", nested)
        wait_for(
            page,
            f"() => window.nibApp.workspace.active?.path === {nested!r}",
            "the nested note in a tab",
        )

        page.evaluate("(path) => window.nibApp.workspace.open(path)", agents)
        page.locator(".nib-setting textarea").wait_for()
        if page.evaluate(
            f"() => window.nibApp.workspace.tabs.some((tab) => tab.path === {agents!r})"
        ):
            raise SystemExit("the root AGENTS.md opened as a tab")
        say("the root file opens as the field, and a nested one as a note")
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("AGENTS.md is a field, the name is refused, and the hint goes there")

if __name__ == "__main__":
    sys.exit(main())
