from __future__ import annotations

import json

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

DISK = "async (p) => JSON.parse(await window.ordenApp.workspace.noteText(p))"
CARDS = "document.querySelectorAll('.canvas .node').length === 3"
WRITE = """async ([name, text]) => {
  const ws = window.ordenApp.workspace
  const path = `${ws.activeSpace.root.replace(/\\/+$/, '')}/${name}`
  await window.ordenApp.tasks().then((tasks) => tasks.writeFile(path, text))
  await ws.loadTree()
  await ws.openEntry(path, { activate: true })
  return path
}"""


def card(page, id):
    return page.locator(f'.canvas .node[data-id="{id}"]').first


def drive(browser: Browser) -> None:
    context = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = context.new_page()
    a.on("pageerror", lambda error: wrong(f"A: {error}"))
    DRIVE.open(a)
    wait_for(a, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    nodes = [
        {"id": f"c{i}", "type": "text", "x": i * 260, "y": 0, "width": 220, "height": 120, "text": f"Card {i}"}
        for i in range(3)
    ]
    path = a.evaluate(WRITE, ["Two.canvas", json.dumps({"nodes": nodes, "edges": []})])
    wait_for(a, CARDS, "A's cards", 20)

    b = context.new_page()
    b.on("pageerror", lambda error: wrong(f"B: {error}"))
    b.goto(a.url)
    DRIVE.ready(b)
    b.evaluate("(p) => window.ordenApp.workspace.openEntry(p, { activate: true })", path)
    wait_for(b, CARDS, "B's cards", 20)
    a.wait_for_timeout(800)

    first = card(a, "c0").bounding_box()
    a.mouse.dblclick(first["x"] + first["width"] / 2, first["y"] + first["height"] / 2)
    a.wait_for_timeout(400)
    a.keyboard.press("End")
    a.keyboard.type(" edited in A", delay=20)

    last = card(b, "c2").bounding_box()
    b.mouse.move(last["x"] + 30, last["y"] + 10)
    b.mouse.down()
    for step in range(20):
        b.mouse.move(last["x"] + 30, last["y"] + 10 + step * 10)
        b.wait_for_timeout(16)
    b.mouse.up()

    a.keyboard.type(" more", delay=20)
    a.keyboard.press("Escape")
    a.wait_for_timeout(5000)

    disk = {node["id"]: node for node in a.evaluate(DISK, path)["nodes"]}
    say(f"on disk: c0 {disk['c0']['text']!r}, c2 at y {disk['c2']['y']}")
    if disk["c0"]["text"] != "Card 0 edited in A more":
        wrong(f"A's words are not on disk: {disk['c0']['text']!r}")
    if disk["c2"]["y"] < 100:
        wrong(f"B's move is not on disk: c2 at y {disk['c2']['y']}")
    for name, page in (("A", a), ("B", b)):
        if card(page, "c2").bounding_box()["y"] < last["y"] + 100:
            wrong(f"{name} does not show B's move")
        if "more" not in (card(page, "c0").inner_text() or ""):
            wrong(f"{name} does not show A's words")
    shot(a, "two-windows")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "two windows edit one canvas read without times, and neither loses the other's edit"))
