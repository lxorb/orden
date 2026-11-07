from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

OWNER = "owner@example.com"
WRITER = "writer@example.com"
ALONE = "alone@example.com"

SPACE = "Notes"
NOTE = "together.md"
OPENING = "# Together\n\nthe first line\n"

SOLO = "Solo"
ITEM = "one.md"
ITEM_OPENING = "# One note\n\nshared on its own\n"
ITEM_CANVAS = "board.canvas"
ITEM_CANVAS_FILE = '{"orden":{"version":1},"nodes":[],"edges":[]}'

PHONE = {"width": 390, "height": 844}
THUMB = {
    "viewport": PHONE,
    "has_touch": True,
    "is_mobile": True,
    "user_agent": (
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/131.0.0.0 Mobile Safari/537.36"
    ),
}

PATIENCE = 40

def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self, email: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{email}', 'Emil', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token

def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")

def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")

def fresh(
    browser: Browser,
    label: str,
    at: str = ORIGIN,
    token: str | None = None,
    viewport: dict | None = None,
    device: dict | None = None,
) -> Page:
    context = browser.new_context(**(device or {"viewport": viewport or {"width": 1180, "height": 760}}))
    if token:
        context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.ordenApp", f"[{label}] the app to start")
    return page

def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.ordenApp.workspace.flush(); return window.ordenApp.workspace.active?.doc ?? '' }"
    )

def joined(page: Page, label: str, space_id: str, role: str) -> str:
    wait_for(
        page,
        "() => (window.ordenApp.account.spaces.find("
        f"  (one) => one.id === {json.dumps(space_id)}"
        f") ?? {{}}).role === {json.dumps(role)}",
        f"[{label}] the shared space to arrive at {role}",
    )

    return wait_for(
        page,
        "() => {"
        "  const space = window.ordenApp.workspace.spaces.find("
        f"    (one) => window.ordenApp.sync.remoteIdFor(one.root) === {json.dumps(space_id)});"
        "  return space ? space.name : null"
        "}",
        f"[{label}] a folder for the shared space",
    )

def open_the_file(page: Page, label: str, note_id: str, path: str) -> None:
    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.ordenApp.workspace.tree).includes({json.dumps(path)})"
        "}"
    )
    show_space(page, path.split("/")[1])
    wait_for(page, listed, f"[{label}] {path} to arrive")

    page.evaluate("(path) => window.ordenApp.workspace.openEntry(path)", path)
    if not path.endswith(".canvas"):
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")

    wait_for(
        page,
        f"() => window.ordenApp.rooms.carries({json.dumps(note_id)})",
        f"[{label}] {path} to join its room",
    )

def open_the_note(page: Page, label: str, note_id: str, space: str) -> None:
    open_the_file(page, label, note_id, f"/{space}/{NOTE}")

def dismiss(page: Page) -> None:
    for _ in range(4):
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        if not page.locator('.sheet, aside .spaces, [role="menu"]').count():
            return

def space_row(page: Page, name: str = SPACE):
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

    header = page.locator("aside .head button.name")
    header.wait_for(state="visible", timeout=10_000)
    page.wait_for_timeout(400)

    if not page.locator("aside .spaces").count():
        header.click()

    rows = page.locator("aside .spaces .line")
    rows.first.wait_for(state="visible", timeout=10_000)
    return rows.filter(has_text=name).first

def open_the_share_sheet(page: Page, name: str = SPACE):
    wait_for(
        page,
        "() => { const space = window.ordenApp.workspace.spaces.find("
        f"  (one) => one.name === {json.dumps(name)});"
        " return !!space && !!window.ordenApp.account.user"
        "  && !!window.ordenApp.sync.remoteIdFor(space.root) }",
        f"{name} to be the account's",
    )
    space_row(page, name).locator(".more").click()
    page.wait_for_selector('[role="menu"]:visible', timeout=10_000)
    share = page.get_by_role("menuitem", name="Share", exact=True)
    share.wait_for(state="visible", timeout=30_000)
    share.click()

    sheet = page.get_by_role("dialog")
    sheet.wait_for(state="visible", timeout=10_000)
    sheet.get_by_text("Who has access").wait_for(timeout=10_000)
    return sheet

