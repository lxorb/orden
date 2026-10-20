"""Sharing a space, end to end, against the real Worker.

Five browser contexts that know nothing about each other, and none of them types
a thing to get in. The owner opens the Share sheet from the space's own row in
the switcher and invites
somebody by address; that somebody has no Nib account at all, follows the link out
of the real message the runtime's mail binding was handed, and is in the space -
no code, no form, nothing on screen. They write in the same note as the owner and
each sees the other's caret with the other's name on it.

Then the link the space itself holds, three times over. A guest follows it to
write, arrives named after their device, renames themselves in one tap, and the
owner's copy of the caret says the new name. A second guest follows the same link
once it hands out reading, and finds a note they can see and cannot type into. A
third follows it once it asks first, gives a name, waits on a calm page, and is in
the moment the owner presses Accept.

Then the other size of the same act: one file out of a space that is shared with
nobody. The owner opens the same sheet from the note's own row and gives that one
note away; the other side gets no space, no folder and no row in the tree - a row
at the foot of the space switcher, under whoever shared it, which opens a tab that
syncs through the file's room. The same row and the same tab are photographed on a
phone. Then a guest follows a link to one canvas and is in it, with none of the
app round it - no bar, no tabs, no file list - on a desktop, after a reload and on
a phone (#386). Such a guest keeps one thing of their own, a corner: it says who
they are, renames them where the owner sees it, and signs them in without taking
them out of the file. Then the owner takes the note back and the row and its tab
go, with nothing asked.

Everything here is the real thing: the built web app, the Worker under
`wrangler dev` on workerd, a Durable Object holding the room, the D1 migrations
including the sharing one, and the mailer writing where a mail would have gone.

Run it from the repository root:

    python apps/desktop/test/e2e/share.py

It builds the app, applies the migrations, starts the Worker, runs the browsers
and stops everything again. Nothing it makes outlives it but the screenshots,
which go beside it under `shots/`.
"""

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
#: The Worker's own address, which is also where the app it serves is loaded from.
ORIGIN = harness.worker_origin()


OWNER = "owner@example.com"
WRITER = "writer@example.com"
# Somebody who is given one note and nothing else, and one who is handed a
# canvas by a link. Neither is ever in the space the file came out of.
ALONE = "alone@example.com"

SPACE = "Notes"
NOTE = "together.md"
OPENING = "# Together\n\nthe first line\n"

# A second space, shared with nobody, so that sharing one file out of it is the
# only way anybody else reaches anything in it.
SOLO = "Solo"
ITEM = "one.md"
ITEM_OPENING = "# One note\n\nshared on its own\n"
ITEM_CANVAS = "board.canvas"
ITEM_CANVAS_FILE = '{"nib":{"version":1},"nodes":[],"edges":[]}'

# A phone, for the shots that say the section and the tab are one design on both.
PHONE = {"width": 390, "height": 844}
# And one under a thumb, which the app takes for a phone: a handheld's agent and a
# finger for a pointer, so the controls are a thumb's size (viewport.svelte.ts).
THUMB = {
    "viewport": PHONE,
    "has_touch": True,
    "is_mobile": True,
    "user_agent": (
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/131.0.0.0 Mobile Safari/537.36"
    ),
}

# How long anything is waited for before the test gives up and says what it saw.
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
    """The real Worker, with the owner's account in it; see harness.py. Everybody
    else signs in for real, with the code the Worker mails them."""

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self, email: str) -> str:
        """An account with a live session, put straight into the database. The
        owner is not what is under test here; everybody else signs in for real.
        """
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
    """Polls a page until the script answers with something truthy."""
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
    """A browser context that has never held anything: its own storage, its own
    session, and no idea that the other two exist.

    `viewport` is how the same session is opened on a second device: a phone is
    the same app at another width, and a token handed to two contexts is one
    account on two machines. `device` is a whole handheld instead, finger and all."""
    context = browser.new_context(**(device or {"viewport": viewport or {"width": 1180, "height": 760}}))
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page


def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush(); return window.nibApp.workspace.active?.doc ?? '' }"
    )


