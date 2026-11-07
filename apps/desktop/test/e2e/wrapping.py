from __future__ import annotations

import json

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
SHOTS = DRIVE.shots

NOTE = (
    "# Wrapping\n\n"
    "A paragraph that was hard wrapped in the file\n"
    "across three lines\n"
    "by whoever wrote it.\n\n"
    "A line that asks for a break  \nand the line under it.\n"
)

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const wrapped = ws.notes.find((one) => one.name.startsWith('Wrapping'))
  await ws.openEntry(wrapped.path, { activate: true })
  return wrapped.name
}
"""

def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(
        page,
        "window.orden && document.querySelector('.cm-content')"
        " && window.ordenApp.workspace.active?.note?.name?.startsWith('Wrapping')",
        "the wrapped note to be the one open",
    )
    shot(page, "01-written")

    page.keyboard.press("Control+o")
    wait_for(page, "document.activeElement?.matches('.palette input')", "the palette's field")
    page.keyboard.type("> Plain text")
    wait_for(
        page,
        "[...document.querySelectorAll('.palette [role=option]')].some((one) => one.textContent.includes('Plain text'))",
        "the palette to offer Plain text",
    )
    shot(page, "02-palette")

    with page.expect_download(timeout=20000) as caught:
        page.keyboard.press("Enter")
    download = caught.value

    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / "exported.txt"
    download.save_as(str(where))
    text = where.read_text(encoding="utf8")
    say(f"[exported] {json.dumps(text)}")

    if "A paragraph that was hard wrapped in the file across three lines by whoever wrote it." not in text:
        wrong("the wrapped paragraph did not come out as one paragraph")
    if "A line that asks for a break\nand the line under it." not in text:
        wrong("the break the writer asked for was flowed away with the rest")

    context.close()

def main() -> int:
    return DRIVE.run(drive, "a wrapped paragraph exports as a paragraph")

if __name__ == "__main__":
    raise SystemExit(main())