def let_in(page: Page, label: str, keeps: bool = False) -> None:
    if keeps:
        keep = page.get_by_role("button", name="Keep them")
        try:
            keep.wait_for(timeout=10_000)
            keep.click()
        except Exception:
            say(f"[{label}] nothing was asked about the notes already here")

    wait_for(page, "() => window.ordenApp.account.signedIn", f"[{label}] the session")

def asked_nothing(page: Page, label: str, wrong) -> None:
    for what, selector in (
        ("an address field", "input[type=email]"),
        ("the code boxes", ".digits"),
    ):
        if page.locator(selector).count():
            wrong(f"[{label}] the link asked for {what}")

def settled(page: Page, label: str) -> None:
    wait_for(page, "() => !document.querySelector('.arriving')", f"[{label}] the first pass")
    page.wait_for_timeout(250)

def rename(page: Page, name: str) -> None:
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

    who = page.locator("aside .foot button.who")
    who.wait_for(state="visible", timeout=10_000)
    page.wait_for_timeout(400)
    who.click()
    entry = page.locator(".menu [role=menuitem]").filter(has_text="Account")
    entry.wait_for(state="visible", timeout=10_000)
    entry.click()

    field = page.locator(".sheet .body input.orden-field").first
    field.wait_for(state="visible", timeout=10_000)
    field.fill(name)
    field.press("Enter")

    wait_for(
        page,
        f"() => window.ordenApp.account.guest?.name === {json.dumps(name)}",
        f"the guest to be called {name}",
    )

    dismiss(page)

def set_link(token: str, space_id: str, role: str, mode: str) -> None:
    request(
        f"/v1/spaces/{space_id}/share/link",
        token,
        {"role": role, "mode": mode},
        method="PUT",
    )

def set_item_link(token: str, space_id: str, note_id: str, role: str, mode: str) -> None:
    request(
        f"/v1/spaces/{space_id}/share/link?item={note_id}",
        token,
        {"role": role, "mode": mode},
        method="PUT",
    )

def show_space(page: Page, name: str) -> None:
    page.evaluate(
        "(name) => {"
        "  const space = window.ordenApp.workspace.spaces.find((one) => one.name === name);"
        "  if (space) window.ordenApp.workspace.showSpace(space.id)"
        "}",
        name,
    )

def tree_row(page: Page, path: str):
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

    row = page.locator(f'.row[data-path="{path}"]')
    row.wait_for(state="visible", timeout=10_000)
    return row

def open_the_file_sheet(page: Page, path: str):
    wait_for(
        page,
        f"() => !!window.ordenApp.sync.tracked({json.dumps(path)})",
        f"the account to hold {path}",
    )

    tree_row(page, path).click(button="right")
    page.wait_for_selector('[role="menu"]:visible', timeout=10_000)
    share = page.get_by_role("menuitem", name="Share", exact=True)
    share.wait_for(state="visible", timeout=30_000)
    share.click()

    sheet = page.get_by_role("dialog")
    sheet.wait_for(state="visible", timeout=10_000)
    sheet.get_by_text("Who has access").wait_for(timeout=10_000)
    return sheet

def shared_with_you(page: Page, label: str, count: int = 1) -> None:
    wait_for(
        page,
        f"() => window.ordenApp.sharedWithYou.items.length === {count}",
        f"[{label}] a file shared on its own",
    )

def landed_alone(page: Page, label: str, note_id: str, wrong) -> None:
    wait_for(
        page,
        f"() => window.ordenApp.workspace.active?.note.shared === {json.dumps(note_id)}",
        f"[{label}] the shared file to open by itself",
    )
    wait_for(
        page,
        f"() => window.ordenApp.rooms.carries({json.dumps(note_id)})",
        f"[{label}] the file to join its room",
    )
    settled(page, label)
    chrome = page.evaluate(
        "() => [...document.querySelectorAll('[data-chrome], .strip')]"
        ".map((one) => one.dataset.chrome ?? one.className)"
    )
    if chrome:
        wrong(f"[{label}] a guest with one file still sees the app round it: {chrome}")
    if not page.locator(".pane").count():
        wrong(f"[{label}] the file itself is not on screen")