def joined(page: Page, label: str, space_id: str, role: str) -> str:
    """Waits for the account to list the shared space at that role, and answers
    what the folder mirroring it is called here.

    Not always what it is called on the account: a machine that already has a
    folder of that name keeps it, and somebody else's space is given one of its
    own rather than being folded into it.
    """
    wait_for(
        page,
        "() => (window.nibApp.account.spaces.find("
        f"  (one) => one.id === {json.dumps(space_id)}"
        f") ?? {{}}).role === {json.dumps(role)}",
        f"[{label}] the shared space to arrive at {role}",
    )

    return wait_for(
        page,
        "() => {"
        "  const space = window.nibApp.workspace.spaces.find("
        f"    (one) => window.nibApp.sync.remoteIdFor(one.root) === {json.dumps(space_id)});"
        "  return space ? space.name : null"
        "}",
        f"[{label}] a folder for the shared space",
    )


def open_the_file(page: Page, label: str, note_id: str, path: str) -> None:
    """Waits for a file to arrive in the tree, brings its space up, opens it, and
    waits for it to be in its room. A note or a canvas: `openEntry` is the one way
    in every list in the app uses, and it knows which kind a name is."""
    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.nibApp.workspace.tree).includes({json.dumps(path)})"
        "}"
    )
    show_space(page, path.split("/")[1])
    wait_for(page, listed, f"[{label}] {path} to arrive")

    page.evaluate("(path) => window.nibApp.workspace.openEntry(path)", path)
    if not path.endswith(".canvas"):
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")

    wait_for(
        page,
        f"() => window.nibApp.rooms.carries({json.dumps(note_id)})",
        f"[{label}] {path} to join its room",
    )


def open_the_note(page: Page, label: str, note_id: str, space: str) -> None:
    """The note this run's first half is about, in the folder that mirrors the
    shared space - which is not always called what the space is called here."""
    open_the_file(page, label, note_id, f"/{space}/{NOTE}")


def dismiss(page: Page) -> None:
    """Escape, once per layer.

    A sheet opened from the switcher leaves the switcher standing behind it,
    which is what a person sees too: Escape closes the layer on top and hands
    the one under it back. See overlays.ts."""
    for _ in range(4):
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        if not page.locator('.sheet, aside .spaces, [role="menu"]').count():
            return


def space_row(page: Page, name: str = SPACE):
    """A space's own row, in the switcher the panel's header opens.

    There is no rail any more: the name at the top of the list is itself the
    switcher, every other space is a row in it, and what a space offers is the
    button at the end of its row. See SpaceSwitcher.svelte and docs/design.md.
    The list is opened only if it is not already, because the name toggles it and
    a sheet closing above it leaves it standing."""
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

    # The panel slides open and the header comes with it; a press landing
    # mid-slide lands on the note behind it.
    header = page.locator("aside .head button.name")
    header.wait_for(state="visible", timeout=10_000)
    page.wait_for_timeout(400)

    if not page.locator("aside .spaces").count():
        header.click()

    rows = page.locator("aside .spaces .line")
    rows.first.wait_for(state="visible", timeout=10_000)
    return rows.filter(has_text=name).first


def open_the_share_sheet(page: Page, name: str = SPACE):
    """The Share sheet, opened the way anybody opens it: the space's own menu, on
    its row in the switcher."""
    # The row is offered once the space is the account's - a copy on the server, owned
    # by whoever is signed in; see `canShare` in sharing.svelte.ts - which is a pass
    # after the space itself arrives, and a menu opened before it has no Share in it.
    wait_for(
        page,
        "() => { const space = window.nibApp.workspace.spaces.find("
        f"  (one) => one.name === {json.dumps(name)});"
        " return !!space && !!window.nibApp.account.user"
        "  && !!window.nibApp.sync.remoteIdFor(space.root) }",
        f"{name} to be the account's",
    )
    space_row(page, name).locator(".more").click()
    # The menu first, then the row in it. Which rows a menu offers depends on what
    # the app knows about the item, so the two are separate waits: a menu that never
    # opened and a menu with no Share in it are different things to be told about.
    page.wait_for_selector('[role="menu"]:visible', timeout=10_000)
    share = page.get_by_role("menuitem", name="Share", exact=True)
    share.wait_for(state="visible", timeout=30_000)
    share.click()

    sheet = page.get_by_role("dialog")
    sheet.wait_for(state="visible", timeout=10_000)
    # Drawn once the account has said who is already in it.
    sheet.get_by_text("Who has access").wait_for(timeout=10_000)
    return sheet


