"""A page note's paper goes wherever the note goes (#551).

Emil: "The pdf is part of the pages note, right? Cause if I open it after it was shared
it says that there was some mistake and the page couldn't load." A page note made from
a PDF holds the PDF; on another device, or through a link, it opened without it.

So, once on sync v1 and once on sync v2: a PDF is imported on one device and becomes a
page note. A second device signed in to the same account opens the note and every page
of the paper is drawn on its sheet; a guest who follows an open link to the note sees
the same. Counted in pixels, not taken on trust.

The real thing: the built web app, the Worker under `wrangler dev`, three browser
contexts per version. Run it from the repository root:

    python apps/desktop/test/e2e/paper-travels.py
"""

from __future__ import annotations

import base64
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
# How long a file made in the app is given to reach the account, and the other side.
SYNCED = 90

NOTE = "Lecture.pages"

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
        page.wait_for_timeout(200)
    raise SystemExit(f"gave up waiting for {what}")


def paper_bytes(sizes: list[tuple[float, float]]) -> str:
    """A PDF of `sizes` pages, each with a black block on it, as base64; see
    paper-note.py, which makes its paper the same way."""
    objects: list[str] = []
    kids = " ".join(f"{3 + at * 2} 0 R" for at in range(len(sizes)))
    objects.append("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj")
    objects.append(f"2 0 obj<</Type/Pages/Kids[{kids}]/Count {len(sizes)}>>endobj")
    for at, (wide, tall) in enumerate(sizes):
        page = 3 + at * 2
        stream = f"0 0 0 rg 40 40 {wide - 80:.0f} {tall - 80:.0f} re f"
        objects.append(
            f"{page} 0 obj<</Type/Page/Parent 2 0 R"
            f"/MediaBox[0 0 {wide:.2f} {tall:.2f}]/Contents {page + 1} 0 R>>endobj"
        )
        objects.append(f"{page + 1} 0 obj<</Length {len(stream)}>>stream\n{stream}\nendstream\nendobj")
    body = "\n".join(
        ["%PDF-1.4", *objects, f"trailer<</Root 1 0 R/Size {2 + len(sizes) * 2 + 1}>>", "%%EOF"]
    )
    return base64.b64encode(body.encode("latin-1")).decode("ascii")


PAPER = paper_bytes([(595.28, 841.89), (612.0, 792.0)])

IMPORT = """
async ({ base64, name, root }) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  const importing = window.nibApp.importing
  importing.root = root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])
  if (importing.format !== 'pdf-pages') return { format: importing.format, error: importing.error }
  await importing.run()
  await window.nibApp.workspace.loadTree()
  return { format: importing.format, error: importing.error }
}
"""

# How much of each sheet is not the colour of the sheet; see pages.py.
DARK_ON_SHEETS = """
() => [...document.querySelectorAll('.sheet canvas')].map((sheet) => {
  const context = sheet.getContext('2d', { willReadFrequently: true })
  if (!context || !sheet.width || !sheet.height) return 0
  const data = context.getImageData(0, 0, sheet.width, sheet.height).data
  let dark = 0
  for (let at = 0; at < data.length; at += 160) {
    if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
  }
  return dark
})
"""


# Whether the browser's store holds a file's bytes: where the web app keeps a PDF.
KEPT = """
async (path) => {
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const row = await new Promise((resolve) => {
    const asked = db.transaction('assets').objectStore('assets').get(path)
    asked.onsuccess = () => resolve(asked.result ?? null)
    asked.onerror = () => resolve(null)
  })
  db.close()
  return !!row && typeof row.data === 'string' && row.data.length > 0
}
"""

ENGINE = """() => {
  const engine = window.nibApp.sync.engine?.engine
  if (!engine) return 'no engine'
  return [...engine.core.spaces.values()].map((space) => ({
    root: space.row.root,
    entries: [...space.entries.values()].map((one) => [one.kind, one.local_path, one.seq, one.deleted, one.file_key]),
    outbox: space.outbox.map((one) => JSON.stringify(one.record).slice(0, 200)),
  }))
}"""


def device(browser: Browser, label: str, at: str, token: str | None = None) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900})
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp", f"[{label}] the app")
    return page


def space_root(page: Page, label: str, space: str) -> str:
    return wait_for(
        page,
        "(id) => { const space = window.nibApp.workspace.spaces.find("
        "  (one) => window.nibApp.sync.remoteIdFor(one.root) === id);"
        " if (!space) return null; window.nibApp.workspace.showSpace(space.id); return space.root }",
        f"[{label}] the space",
        space,
        patience=SYNCED,
    )