def guest_corner(page: Page, label: str, wrong):
    corner = page.locator(".guest-corner button.who")
    corner.wait_for(state="visible", timeout=10_000)
    name = page.evaluate("() => window.ordenApp.account.guest?.name ?? ''")
    if corner.inner_text().strip() != name.strip()[:1].upper():
        wrong(f"[{label}] the corner says {corner.inner_text()!r} for a guest called {name!r}")

    touch = page.evaluate("() => document.documentElement.hasAttribute('data-touch')")
    least = 48 if touch else 24
    box = corner.bounding_box() or {"width": 0, "height": 0}
    if box["width"] < least or box["height"] < least:
        wrong(f"[{label}] the corner is {box['width']}x{box['height']}, under {least}")

    if corner.evaluate("(one) => !!one.closest('[data-chrome]')"):
        wrong(f"[{label}] the corner is part of the app's chrome")
    return corner

def shared_row(page: Page, name: str):
    return space_row(page, name)

def typed(page: Page, at: int, said: str) -> None:
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.orden.dispatch({ selection: { anchor: Math.min(at, window.orden.state.doc.length) } });"
        "  window.orden.focus()"
        "}",
        at,
    )
    page.keyboard.type(said, delay=12)

def agree(one: Page, two: Page, wanted: str) -> None:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        if words(one) == words(two) and wanted in words(one):
            return
        one.wait_for_timeout(30)

    raise SystemExit(f"the two never agreed on {wanted!r}:\n{words(one)!r}\n{words(two)!r}")

def moved(page: Page, at: int) -> None:
    page.evaluate(
        "(at) => {"
        "  window.orden.dispatch({ selection: { anchor: at } });"
        "  window.orden.focus()"
        "}",
        at,
    )

def caret_names(page: Page) -> list[str]:
    return [
        name.strip()
        for name in page.locator(".cm-orden-caret-name").all_inner_texts()
        if name.strip()
    ]