def let_in(page: Page, label: str, keeps: bool = False) -> None:
    """Waits for the session a link established, having asked for nothing.

    An invitation opens the account it was written to, and that account then meets
    whatever this browser already holds: keeping it is the answer that loses
    nothing. A guest is never asked, because a guest has no account for the notes
    already here to join, which is what `keeps` is about.
    """
    if keeps:
        keep = page.get_by_role("button", name="Keep them")
        try:
            keep.wait_for(timeout=10_000)
            keep.click()
        except Exception:
            say(f"[{label}] nothing was asked about the notes already here")

    wait_for(page, "() => window.nibApp.account.signedIn", f"[{label}] the session")


def asked_nothing(page: Page, label: str, wrong) -> None:
    """That the link put nobody in front of a form. The sign-in's address field
    and its row of digit boxes are what would be on screen if it had."""
    for what, selector in (
        ("an address field", "input[type=email]"),
        ("the code boxes", ".digits"),
    ):
        if page.locator(selector).count():
            wrong(f"[{label}] the link asked for {what}")


def settled(page: Page, label: str) -> None:
    """Waits until the surface a first pass holds has lifted, so a photograph of
    what somebody landed in is of the app rather than of the way in."""
    wait_for(page, "() => !document.querySelector('.arriving')", f"[{label}] the first pass")
    page.wait_for_timeout(250)


def rename(page: Page, name: str) -> None:
    """A guest renaming themselves: the face at the left of the panel's foot,
    whose menu's Account opens the account pane, and the one field in it.

    There is no Save. The field is what the app holds, so leaving it is what
    writes it, which is what every other field in the settings does."""
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

    who = page.locator("aside .foot button.who")
    who.wait_for(state="visible", timeout=10_000)
    page.wait_for_timeout(400)
    who.click()
    entry = page.locator(".menu [role=menuitem]").filter(has_text="Account")
    entry.wait_for(state="visible", timeout=10_000)
    entry.click()

    field = page.locator(".sheet .body input.inline").first
    field.wait_for(state="visible", timeout=10_000)
    field.fill(name)
    field.press("Enter")

    wait_for(
        page,
        f"() => window.nibApp.account.guest?.name === {json.dumps(name)}",
        f"the guest to be called {name}",
    )

    # Out of the settings, or the scrim is what the next photograph is of.
    dismiss(page)


def set_link(token: str, space_id: str, role: str, mode: str) -> None:
    """What the space's one link hands out. The owner's, from the same sheet as
    everything else about it; asked for here so that one link can be followed at
    each of the three settings without three sheets in between."""
    request(
        f"/v1/spaces/{space_id}/share/link",
        token,
        {"role": role, "mode": mode},
        method="PUT",
    )


def set_item_link(token: str, space_id: str, note_id: str, role: str, mode: str) -> None:
    """The same one switch, about one file of the space rather than the space: it
    is the same route with the note named on it. See docs/sharing.md."""
    request(
        f"/v1/spaces/{space_id}/share/link?item={note_id}",
        token,
        {"role": role, "mode": mode},
        method="PUT",
    )


def show_space(page: Page, name: str) -> None:
    """Brings a space up, so the file list under the header is its files."""
    page.evaluate(
        "(name) => {"
        "  const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
        "  if (space) window.nibApp.workspace.showSpace(space.id)"
        "}",
        name,
    )


def tree_row(page: Page, path: str):
    """A row in the file list, by the path it stands for."""
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

    row = page.locator(f'.row[data-path="{path}"]')
    row.wait_for(state="visible", timeout=10_000)
    return row


