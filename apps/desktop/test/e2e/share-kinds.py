"""A page note and a chat, each shared on its own by a link, to a guest (#386).

The owner keeps a page note and a chat in a space of their own, and hands each out by
an open link to write. A guest with no account follows each link. A file shared on its
own has no path on the guest's side, so what it opens as is read off its name on the
account: the page note opens on its paper, in a plane's room - a card put down on
either side is on the other's - and the chat opens as the chat, where a message posted
on either side is on the other. Both with none of the app round them, the way a guest
who came for one file sees it.

What broke: both opened as a note. The page note's JSON sat in a text editor in a room
of words the service did not agree it had, and the chat's pointer was a note to read.

The real thing: the built web app, the Worker under `wrangler dev`, three browser
contexts. Run it from the repository root:

    python apps/desktop/test/e2e/share-kinds.py
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
# How long a card or a message is given to cross to the other side.
CROSSING = 15
# How long a file made in the app is given to reach the account.
SYNCED = 60

OWNER = "owner-kinds@example.com"
SPACE = "Kinds"
DECK = "Deck.pages"
CHAT = "Talk"

wrong: list[str] = []


def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)


def wait_for(page: Page, script: str, what: str, arg: object = None, patience: float = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")


def device(browser: Browser, label: str, at: str, token: str | None = None) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp", f"[{label}] the app")
    return page


def link_to(worker: harness.Worker, token: str, space: str, note: str) -> str:
    """An open link to write in one file, as the owner's Share sheet makes it."""
    worker.request(
        f"/v1/spaces/{space}/share/link?item={note}",
        token=token,
        body={"role": "write", "mode": "open"},
        method="PUT",
    )
    link = worker.request(f"/v1/spaces/{space}/share?item={note}", token=token)
    found = re.search(r"/join/([a-f0-9]+)", link["link"]["url"])
    if not found:
        raise SystemExit(f"that is not a join link: {link}")
    return f"{ORIGIN}/join/{found.group(1)}"


def alone(page: Page, label: str) -> None:
    """That the window is the one file: none of the app's chrome is drawn."""
    chrome = page.evaluate(
        "() => [...document.querySelectorAll('[data-chrome], .strip')]"
        ".map((one) => one.dataset.chrome ?? one.className)"
    )
    if chrome:
        failed(f"[{label}] a guest with one file still sees the app round it: {chrome}")


# The surface of the plane in front: what the room hands what arrives to.
SURFACE = """() => {
  const key = window.nibApp.workspace.active?.note.key
  return key ? window.nibApp.rooms.planes.get(key) ?? null : null
}"""


def card_on(page: Page, card: str) -> bool:
    return bool(
        page.evaluate(
            f"(id) => !!({SURFACE})()?.canvas.nodes.some((node) => node.id === id)", card
        )
    )


def put_down(page: Page, label: str) -> str:
    return page.evaluate(
        """(label) => {
          const surface = (%s)()
          const id = 'card-' + label + '-' + Math.random().toString(36).slice(2, 8)
          surface.edit({ ...surface.canvas, nodes: [...surface.canvas.nodes,
            { id, type: 'text', text: 'from ' + label, x: 80, y: 120, width: 160, height: 60 }] })
          return id
        }"""
        % SURFACE,
        label,
    )


def crosses(source: Page, label: str, other: Page, there: str) -> None:
    card = put_down(source, label)
    until = time.monotonic() + CROSSING
    while time.monotonic() < until and not card_on(other, card):
        other.wait_for_timeout(100)
    if not card_on(other, card):
        failed(f"a card put down on the {label}'s pages never reached the {there}'s")
    else:
        say(f"a card put down on the {label}'s pages is on the {there}'s")


def has_row(words: str) -> str:
    return (
        "() => [...document.querySelectorAll('.chat-tab .main .message .body')]"
        f".some((one) => one.textContent.includes({json.dumps(words)}))"
    )


def post(page: Page, words: str) -> None:
    page.click(".chat-tab .main .composer .cm-content")
    page.keyboard.type(words, delay=8)
    page.keyboard.press("Enter")


