"""One canvas shared by a link, drawn on from four places at once (#386).

The owner keeps a canvas in a space of their own and hands it out by an open link
to write. It is open on the owner's desktop and on their phone, both from the
tree; on a guest's browser, which followed the link and has no account; and on a
second phone of the owner's that followed the same link while signed in. A card
put down on any of the four reaches the other three's plane and is drawn there.

What broke: a file shared on its own has no path on the device that borrowed it,
and the shape of room a file wants was asked of its path - so the guest's canvas
was in a room of words, and nothing drawn on either side reached the other. The
owner following their own link landed in that same borrowed tab, read-only. Both
are told apart from a card that arrived and is only out of view: the plane holds
it (the data came), and panning to it draws it.

The real thing: the built web app, the Worker under `wrangler dev`, four browser
contexts, two of them phones. `--v1` runs the owner's account on sync v1 instead
of v2. Run it from the repository root:

    python apps/desktop/test/e2e/share-canvas-sync.py
"""

from __future__ import annotations

import json
import re
import sys
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()
PATIENCE = 40
# How long a card is given to cross to another device.
CROSSING = 15

OWNER = "owner-canvas@example.com"
SPACE = "Boards"
CANVAS = "board.canvas"
BLANK = '{"nib":{"version":1},"nodes":[],"edges":[]}'
PHONE = {"width": 390, "height": 844}
V1 = "--v1" in sys.argv

wrong: list[str] = []


def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)


def wait_for(page: Page, script: str, what: str, patience: float = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")


def device(browser: Browser, label: str, at: str, token: str | None = None, phone: bool = False) -> Page:
    """A browser context of its own: a desktop, or a phone with a touch screen."""
    options: dict = {"viewport": PHONE if phone else {"width": 1180, "height": 760}}
    if phone:
        options.update(is_mobile=True, has_touch=True, device_scale_factor=2)
    context = browser.new_context(**options)
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp", f"[{label}] the app")
    return page


# The surface of the canvas in front: what the room hands what arrives to.
SURFACE = """() => {
  const key = window.nibApp.workspace.active?.note.key
  return key ? window.nibApp.rooms.planes.get(key) ?? null : null
}"""


def in_its_room(page: Page, label: str) -> None:
    """Waits for the canvas in front to be in its room: the surface handed the room,
    which is what every edit on it goes out through."""
    wait_for(
        page,
        f"() => window.nibApp.workspace.active?.kind === 'canvas' && !!({SURFACE})()",
        f"[{label}] the canvas",
    )
    try:
        wait_for(page, f"() => !!({SURFACE})()?.shared", f"[{label}] the canvas in its room")
    except SystemExit as gave_up:
        failed(str(gave_up))


def from_the_tree(page: Page, label: str) -> None:
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space",
    )
    page.evaluate(
        "async (name) => { const ws = window.nibApp.workspace;"
        " const space = ws.spaces.find((one) => one.name === name); await ws.showSpace(space.id) }",
        SPACE,
    )
    path = f"/{SPACE}/{CANVAS}"
    wait_for(
        page,
        "() => { const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
        f" return walk(window.nibApp.workspace.tree).includes({json.dumps(path)}) }}",
        f"[{label}] the canvas in the tree",
    )
    page.evaluate(f"async () => {{ await window.nibApp.workspace.openCanvas({json.dumps(path)}) }}")
    in_its_room(page, label)


def put_down(page: Page, label: str, x: int, y: int) -> str:
    """A card, put down as one edit on the surface, as a gesture ends in one."""
    return page.evaluate(
        """([label, x, y]) => {
          const surface = (%s)()
          const id = 'card-' + label + '-' + Math.random().toString(36).slice(2, 8)
          surface.edit({ ...surface.canvas, nodes: [...surface.canvas.nodes,
            { id, type: 'text', text: 'from ' + label, x, y, width: 160, height: 60 }] })
          return id
        }"""
        % SURFACE,
        [label, x, y],
    )