def open_the_file_sheet(page: Page, path: str):
    """The Share sheet about one file, opened the way anybody opens it: the row's
    own menu in the file list. The same sheet a space opens, with the file's mark
    and name in its head."""
    # The share names the file's id on the account, so the row has to have been
    # handed over before there is anything to share; see canShareItem.
    wait_for(
        page,
        f"() => !!window.nibApp.sync.tracked({json.dumps(path)})",
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
    """Waits until the account holds that many files other people shared on their
    own. They arrive on the same listing pass the spaces do."""
    wait_for(
        page,
        f"() => window.nibApp.sharedWithYou.items.length === {count}",
        f"[{label}] a file shared on its own",
    )


def landed_alone(page: Page, label: str, note_id: str, wrong) -> None:
    """That a guest a link gave one file to is in that file, in its room, and that
    the window is the file: no bar, no tab strip, no file list, no status bar.
    Every piece of the app's chrome says which edge it is with `data-chrome`."""
    wait_for(
        page,
        f"() => window.nibApp.workspace.active?.note.shared === {json.dumps(note_id)}",
        f"[{label}] the shared file to open by itself",
    )
    wait_for(
        page,
        f"() => window.nibApp.rooms.carries({json.dumps(note_id)})",
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
    """The one thing a guest alone in a file has of the app: their initial in the
    corner, which opens their name and the way to an account. See
    GuestCorner.svelte."""
    corner = page.locator(".guest-corner button.who")
    corner.wait_for(state="visible", timeout=10_000)
    name = page.evaluate("() => window.nibApp.account.guest?.name ?? ''")
    if corner.inner_text().strip() != name.strip()[:1].upper():
        wrong(f"[{label}] the corner says {corner.inner_text()!r} for a guest called {name!r}")

    # A thumb's target on a touch screen, as every other control there is.
    touch = page.evaluate("() => document.documentElement.hasAttribute('data-touch')")
    least = 48 if touch else 24
    box = corner.bounding_box() or {"width": 0, "height": 0}
    if box["width"] < least or box["height"] < least:
        wrong(f"[{label}] the corner is {box['width']}x{box['height']}, under {least}")

    # Clear of what is drawn: nothing of the app's chrome came back with it.
    if corner.evaluate("(one) => !!one.closest('[data-chrome]')"):
        wrong(f"[{label}] the corner is part of the app's chrome")
    return corner


def shared_row(page: Page, name: str):
    """A row in the Shared-with-you section at the foot of the switcher, which is
    where a file that is in no space lives.

    The same locator a space's row uses, because it is the same list drawn in the
    same shapes: a row, its mark, its name, and the button at the end of it."""
    return space_row(page, name)


def typed(page: Page, at: int, said: str) -> None:
    """Real keystrokes into the real editor, at a place in the note."""
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: Math.min(at, window.nib.state.doc.length) } });"
        "  window.nib.focus()"
        "}",
        at,
    )
    page.keyboard.type(said, delay=12)


def agree(one: Page, two: Page, wanted: str) -> None:
    """Waits until both pages hold the same words, and those words hold this."""
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        if words(one) == words(two) and wanted in words(one):
            return
        one.wait_for_timeout(30)

    raise SystemExit(f"the two never agreed on {wanted!r}:\n{words(one)!r}\n{words(two)!r}")


def moved(page: Page, at: int) -> None:
    """A caret put somewhere, which is what makes its name show on the other
    screens: the label is drawn for a moment and a half after a caret moves."""
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: at } });"
        "  window.nib.focus()"
        "}",
        at,
    )