def drawn(page: Page, label: str, pages: int) -> None:
    """Every page of the paper is on its sheet."""
    try:
        wait_for(
            page,
            f"() => {{ const d = ({DARK_ON_SHEETS})(); return d.length === {pages} && d.every((n) => n >= 100) }}",
            f"[{label}] every page of the paper to be drawn",
            patience=SYNCED,
        )
        say(f"[{label}] every page of the paper is drawn: {page.evaluate(DARK_ON_SHEETS)}")
    except SystemExit as gave_up:
        failed(f"{gave_up}: {page.evaluate(DARK_ON_SHEETS)}")
    page.screenshot(path=str(SHOTS / f"{label}.png"))


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


def one_version(browser: Browser, worker: harness.Worker, version: int) -> None:
    say(f"--- sync v{version} ---")
    email = f"paper-v{version}@example.com"
    token = worker.account(email)
    if version == 2:
        worker.sql(f"update users set sync_version = 2 where email = '{email}'")
    space = worker.request("/v1/spaces", token=token, body={"name": f"Papers {version}"})["space"]

    owner = device(browser, f"v{version}-owner", ORIGIN, token)
    wait_for(owner, "() => !!window.nibApp?.account.user", f"[v{version}-owner] the account")
    if owner.evaluate("() => window.nibApp.sync.version") != version:
        failed(f"[v{version}] the owner is not on sync v{version}")
    root = space_root(owner, f"v{version}-owner", space["id"])
    made = owner.evaluate(IMPORT, {"base64": PAPER, "name": "Lecture.pdf", "root": root})
    if made.get("format") != "pdf-pages" or made.get("error"):
        raise SystemExit(f"[v{version}] the import did not make a page note: {made}")
    path = wait_for(
        owner,
        "(name) => window.nibApp.workspace.files.find((one) => one.path.endsWith('/' + name))?.path",
        f"[v{version}-owner] the page note in the list",
        NOTE,
    )
    inside = path[len(root) :]
    owner.evaluate("(path) => window.nibApp.workspace.openEntry(path)", path)
    drawn(owner, f"v{version}-owner", 2)
    try:
        note = wait_for(
            owner,
            "(path) => window.nibApp.sync.tracked(path)?.id ?? null",
            f"[v{version}-owner] the page note on the account",
            path,
            patience=SYNCED,
        )
    except SystemExit:
        say(json.dumps(owner.evaluate(ENGINE)))
        raise
    say(f"[v{version}] the owner holds {NOTE} as {note}")
    if version == 2:
        # One thing in the tree, the note: its paper goes as part of it, not as a file.
        tree = owner.evaluate(ENGINE)
        files = [one[1] for space in tree for one in space["entries"] if one[0] == "file" and not one[3]]
        if files:
            failed(f"[v2] the paper is a file of the tree beside its note: {files}")

    # ── The same account on a second device ───────────────────────
    second = device(browser, f"v{version}-second", ORIGIN, token)
    there = space_root(second, f"v{version}-second", space["id"])
    wait_for(
        second,
        "(path) => window.nibApp.workspace.files.some((one) => one.path === path)",
        f"[v{version}-second] the page note in the list",
        there + inside,
        patience=SYNCED,
    )
    second.evaluate("(path) => window.nibApp.workspace.openEntry(path)", there + inside)
    drawn(second, f"v{version}-second", 2)
    # And kept there, so the note opens with its paper with no account in reach.
    try:
        wait_for(
            second,
            KEPT,
            f"[v{version}-second] the paper kept beside the note",
            there + inside + ".pdf",
        )
        say(f"[v{version}-second] the paper is kept beside the note")
    except SystemExit as gave_up:
        failed(str(gave_up))

    # ── A guest, by an open link to the note ──────────────────────
    guest = device(browser, f"v{version}-guest", link_to(worker, token, space["id"], note))
    try:
        wait_for(guest, "() => !!window.nibApp.workspace.active?.note.shared", f"[v{version}-guest] the shared tab")
        drawn(guest, f"v{version}-guest", 2)
    except SystemExit as gave_up:
        failed(str(gave_up))

    for page in (owner, second, guest):
        page.context.close()


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
        for version in (2, 1):
            try:
                one_version(browser, worker, version)
            except SystemExit as gave_up:
                failed(str(gave_up))

    if wrong:
        print("\nFAILED", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\na page note's paper goes with it, to another device and to a guest", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
