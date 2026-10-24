"""A canvas from somebody's Obsidian vault, edited in Orden, keeps what Orden does not read
(#780).

The vault's canvas holds a node of a plugin's own type (`excalidraw`), the edge to it, a
field Advanced Canvas keeps on a card (`styleAttributes`) and a key beside the lists
(`metadata`). A card put down on it with a double press used to write the file back
without all four. What this does, on the built web app:

    the canvas opened, and a card put down with a double press on the plane
    the file read back: the plugin's node, its edge, the card's field and the key are
    there, beside the new card

Run it from the repository root:

    python apps/desktop/test/e2e/canvas-extras.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

VAULT = {
    "nodes": [
        {"id": "x", "type": "excalidraw", "x": -400, "y": -100, "width": 200, "height": 100, "file": "D.excalidraw"},
        {
            "id": "a",
            "type": "text",
            "text": "From Obsidian",
            "x": -100,
            "y": -100,
            "width": 220,
            "height": 60,
            "styleAttributes": {"shape": "pill"},
        },
    ],
    "edges": [{"id": "e", "fromNode": "x", "toNode": "a"}],
    "metadata": {"version": "1.0-1.0", "frontmatter": {}},
}

SEED = """
async (text) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const path = `${root}/Vault board.canvas`
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const now = Date.now()
  await new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    change.objectStore('files').put({ path, content: text, modified: now, created: now })
    change.objectStore('stats').put({ path, modified: now, created: now })
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
  db.close()
  await ws.loadTree()
  await ws.openEntry(path, { activate: true })
  return path
}
"""

# The file as the store holds it now.
READ = """
async (path) => {
  await window.nibApp.workspace.writeNow?.()
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve) => { open.onsuccess = () => resolve(open.result) })
  const row = await new Promise((resolve) => {
    const asked = db.transaction('files').objectStore('files').get(path)
    asked.onsuccess = () => resolve(asked.result ?? null)
  })
  db.close()
  return row ? row.content : null
}
"""


def file_of(page: Page, path: str) -> dict:
    text = page.evaluate(READ, path)
    return json.loads(text) if text else {}


def kept(found: dict, what: str, cards: list[str]) -> None:
    ids = sorted(one.get("id") for one in found.get("nodes", []))
    say(f"[{what}] nodes {ids}, edges {[one.get('id') for one in found.get('edges', [])]}")
    if "x" not in ids:
        wrong(f"[{what}] the plugin's node is gone from the file")
    if found.get("metadata") != VAULT["metadata"]:
        wrong(f"[{what}] the file's metadata is gone: {found.get('metadata')}")
    for card in cards:
        if card not in ids:
            wrong(f"[{what}] the card {card} is not in the file")


def drive(browser: Browser) -> None:
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", "a space")
    path = page.evaluate(SEED, json.dumps(VAULT, indent="\t") + "\n")
    wait_for(page, "() => !!document.querySelector('.canvas')", "the canvas")
    page.wait_for_timeout(600)

    # A card, put down the way a reader puts one down: a double press on the plane.
    box = page.locator(".canvas").bounding_box()
    if not box:
        raise SystemExit("the plane is not on screen")
    page.mouse.dblclick(box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.7)
    page.wait_for_timeout(400)
    page.keyboard.type("New card")
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)

    after = file_of(page, path)
    new_cards = [one["id"] for one in after.get("nodes", []) if one.get("id") not in ("x", "a")]
    if not new_cards:
        wrong("the double press put no card down")
    kept(after, "after the card", ["a", *new_cards])
    card = next((one for one in after.get("nodes", []) if one.get("id") == "a"), {})
    if card.get("styleAttributes") != {"shape": "pill"}:
        wrong(f"the card's own field is gone: {card}")
    if [one.get("id") for one in after.get("edges", [])] != ["e"]:
        wrong(f"the edge to the plugin's node is gone: {after.get('edges')}")
    DRIVE.shot(page, "01-a-card-down")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "an Obsidian canvas edited here keeps what this app does not read"))
