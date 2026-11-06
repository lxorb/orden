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
CROSSING = 15
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
    chrome = page.evaluate(
        "() => [...document.querySelectorAll('[data-chrome], .strip')]"
        ".map((one) => one.dataset.chrome ?? one.className)"
    )
    if chrome:
        failed(f"[{label}] a guest with one file still sees the app round it: {chrome}")

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

def held_and_gone_to(owner: Page, guest: Page) -> None:
    box = owner.locator(".pages").first.bounding_box()
    if not box:
        failed("the owner's pages are not on screen")
        return
    for step in range(6):
        owner.mouse.move(box["x"] + box["width"] / 2 + step * 5, box["y"] + box["height"] / 2)
        owner.wait_for_timeout(60)
    try:
        wait_for(guest, "() => !!document.querySelector('svg.hands')", "[guest] the owner's hand")
        guest.evaluate(
            "() => { const tab = window.nibApp.workspace.active;"
            " tab.camera = { ...(tab.camera ?? { x: 0, y: 0, scale: 1 }), y: 40000 } }"
        )
        wait_for(guest, "() => !!document.querySelector('svg.hands .held')", "[guest] the hand held at the edge")
        say("the owner's hand, far up the column from the guest, is held at the guest's edge")
        guest.locator("svg.hands .held path").first.click(force=True)
        wait_for(
            guest,
            "() => !document.querySelector('svg.hands .held') && !!document.querySelector('svg.hands > circle')",
            "[guest] the pages to go to the owner's hand",
        )
        say("pressing its arrow went to the owner's hand")
    except SystemExit as gave_up:
        failed(str(gave_up))

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
                held_and_gone_to(owner, guest)
            except SystemExit as gave_up:
                failed(str(gave_up))
        alone(guest, "guest")
        guest.screenshot(path=str(SHOTS / "shared-pages.png"))

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
                named = chatter.evaluate(
                    "() => document.querySelector('.chat-tab h2.name')?.textContent.trim() ?? null"
                )
                if named != CHAT:
                    failed(f"the guest's chat is headed {named!r}, not {CHAT!r}")
                else:
                    say(f"the guest's chat is headed {named!r}")
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