def caret_names(page: Page) -> list[str]:
    return [
        name.strip()
        for name in page.locator(".cm-nib-caret-name").all_inner_texts()
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

        # A second space, which nobody is ever let into. What the last part of
        # this run shares is one file out of it and then one canvas, so anything
        # the other side can reach came from the file's own share and not from the
        # space; see docs/sharing.md.
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

        # ── The owner invites somebody by address ──────────────────
        owner = fresh(browser, "owner", token=owner_token)
        wait_for(
            owner,
            f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
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

        # ── Somebody with no account at all follows it ─────────────
        # No form, no code, no sign-up. The mail was written to that
        # address, so holding it is holding the address, and opening the
        # link is the whole of what they do.
        writer = fresh(browser, "writer", at=f"{ORIGIN}/join/{token}")
        let_in(writer, "writer", keeps=True)
        asked_nothing(writer, "writer", wrong)
        theirs = joined(writer, "writer", space["id"], "write")
        settled(writer, "writer")
        writer.screenshot(path=str(SHOTS / "invited-straight-in.png"))
        say(f"{WRITER} is in {SPACE} without having typed a thing")

        held = writer.evaluate("() => window.nibApp.account.user?.email ?? null")
        if held != WRITER:
            wrong(f"the link opened {held!r} rather than {WRITER}")

        shared = writer.evaluate(
            "(id) => window.nibApp.account.spaces.find((one) => one.id === id)?.shared",
            space["id"],
        )
        if shared is not True:
            wrong(f"the writer's copy of the space says shared={shared!r}")

        # And the link is spent. What it handed out was a session nobody
        # typed a code for, so it hands out no second one.
        spent = fresh(browser, "spent", at=f"{ORIGIN}/join/{token}")
        spent.get_by_text("That link does not open anything").wait_for(timeout=15_000)
        spent.wait_for_timeout(250)
        spent.screenshot(path=str(SHOTS / "used-link.png"))
        if spent.evaluate("() => window.nibApp.account.signedIn"):
            wrong("a used invitation opened a second session")
        say("the same link twice says so once, with the code behind it")
        spent.close()

        # ── Both write in the one note ─────────────────────────────
        open_the_note(owner, "owner", note["id"], SPACE)
        open_the_note(writer, "writer", note["id"], theirs)

        typed(owner, len(OPENING), "from the owner\n")
        typed(writer, 0, "from the writer\n")
        agree(owner, writer, "from the owner")
        if "from the writer" not in words(owner):
            wrong("what the invited person wrote never reached the owner")
        say("both of them hold the same words")

        # ── And each sees the other, by name ───────────────────────
        moved(writer, 3)
        owner.wait_for_selector(".cm-nib-caret", timeout=10_000)
        owner.wait_for_timeout(150)
        names = caret_names(owner)
        owner.locator(".cm-editor").first.screenshot(path=str(SHOTS / "named-caret.png"))

        # The name on the account, else the front of the address. This
        # one never chose a name, so it is `writer`.
        if names != ["writer"]:
            wrong(f"the caret is labelled {names!r} rather than the person")
        else:
            say("the caret carries the person's name rather than the device's")

        # The switcher marks the space as one somebody else is in.
        space_row(owner)
        owner.wait_for_timeout(200)
        owner.locator("aside .spaces").screenshot(
            path=str(SHOTS / "shared-in-the-switcher.png")
        )
        # The mark the whole app says this with, which used to be a dot in
        # the accent and is SharedMark.svelte now; see batch 70.
        if not owner.locator("aside .spaces .shared").count():
            wrong("the switcher does not mark the space as shared")

        # ── The link the space itself holds ────────────────────────
        sheet = open_the_share_sheet(owner)
        # One switch makes the link; `Ask first` comes on with it, and is
        # the same switch again to turn off.
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

        # What the link hands out is the owner's, from the same sheet.
        # Set here rather than clicked so the one link can be followed
        # three times over, which is what the rest of this run does.
        set_link(owner_token, space["id"], "write", "open")

        # ── A guest, named after their device, writing ─────────────
        guest = fresh(browser, "guest", at=f"{ORIGIN}/join/{link}")
        let_in(guest, "guest")
        asked_nothing(guest, "guest", wrong)
        mine = joined(guest, "guest", space["id"], "write")
        say(f"the link put a guest in {SPACE}, to write")

        if guest.evaluate("() => window.nibApp.account.user"):
            wrong("the link made an account rather than a guest")

        named = guest.evaluate("() => window.nibApp.account.guest?.name ?? null")
        # A device and an animal. Which device word it is depends on what
        # the browser calls itself - Chrome, Firefox, Chromium - and that
        # is browser.ts's business rather than this run's.
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

        # ── One tap renames them, and the others see it ────────────
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

        # ── The same link, once it hands out reading ───────────────
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

        # And nothing of it reached anybody else, or the account.
        owner.wait_for_timeout(600)
        if "this should go nowhere" in words(owner):
            wrong("what a reader typed crossed to the owner")

        stored = request(f"/v1/notes/{note['id']}", owner_token)["content"]
        if "this should go nowhere" in stored:
            wrong("what a reader typed reached the account")

        # A reader is offered nothing to change the space with either.
        space_row(reader, here).locator(".more").click()
        reader.wait_for_selector('.menu[role="menu"]', timeout=10_000)
        # The menu that was opened, and not the switcher's rows behind
        # it, which are menu items of their own.
        offered = reader.locator('.menu [role="menuitem"]').all_inner_texts()
        dismiss(reader)
        if any(word in " ".join(offered) for word in ("New note", "Rename", "Share")):
            wrong(f"a reader is offered {offered!r}")
        else:
            say(f"a reader's menu offers only {offered!r}")

        # ── The same link, once it asks first ──────────────────────
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
            "(id) => window.nibApp.account.spaces.some((one) => one.id === id)",
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

        # The page that was waiting asks again on its own, and turns into
        # the space when the answer changes.
        joined(waiting, "waiting", space["id"], "read")
        waiting.wait_for_timeout(400)
        waiting.screenshot(path=str(SHOTS / "guest-let-in.png"))
        if waiting.get_by_role("dialog").count():
            wrong("the waiting page is still up after the owner accepted")
        say("the calm page turned into the space, with nothing pressed")

        # ── One note, shared on its own ────────────────────────────
        # Not the space: the space this file sits in is shared with
        # nobody, and stays that way. The sheet is the same sheet, opened
        # from the file's own row.
        show_space(owner, SOLO)
        owner.wait_for_timeout(300)
        sheet = open_the_file_sheet(owner, f"/{SOLO}/{ITEM}")
        owner.wait_for_timeout(200)
        sheet.screenshot(path=str(SHOTS / "share-a-note.png"))

        # Its head says which file, not which space.
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

        # ── The other side: a row, not a space ─────────────────────
        alone = fresh(browser, "alone", at=f"{ORIGIN}/join/{token}")
        let_in(alone, "alone", keeps=True)
        asked_nothing(alone, "alone", wrong)
        shared_with_you(alone, "alone")
        settled(alone, "alone")
        say(f"{ALONE} is in, holding one file")

        # Not the space it came out of, and no folder mirroring it: that is
        # the whole point of an item share. Their own space is there,
        # because every new account is given one; see spaces/first.ts.
        held = alone.evaluate(
            "(id) => window.nibApp.account.spaces.some((one) => one.id === id)",
            solo["id"],
        )
        if held:
            wrong("one shared note brought the space it came out of with it")

        folder = alone.evaluate(
            "(id) => window.nibApp.workspace.spaces.some("
            "  (one) => window.nibApp.sync.remoteIdFor(one.root) === id)",
            solo["id"],
        )
        if folder:
            wrong("one shared note made a folder for somebody else's space")

        # It is at the foot of the switcher, under whoever shared it.
        row = shared_row(alone, ITEM[:-3])
        alone.wait_for_timeout(250)
        alone.locator("aside .spaces").screenshot(
            path=str(SHOTS / "shared-with-you.png")
        )
        if not alone.locator("aside .spaces .from").count():
            wrong("the shared file is not grouped under whoever shared it")
        if not row.locator(".shared").count():
            wrong("the shared file's row does not wear the shared mark")

        # Opening it opens a tab, whose words came through the wire and
        # whose keystrokes go through the file's room.
        row.locator(".nib-row").click()
        wait_for(
            alone,
            "() => !!window.nibApp.workspace.active?.note.shared",
            "[alone] the shared note to open in a tab",
        )
        wait_for(
            alone,
            f"() => window.nibApp.rooms.carries({json.dumps(one['id'])})",
            "[alone] the shared note to join its room",
        )
        alone.wait_for_timeout(250)
        alone.screenshot(path=str(SHOTS / "shared-note-open.png"))
        if not alone.locator(".tab .shared").count():
            wrong("the tab on a shared file does not wear the shared mark")
        say("the note opened in a tab of its own, in its room, with the mark")

        # And the owner, in the same file from their own tree.
        open_the_file(owner, "owner", one["id"], f"/{SOLO}/{ITEM}")
        typed(owner, len(ITEM_OPENING), "from the owner\n")
        typed(alone, 0, "from the one person\n")
        agree(owner, alone, "from the owner")
        if "from the one person" not in words(owner):
            wrong("what the one person wrote never reached the owner")
        say("both of them hold the same words, with no space between them")

        # Nothing else of that space is reachable from there.
        # The page and the Worker are the same origin here, so the ask is
        # the one the app itself would make, with the app's own session.
        reachable = alone.evaluate(
            "async (id) => {"
            "  const answer = await fetch(`/v1/notes/${id}`,"
            "    { headers: { authorization: `Bearer ${window.nibApp.account.token}` } });"
            "  return answer.status"
            "}",
            plane["id"],
        )
        if reachable != 404:
            wrong(f"the canvas beside the shared note answered {reachable}")
        else:
            say("the file beside it is a file that does not exist")

        # ── The same file on a phone ───────────────────────────────
        held = alone.evaluate("() => localStorage.getItem('nib:session')")
        phone = fresh(browser, "phone", token=held, viewport=PHONE)
        shared_with_you(phone, "phone")
        settled(phone, "phone")
        shared_row(phone, ITEM[:-3])
        phone.wait_for_timeout(300)
        phone.screenshot(path=str(SHOTS / "shared-with-you-phone.png"))

        shared_row(phone, ITEM[:-3]).locator(".nib-row").click()
        wait_for(
            phone,
            "() => !!window.nibApp.workspace.active?.note.shared",
            "[phone] the shared note to open",
        )
        phone.wait_for_timeout(400)
        phone.screenshot(path=str(SHOTS / "shared-note-phone.png"))
        say("the same row and the same tab under a thumb")

        # ── One canvas, by a link ──────────────────────────────────
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
        if drawer.evaluate("() => window.nibApp.account.user"):
            wrong("a link to one canvas made an account rather than a guest")

        # Nothing to press: a link to one file opens it, and the guest who has no
        # account sees that file and none of the app round it (#386).
        landed_alone(drawer, "drawer", plane["id"], wrong)
        drawer.screenshot(path=str(SHOTS / "shared-canvas.png"))
        say("a guest with no account is drawing on one shared canvas, and sees nothing else")

        if drawer.evaluate("() => window.nibApp.account.spaces.length"):
            wrong("a link to one canvas handed over a space as well")

        # A shared file has no path, so no tab of it outlives the page: coming back
        # is the file again, alone, rather than the app round an empty space.
        drawer.reload(wait_until="domcontentloaded")
        wait_for(drawer, "() => !!window.nibApp", "[drawer] the app to start again")
        landed_alone(drawer, "drawer", plane["id"], wrong)
        say("the guest who came back is back in the canvas, alone")

        # The same link on a phone: the same canvas, the same nothing round it.
        thumb = fresh(browser, "thumb", at=f"{ORIGIN}/join/{found.group(1)}", viewport=PHONE)
        let_in(thumb, "thumb")
        landed_alone(thumb, "thumb", plane["id"], wrong)
        guest_corner(thumb, "thumb", wrong)
        thumb.screenshot(path=str(SHOTS / "shared-canvas-phone.png"))
        say("and on a phone, with the guest's corner")

        # Somebody with an account keeps the app round the same file: they have
        # more than it to move between.
        if not owner.locator('[data-chrome="top"]').count():
            wrong("the owner lost the app's bar")

        # ── A guest alone in one note: their corner ────────────────
        # The chrome went, and with it the foot of the panel a guest renamed
        # themselves and signed in from. The corner is what is left of it.
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
            "() => window.nibApp.account.guest?.name === 'Grace'",
            "[named] the guest to be called Grace",
        )
        if corner.inner_text().strip() != "G":
            wrong(f"the corner says {corner.inner_text()!r} after the guest became Grace")
        named.keyboard.press("Escape")

        # The owner, in the same note, reads the new name over the guest's caret.
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

        # On a phone the words run the width of the screen, and the corner is still
        # clear of them: the note's first line starts below it.
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

        # A tap opens it inside the screen, and a tap past it shuts it.
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

        # Sign in: the app's own sign-in, and the file is still there after it.
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
        wait_for(named, "() => !!window.nibApp.account.user", "[named] the account")
        wait_for(
            named,
            f"() => window.nibApp.workspace.active?.note.shared === {json.dumps(one['id'])}",
            "[named] the shared note to still be open once signed in",
        )
        settled(named, "named")
        if named.locator(".guest-corner button.who").count():
            wrong("the guest's corner stayed after signing in")
        named.screenshot(path=str(SHOTS / "guest-corner-signed-in.png"))
        say("signed in from the corner, and still in the file, with the app round it")

        # ── Taking it back ────────────────────────────────────────
        request(
            f"/v1/spaces/{solo['id']}/share/members/{ALONE}?item={one['id']}",
            owner_token,
            method="DELETE",
        )

        wait_for(
            alone,
            "() => window.nibApp.sharedWithYou.items.length === 0",
            "[alone] the row to go once it was taken back",
        )
        wait_for(
            alone,
            "() => !window.nibApp.workspace.tabs.some((tab) => tab.note.shared)",
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
