
from __future__ import annotations

import json

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__, dev=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

AGENT = "{ id: 'nib-moved', name: 'Fake' }"
DOCS = "await import('/src/lib/agents/docs/index.ts')"
TOUCHED = "await import('/src/lib/agents/docs/touched.ts')"


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    DRIVE.seed(page, "# Heron\n\nA heron strikes fast.\n")
    DRIVE.open_note(page, "Heron")
    page.evaluate(
        f"async () => {{ const docs = {DOCS}; await docs.notes.editNote({AGENT}, {{ path: 'Heron.md' }}, [{{ at: {{ quote: 'strikes' }}, replace: 'STRIKES' }}]) }}"
    )
    page.evaluate("async (root) => window.nibApp.workspace.rename(root + '/Heron.md', 'Bird.md')", root)
    wait_for(page, "window.nibApp.workspace.active?.path?.endsWith('Bird.md')", "the new name")

    tracked = page.evaluate(f"async () => [...({DOCS}).tracksOf('nib-moved').keys()]")
    who = page.evaluate(f"async (path) => ({TOUCHED}).touchedBy(path).map((one) => one.id)", f"{root}/Bird.md")
    say(f"tracks {json.dumps(tracked)}, touched {who}")
    if tracked != [f"{root}/Bird.md"]:
        wrong(f"the track did not follow the note: {tracked}")
    if who != ["nib-moved"]:
        wrong(f"the palette's row did not follow the note: {who}")

    undone = page.evaluate(
        f"async (path) => ({DOCS}).undoAgentIn({AGENT}, path)", f"{root}/Bird.md"
    )
    words = page.evaluate("() => window.nibApp.workspace.active.note.latest")
    say(f"undone {undone}, words {json.dumps(words)}")
    if undone != {"undone": 1} or "strikes" not in words:
        wrong(f"the edit stayed: {undone}, {words!r}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