def main() -> int:
    worker = Worker()
    failures: list[str] = []

    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        owner_token = worker.account(OWNER)
        space = request("/v1/spaces", owner_token, {"name": SPACE})["space"]
        note = request(
            f"/v1/spaces/{space['id']}/notes",
            owner_token,
            {"path": NOTE, "content": OPENING},
        )["note"]
        say(f"the owner holds {SPACE}/{NOTE} as {note['id']}")

        solo = request("/v1/spaces", owner_token, {"name": SOLO})["space"]
        one = request(
            f"/v1/spaces/{solo['id']}/notes",
            owner_token,
            {"path": ITEM, "content": ITEM_OPENING},
        )["note"]
        plane = request(
            f"/v1/spaces/{solo['id']}/notes",
            owner_token,
            {"path": ITEM_CANVAS, "content": ITEM_CANVAS_FILE},
        )["note"]
        say(f"and {SOLO}/{ITEM} as {one['id']}, with a canvas beside it")

        owner = fresh(browser, "owner", token=owner_token)
        wait_for(
            owner,
            f"() => window.ordenApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
            "[owner] the space to arrive",
        )

        sheet = open_the_share_sheet(owner)
        sheet.locator(".compose input").fill(WRITER)
        sheet.get_by_role("button", name="Invite").click()
        sheet.get_by_text(WRITER).wait_for(timeout=10_000)
        sheet.get_by_text("Invited").wait_for(timeout=10_000)
        owner.wait_for_timeout(200)
        sheet.screenshot(path=str(SHOTS / "share-sheet.png"))
        say(f"the sheet lists {WRITER} as invited")

        token = worker.waits_for_mail(
            WRITER, r"https://(?:orden\.so|nibeditor\.com)/join/([a-f0-9]+)", "the invitation"
        ).group(1)
        say("the invitation carries a link to the service")

        dismiss(owner)

        writer = fresh(browser, "writer", at=f"{ORIGIN}/join/{token}")
        let_in(writer, "writer", keeps=True)
        asked_nothing(writer, "writer", wrong)
        theirs = joined(writer, "writer", space["id"], "write")
        settled(writer, "writer")
        writer.screenshot(path=str(SHOTS / "invited-straight-in.png"))
        say(f"{WRITER} is in {SPACE} without having typed a thing")

        held = writer.evaluate("() => window.ordenApp.account.user?.email ?? null")
        if held != WRITER:
            wrong(f"the link opened {held!r} rather than {WRITER}")

        shared = writer.evaluate(
            "(id) => window.ordenApp.account.spaces.find((one) => one.id === id)?.shared",
            space["id"],
        )
        if shared is not True:
            wrong(f"the writer's copy of the space says shared={shared!r}")

        spent = fresh(browser, "spent", at=f"{ORIGIN}/join/{token}")
        spent.get_by_text("That link does not open anything").wait_for(timeout=15_000)
        spent.wait_for_timeout(250)
        spent.screenshot(path=str(SHOTS / "used-link.png"))
        if spent.evaluate("() => window.ordenApp.account.signedIn"):
            wrong("a used invitation opened a second session")
        say("the same link twice says so once, with the code behind it")
        spent.close()

        open_the_note(owner, "owner", note["id"], SPACE)
        open_the_note(writer, "writer", note["id"], theirs)

        typed(owner, len(OPENING), "from the owner\n")
        typed(writer, 0, "from the writer\n")
        agree(owner, writer, "from the owner")
        if "from the writer" not in words(owner):
            wrong("what the invited person wrote never reached the owner")
        say("both of them hold the same words")

        moved(writer, 3)
        owner.wait_for_selector(".cm-orden-caret", timeout=10_000)
        owner.wait_for_timeout(150)
        names = caret_names(owner)
        owner.locator(".cm-editor").first.screenshot(path=str(SHOTS / "named-caret.png"))

        if names != ["writer"]:
            wrong(f"the caret is labelled {names!r} rather than the person")
        else:
            say("the caret carries the person's name rather than the device's")

        space_row(owner)
        owner.wait_for_timeout(200)
        owner.locator("aside .spaces").screenshot(
            path=str(SHOTS / "shared-in-the-switcher.png")
        )
        if not owner.locator("aside .spaces .shared").count():
            wrong("the switcher does not mark the space as shared")

        sheet = open_the_share_sheet(owner)
        sheet.get_by_role("switch", name="Link").click()
        owner.wait_for_timeout(300)
        sheet.get_by_role("switch", name="Ask first").click()
        owner.wait_for_timeout(300)

        url = sheet.locator("code").inner_text()
        sheet.screenshot(path=str(SHOTS / "share-link.png"))
        say(f"the link is {url}")

        found = re.search(r"/join/([a-f0-9]+)", url)
        if not found:
            raise SystemExit(f"that is not a join link: {url}")
        link = found.group(1)
        dismiss(owner)

        set_link(owner_token, space["id"], "write", "open")

        guest = fresh(browser, "guest", at=f"{ORIGIN}/join/{link}")
        let_in(guest, "guest")
        asked_nothing(guest, "guest", wrong)
        mine = joined(guest, "guest", space["id"], "write")
        say(f"the link put a guest in {SPACE}, to write")

        if guest.evaluate("() => window.ordenApp.account.user"):
            wrong("the link made an account rather than a guest")

        named = guest.evaluate("() => window.ordenApp.account.guest?.name ?? null")
        if not named or not re.fullmatch(r"[\w .+-]+ \w+", named):
            wrong(f"the guest is called {named!r} rather than after its device")
        else:
            say(f"the guest is called {named!r}, after the device it arrived on")

        open_the_note(guest, "guest", note["id"], mine)
        typed(guest, 0, "from a guest\n")
        agree(owner, guest, "from a guest")
        say("what the guest wrote is in the same note as the owner's words")

        moved(guest, 5)
        owner.wait_for_timeout(250)
        if named not in caret_names(owner):
            wrong(f"the owner sees {caret_names(owner)!r} rather than {named!r}")
        owner.locator(".cm-editor").first.screenshot(path=str(SHOTS / "guest-caret.png"))

        rename(guest, "Ada")
        guest.wait_for_timeout(200)
        guest.locator("aside .foot").screenshot(path=str(SHOTS / "guest-renamed.png"))

        moved(guest, 7)
        until = time.monotonic() + PATIENCE
        while time.monotonic() < until and "Ada" not in caret_names(owner):
            moved(guest, 7 if int(time.monotonic() * 2) % 2 else 9)
            owner.wait_for_timeout(200)

        if "Ada" not in caret_names(owner):
            wrong(f"the rename never reached the owner: {caret_names(owner)!r}")
        else:
            say("the name the guest chose is the name over their caret")
        owner.locator(".cm-editor").first.screenshot(path=str(SHOTS / "renamed-caret.png"))

        set_link(owner_token, space["id"], "read", "open")

        reader = fresh(browser, "reader", at=f"{ORIGIN}/join/{link}")
        let_in(reader, "reader")
        asked_nothing(reader, "reader", wrong)
        here = joined(reader, "reader", space["id"], "read")
        say("the same link put a second guest in the space, to read")

        open_the_note(reader, "reader", note["id"], here)
        before = words(reader)
        for wanted in ("from the owner", "from the writer", "from a guest"):
            if wanted not in before:
                wrong(f"the reader cannot see {wanted!r}:\n{before!r}")

        editable = reader.locator(".cm-content").get_attribute("contenteditable")
        if editable != "false":
            wrong(f"the reader's editor says contenteditable={editable!r}")

        reader.click(".cm-content")
        reader.keyboard.type("this should go nowhere", delay=8)
        reader.wait_for_timeout(400)
        if words(reader) != before:
            wrong("the reader typed into a note they may only read")
        reader.locator(".cm-editor").first.screenshot(path=str(SHOTS / "guest-read-only.png"))

        owner.wait_for_timeout(600)
        if "this should go nowhere" in words(owner):
            wrong("what a reader typed crossed to the owner")

        stored = request(f"/v1/notes/{note['id']}", owner_token)["content"]
        if "this should go nowhere" in stored:
            wrong("what a reader typed reached the account")

        space_row(reader, here).locator(".more").click()
        reader.wait_for_selector('.menu[role="menu"]', timeout=10_000)
        offered = reader.locator('.menu [role="menuitem"]').all_inner_texts()
        dismiss(reader)
        if any(word in " ".join(offered) for word in ("New note", "Rename", "Share")):
            wrong(f"a reader is offered {offered!r}")
        else:
            say(f"a reader's menu offers only {offered!r}")

        sheet = open_the_share_sheet(owner)
        sheet.get_by_role("switch", name="Ask first").click()
        owner.wait_for_timeout(300)
        dismiss(owner)
        say("the owner set the link to ask first")

        waiting = fresh(browser, "waiting", at=f"{ORIGIN}/join/{link}")
        panel = waiting.get_by_role("dialog")
        panel.wait_for(state="visible", timeout=15_000)
        panel.get_by_label("Your name").fill("Grace")
        waiting.wait_for_timeout(200)
        waiting.screenshot(path=str(SHOTS / "guest-asked.png"))

        panel.get_by_role("button", name="Ask to join").click()
        waiting.get_by_text("Waiting for Emil").wait_for(timeout=15_000)
        waiting.wait_for_timeout(250)
        waiting.screenshot(path=str(SHOTS / "guest-waiting.png"))
        say("the visitor gave a name and is waiting on a page that says so")

        if waiting.evaluate(
            "(id) => window.ordenApp.account.spaces.some((one) => one.id === id)",
            space["id"],
        ):
            wrong("somebody waiting to be let in already holds the space")

        sheet = open_the_share_sheet(owner)
        sheet.get_by_text("Waiting").wait_for(timeout=10_000)
        sheet.get_by_text("Grace").wait_for(timeout=10_000)
        owner.wait_for_timeout(200)
        sheet.screenshot(path=str(SHOTS / "owner-asked.png"))
        sheet.get_by_role("button", name="Accept").click()
        owner.wait_for_timeout(300)
        dismiss(owner)
        say("the owner pressed Accept")

        joined(waiting, "waiting", space["id"], "read")
        waiting.wait_for_timeout(400)
        waiting.screenshot(path=str(SHOTS / "guest-let-in.png"))
        if waiting.get_by_role("dialog").count():
            wrong("the waiting page is still up after the owner accepted")
        say("the calm page turned into the space, with nothing pressed")

        show_space(owner, SOLO)
        owner.wait_for_timeout(300)
        sheet = open_the_file_sheet(owner, f"/{SOLO}/{ITEM}")
        owner.wait_for_timeout(200)
        sheet.screenshot(path=str(SHOTS / "share-a-note.png"))

        head = sheet.locator(".head .title").inner_text()
        if head != f"Share {ITEM[:-3]}":
            wrong(f"the sheet is headed {head!r} rather than about the note")
        else:
            say(f"the sheet is headed {head!r}, with the file's own mark")

        sheet.locator(".compose input").fill(ALONE)
        sheet.get_by_role("button", name="Invite").click()
        sheet.get_by_text(ALONE).wait_for(timeout=10_000)
        owner.wait_for_timeout(200)
        sheet.screenshot(path=str(SHOTS / "share-a-note-invited.png"))
        dismiss(owner)
        say(f"{ALONE} was given one note out of {SOLO}")

        token = worker.waits_for_mail(
            ALONE, r"https://(?:orden\.so|nibeditor\.com)/join/([a-f0-9]+)", "the note's invitation"
        ).group(1)
        said = worker.mail_to(ALONE)
        if "shared the note" not in said:
            wrong("the mail does not say a note was shared")
        if "shared the space" in said:
            wrong("the mail about one note says a space was shared")

        alone = fresh(browser, "alone", at=f"{ORIGIN}/join/{token}")
        let_in(alone, "alone", keeps=True)
        asked_nothing(alone, "alone", wrong)
        shared_with_you(alone, "alone")
        settled(alone, "alone")
        say(f"{ALONE} is in, holding one file")

        held = alone.evaluate(
            "(id) => window.ordenApp.account.spaces.some((one) => one.id === id)",
            solo["id"],
        )
        if held:
            wrong("one shared note brought the space it came out of with it")

        folder = alone.evaluate(
            "(id) => window.ordenApp.workspace.spaces.some("
            "  (one) => window.ordenApp.sync.remoteIdFor(one.root) === id)",
            solo["id"],
        )
        if folder:
            wrong("one shared note made a folder for somebody else's space")

        row = shared_row(alone, ITEM[:-3])
        alone.wait_for_timeout(250)
        alone.locator("aside .spaces").screenshot(
            path=str(SHOTS / "shared-with-you.png")
        )
        if not alone.locator("aside .spaces .from").count():
            wrong("the shared file is not grouped under whoever shared it")
        if not row.locator(".shared").count():
            wrong("the shared file's row does not wear the shared mark")

        row.locator(".orden-row").click()
        wait_for(
            alone,
            "() => !!window.ordenApp.workspace.active?.note.shared",
            "[alone] the shared note to open in a tab",
        )
        wait_for(
            alone,
            f"() => window.ordenApp.rooms.carries({json.dumps(one['id'])})",
            "[alone] the shared note to join its room",
        )
        alone.wait_for_timeout(250)
        alone.screenshot(path=str(SHOTS / "shared-note-open.png"))
        if not alone.locator(".tab .shared").count():
            wrong("the tab on a shared file does not wear the shared mark")
        say("the note opened in a tab of its own, in its room, with the mark")

        open_the_file(owner, "owner", one["id"], f"/{SOLO}/{ITEM}")
        typed(owner, len(ITEM_OPENING), "from the owner\n")
        typed(alone, 0, "from the one person\n")
        agree(owner, alone, "from the owner")
        if "from the one person" not in words(owner):
            wrong("what the one person wrote never reached the owner")
        say("both of them hold the same words, with no space between them")

        reachable = alone.evaluate(
            "async (id) => {"
            "  const answer = await fetch(`/v1/notes/${id}`,"
            "    { headers: { authorization: `Bearer ${window.ordenApp.account.token}` } });"
            "  return answer.status"
            "}",
            plane["id"],
        )
        if reachable != 404:
            wrong(f"the canvas beside the shared note answered {reachable}")
        else:
            say("the file beside it is a file that does not exist")

        held = alone.evaluate("() => localStorage.getItem('orden:session')")
        phone = fresh(browser, "phone", token=held, viewport=PHONE)
        shared_with_you(phone, "phone")
        settled(phone, "phone")
        shared_row(phone, ITEM[:-3])
        phone.wait_for_timeout(300)
        phone.screenshot(path=str(SHOTS / "shared-with-you-phone.png"))

        shared_row(phone, ITEM[:-3]).locator(".orden-row").click()
        wait_for(
            phone,
            "() => !!window.ordenApp.workspace.active?.note.shared",
            "[phone] the shared note to open",
        )
        phone.wait_for_timeout(400)
        phone.screenshot(path=str(SHOTS / "shared-note-phone.png"))
        say("the same row and the same tab under a thumb")

        set_item_link(owner_token, solo["id"], plane["id"], "write", "open")
        canvas_link = request(
            f"/v1/spaces/{solo['id']}/share?item={plane['id']}", owner_token
        )["link"]["url"]
        found = re.search(r"/join/([a-f0-9]+)", canvas_link)
        if not found:
            raise SystemExit(f"that is not a join link: {canvas_link}")

        drawer = fresh(browser, "drawer", at=f"{ORIGIN}/join/{found.group(1)}")
        let_in(drawer, "drawer")
        asked_nothing(drawer, "drawer", wrong)
        shared_with_you(drawer, "drawer")
        if drawer.evaluate("() => window.ordenApp.account.user"):
            wrong("a link to one canvas made an account rather than a guest")

        landed_alone(drawer, "drawer", plane["id"], wrong)
        drawer.screenshot(path=str(SHOTS / "shared-canvas.png"))
        say("a guest with no account is drawing on one shared canvas, and sees nothing else")

        if drawer.evaluate("() => window.ordenApp.account.spaces.length"):
            wrong("a link to one canvas handed over a space as well")

        drawer.reload(wait_until="domcontentloaded")
        wait_for(drawer, "() => !!window.ordenApp", "[drawer] the app to start again")
        landed_alone(drawer, "drawer", plane["id"], wrong)
        say("the guest who came back is back in the canvas, alone")

        thumb = fresh(browser, "thumb", at=f"{ORIGIN}/join/{found.group(1)}", viewport=PHONE)
        let_in(thumb, "thumb")
        landed_alone(thumb, "thumb", plane["id"], wrong)
        guest_corner(thumb, "thumb", wrong)
        thumb.screenshot(path=str(SHOTS / "shared-canvas-phone.png"))
        say("and on a phone, with the guest's corner")

        if not owner.locator('[data-chrome="top"]').count():
            wrong("the owner lost the app's bar")

        set_item_link(owner_token, solo["id"], one["id"], "write", "open")
        note_link = request(f"/v1/spaces/{solo['id']}/share?item={one['id']}", owner_token)[
            "link"
        ]["url"]
        found = re.search(r"/join/([a-f0-9]+)", note_link)
        if not found:
            raise SystemExit(f"that is not a join link: {note_link}")

        named = fresh(browser, "named", at=f"{ORIGIN}/join/{found.group(1)}")
        let_in(named, "named")
        landed_alone(named, "named", one["id"], wrong)
        corner = guest_corner(named, "named", wrong)
        named.screenshot(path=str(SHOTS / "guest-corner.png"))

        pop = named.get_by_role("dialog", name="Account")
        corner.click()
        pop.wait_for(state="visible", timeout=10_000)
        named.wait_for_timeout(250)
        named.screenshot(path=str(SHOTS / "guest-corner-open.png"))

        named.keyboard.press("Escape")
        pop.wait_for(state="hidden", timeout=10_000)
        corner.click()
        pop.wait_for(state="visible", timeout=10_000)
        named.locator(".cm-content").click()
        pop.wait_for(state="hidden", timeout=10_000)
        say("the corner opens on a press, and Escape or a press past it shuts it")

        corner.click()
        field = pop.locator("input")
        field.fill("Grace")
        field.press("Enter")
        wait_for(
            named,
            "() => window.ordenApp.account.guest?.name === 'Grace'",
            "[named] the guest to be called Grace",
        )
        if corner.inner_text().strip() != "G":
            wrong(f"the corner says {corner.inner_text()!r} after the guest became Grace")
        named.keyboard.press("Escape")

        open_the_file(owner, "owner", one["id"], f"/{SOLO}/{ITEM}")
        until = time.monotonic() + PATIENCE
        seen: list[str] = []
        while time.monotonic() < until and "Grace" not in seen:
            moved(named, 3 if int(time.monotonic() * 2) % 2 else 6)
            owner.wait_for_timeout(250)
            seen = caret_names(owner)
        if "Grace" not in seen:
            wrong(f"the owner reads {seen!r} over the guest's caret, not Grace")
        else:
            say("the name the guest chose in the corner is the name over their caret")

        pocket = fresh(browser, "pocket", at=f"{ORIGIN}/join/{found.group(1)}", device=THUMB)
        let_in(pocket, "pocket")
        landed_alone(pocket, "pocket", one["id"], wrong)
        if not pocket.evaluate("() => document.documentElement.dataset.device === 'phone'"):
            wrong("[pocket] the app did not take the handheld for a phone")
        box = guest_corner(pocket, "pocket", wrong).bounding_box()
        words_at = pocket.evaluate(
            "() => { const range = document.createRange();"
            " range.selectNodeContents(document.querySelector('.cm-content'));"
            " return [...range.getClientRects()].filter((one) => one.width && one.height)"
            ".map((one) => [one.left, one.top, one.right, one.bottom]) }"
        )
        if box:
            under = [
                one
                for one in words_at
                if one[0] < box["x"] + box["width"]
                and one[2] > box["x"]
                and one[1] < box["y"] + box["height"]
                and one[3] > box["y"]
            ]
            if under:
                wrong(f"[pocket] the corner covers the note's words at {under}")
        pocket.screenshot(path=str(SHOTS / "guest-corner-phone.png"))

        pocket.locator(".guest-corner button.who").tap()
        held = pocket.get_by_role("dialog", name="Account")
        held.wait_for(state="visible", timeout=10_000)
        shown = held.bounding_box() or {"x": -1, "width": 0}
        if shown["x"] < 0 or shown["x"] + shown["width"] > PHONE["width"]:
            wrong(f"[pocket] the corner's layer runs off the screen: {shown}")
        pocket.wait_for_timeout(250)
        pocket.screenshot(path=str(SHOTS / "guest-corner-phone-open.png"))
        pocket.locator(".cm-content").tap(position={"x": 40, "y": 300})
        held.wait_for(state="hidden", timeout=10_000)
        pocket.context.close()
        say("on a phone the corner is a thumb's size, clear of the words, and taps open and shut")

        corner.click()
        pop.get_by_role("button", name="Sign in").click()
        named.locator("input[type=email]").wait_for(state="visible", timeout=10_000)
        named.wait_for_timeout(250)
        named.screenshot(path=str(SHOTS / "guest-corner-sign-in.png"))
        say("Sign in in the corner opens the app's sign-in")

        grace = "grace@example.com"
        named.locator("input[type=email]").fill(grace)
        already = len(worker.written())
        named.get_by_role("button", name="Continue").click()
        code = worker.waits_for_mail(
            grace, r"(\d{6}) is your (?:nibeditor|Orden) code", "[named] the sign-in code", already
        ).group(1)
        named.locator(".digits input").first.fill(code)
        let_in(named, "named", keeps=True)
        wait_for(named, "() => !!window.ordenApp.account.user", "[named] the account")
        wait_for(
            named,
            f"() => window.ordenApp.workspace.active?.note.shared === {json.dumps(one['id'])}",
            "[named] the shared note to still be open once signed in",
        )
        settled(named, "named")
        if named.locator(".guest-corner button.who").count():
            wrong("the guest's corner stayed after signing in")
        named.screenshot(path=str(SHOTS / "guest-corner-signed-in.png"))
        say("signed in from the corner, and still in the file, with the app round it")

        request(
            f"/v1/spaces/{solo['id']}/share/members/{ALONE}?item={one['id']}",
            owner_token,
            method="DELETE",
        )

        wait_for(
            alone,
            "() => window.ordenApp.sharedWithYou.items.length === 0",
            "[alone] the row to go once it was taken back",
        )
        wait_for(
            alone,
            "() => !window.ordenApp.workspace.tabs.some((tab) => tab.note.shared)",
            "[alone] the tab on it to close",
        )
        alone.wait_for_timeout(300)
        alone.screenshot(path=str(SHOTS / "shared-note-revoked.png"))
        say("the row went and the tab closed, with nothing asked")

        say("nobody typed a code, and everybody who was let in was let in")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        "\nevery way in opened by itself: a mailed link, two guests, one that asked"
        " first, one note and one canvas",
        flush=True,
    )
    return 0

if __name__ == "__main__":
    sys.exit(main())