def arrives(page: Page, words: str, what: str) -> None:
    try:
        wait_for(page, has_row(words), what, patience=CROSSING)
        say(f"{what}: there")
    except SystemExit as gave_up:
        failed(str(gave_up))


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
        worker.request("/v1/me", token, {"name": "Emil"}, method="PATCH")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]

        owner = device(browser, "owner", ORIGIN, token)
        root = wait_for(
            owner,
            "(id) => { const space = window.nibApp.workspace.spaces.find("
            "  (one) => window.nibApp.sync.remoteIdFor(one.root) === id);"
            " if (!space) return null; window.nibApp.workspace.showSpace(space.id); return space.root }",
            "[owner] the space",
            space["id"],
            patience=SYNCED,
        )

        # ── A page note ─────────────────────────────────────────────
        owner.evaluate(
            "async ([root, name]) => { await window.nibApp.workspace.createPages(root, name) }",
            [root, DECK],
        )
        wait_for(owner, "() => window.nibApp.workspace.active?.kind === 'pages'", "[owner] the page note")
        deck_path = owner.evaluate("() => window.nibApp.workspace.active.path")
        try:
            deck = wait_for(
                owner,
                "(path) => window.nibApp.sync.tracked(path)?.id ?? null",
                "[owner] the page note on the account",
                deck_path,
                patience=SYNCED,
            )
        except SystemExit:
            said = owner.evaluate(
                "() => ({ version: window.nibApp.sync.version, dirty: window.nibApp.workspace.active?.dirty,"
                " roots: window.nibApp.workspace.spaces.map((one) => one.root),"
                " mirrors: Object.keys(window.nibApp.sync.mirrors ?? {}) })"
            )
            say(f"[owner] {deck_path} is not on the account: {json.dumps(said)}")
            raise
        wait_for(owner, f"() => !!({SURFACE})()?.shared", "[owner] the page note in its room")
        say(f"the owner holds {deck_path} as {deck}")

        guest = device(browser, "guest", link_to(worker, token, space["id"], deck))
        wait_for(guest, "() => !!window.nibApp.workspace.active?.note.shared", "[guest] the shared tab")
        kind = guest.evaluate("() => window.nibApp.workspace.active.kind")
        if kind != "pages":
            failed(f"a page note shared on its own opened as a {kind}")
        else:
            try:
                wait_for(guest, f"() => !!({SURFACE})()?.shared", "[guest] the page note in its room")
                say("the guest is on the paper, in its room")
                crosses(owner, "owner", guest, "guest")
                crosses(guest, "guest", owner, "owner")
            except SystemExit as gave_up:
                failed(str(gave_up))
        alone(guest, "guest")
        guest.screenshot(path=str(SHOTS / "shared-pages.png"))

        # ── A chat ──────────────────────────────────────────────────
        wait_for(owner, "async () => (await window.nibApp.chats()).chats.ready", "[owner] the chats")
        owner.evaluate(
            "async ([root, name]) => { const one = await window.nibApp.chats(); await one.makeChat(root, name) }",
            [root, CHAT],
        )
        talk = wait_for(
            owner,
            "async (name) => { const { chats } = await window.nibApp.chats();"
            " const entry = chats.list.find((one) => one.name === name && one.path);"
            " return entry ? { id: entry.id, path: entry.path } : null }",
            "[owner] the chat",
            CHAT,
            patience=SYNCED,
        )
        wait_for(owner, "() => !!document.querySelector('.chat-tab .main .composer')", "[owner] the chat's tab")

        # The pointer's own row is what a private chat is shared by, once the account
        # has seen it arrive; see docs/chats.md 4.2.
        until = time.monotonic() + SYNCED
        pointer = None
        while time.monotonic() < until and not pointer:
            rows = worker.query(f"select file_id from chats where id = '{talk['id']}'")
            pointer = rows[0]["file_id"] if rows else None
            if not pointer:
                time.sleep(0.5)
        if not pointer:
            raise SystemExit("the chat's pointer never reached the account")
        say(f"the owner made {talk['id']} at {talk['path']}")

        chatter = device(browser, "chatter", link_to(worker, token, space["id"], pointer))
        wait_for(chatter, "() => !!window.nibApp.workspace.active?.note.shared", "[chatter] the shared tab")
        kind = chatter.evaluate("() => window.nibApp.workspace.active.kind")
        if kind != "channel":
            failed(f"a chat shared on its own opened as a {kind}")
        else:
            try:
                wait_for(
                    chatter,
                    "() => !!document.querySelector('.chat-tab .main .composer .cm-content')",
                    "[chatter] the chat, with somewhere to write",
                )
                post(owner, "from the owner")
                arrives(chatter, "from the owner", "the owner's message on the guest's side")
                post(chatter, "from a guest")
                arrives(owner, "from a guest", "the guest's message on the owner's side")
            except SystemExit as gave_up:
                failed(str(gave_up))
        alone(chatter, "chatter")
        chatter.screenshot(path=str(SHOTS / "shared-chat.png"))

    if wrong:
        print("\nFAILED", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\na page note and a chat shared on their own each open as themselves, and carry", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