def seen(page: Page, card: str) -> dict:
    """Whether a card is on this device's plane (the data came) and drawn (the
    surface put it on screen). A card out of view is on the plane and not drawn: a
    canvas draws only the cards in view."""
    return page.evaluate(
        """(id) => {
          const surface = (%s)()
          return { plane: !!surface?.canvas.nodes.some((node) => node.id === id),
            drawn: !!document.querySelector(`[data-id="${id}"]`) }
        }"""
        % SURFACE,
        card,
    )


def crosses(source: str, card: str, devices: dict[str, Page], drawn: bool = True) -> None:
    for label, page in devices.items():
        if label == source:
            continue
        until = time.monotonic() + CROSSING
        found = seen(page, card)
        while time.monotonic() < until and not (found["plane"] and (found["drawn"] or not drawn)):
            page.wait_for_timeout(100)
            found = seen(page, card)
        if not found["plane"]:
            failed(f"what {source} put down never reached {label}")
        elif drawn and not found["drawn"]:
            failed(f"what {source} put down reached {label} and was not drawn")


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ]
    ) as browser:
        worker.start()
        token = worker.account(OWNER)
        if not V1:
            worker.sql(f"update users set sync_version = 2 where email = '{OWNER}'")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        board = worker.request(
            f"/v1/spaces/{space['id']}/notes", token=token, body={"path": CANVAS, "content": BLANK}
        )["note"]
        say(f"the owner, on sync v{1 if V1 else 2}, holds {SPACE}/{CANVAS}")

        desk = device(browser, "desk", ORIGIN, token)
        from_the_tree(desk, "desk")

        worker.request(
            f"/v1/spaces/{space['id']}/share/link?item={board['id']}",
            token=token,
            body={"role": "write", "mode": "open"},
            method="PUT",
        )
        link = worker.request(f"/v1/spaces/{space['id']}/share?item={board['id']}", token=token)
        found = re.search(r"/join/([a-f0-9]+)", link["link"]["url"])
        if not found:
            raise SystemExit(f"that is not a join link: {link}")
        joining = f"{ORIGIN}/join/{found.group(1)}"

        guest = device(browser, "guest", joining)
        wait_for(guest, "() => !!window.nibApp.workspace.active?.note.shared", "[guest] the shared tab")
        in_its_room(guest, "guest")

        phone = device(browser, "phone", ORIGIN, token, phone=True)
        from_the_tree(phone, "phone")

        # The owner following their own link on another phone, signed in: their own
        # file, where they keep it, rather than a borrowed tab.
        linked = device(browser, "linked", joining, token, phone=True)
        in_its_room(linked, "linked")
        if linked.evaluate("() => window.nibApp.workspace.active?.note.shared"):
            failed("the owner's own link opened their canvas as somebody else's")
        say("four devices are on the plane: a desktop, a guest's browser and two phones")

        devices = {"desk": desk, "phone": phone, "guest": guest, "linked": linked}
        # Every card where every screen has it in view, so drawn means drawn.
        for turn, label in enumerate(("phone", "desk", "guest", "linked", "phone")):
            crosses(label, put_down(devices[label], label, -60, -120 + turn * 70), devices)
        say("a card put down anywhere is on every other plane, drawn")

        # And one far out of view: it arrives as data, and is drawn once looked at.
        far = put_down(phone, "phone", 6000, 6000)
        crosses("phone", far, devices, drawn=False)
        desk.evaluate(f"() => {{ ({SURFACE})().camera = {{ x: 6080, y: 6030, scale: 1 }} }}")
        try:
            drawn = f"() => !!document.querySelector('[data-id=\"{far}\"]')"
            wait_for(desk, drawn, "[desk] the far card drawn", 10)
            say("a card out of view is on the plane, and drawn once the desk looks at it")
        except SystemExit as gave_up:
            failed(str(gave_up))

        for label, page in devices.items():
            page.screenshot(path=str(SHOTS / f"{label}.png"))

    if wrong:
        print("\nFAILED", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\na shared canvas carries every card to every device, the guest's and the phones'", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
