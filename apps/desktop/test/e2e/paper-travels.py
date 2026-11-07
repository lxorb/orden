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
  const importing = window.ordenApp.importing
  importing.root = root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])
  if (importing.format !== 'pdf-pages') return { format: importing.format, error: importing.error }
  await importing.run()
  await window.ordenApp.workspace.loadTree()
  return { format: importing.format, error: importing.error }
}
"""

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

KEPT = """
async (path) => {
  const open = indexedDB.open('orden')
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
  const engine = window.ordenApp.sync.engine?.engine
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
        context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
    page.goto(at, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp", f"[{label}] the app")
    return page

def space_root(page: Page, label: str, space: str) -> str:
    return wait_for(
        page,
        "(id) => { const space = window.ordenApp.workspace.spaces.find("
        "  (one) => window.ordenApp.sync.remoteIdFor(one.root) === id);"
        " if (!space) return null; window.ordenApp.workspace.showSpace(space.id); return space.root }",
        f"[{label}] the space",
        space,
        patience=SYNCED,
    )

def drawn(page: Page, label: str, pages: int) -> None:
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
    wait_for(owner, "() => !!window.ordenApp?.account.user", f"[v{version}-owner] the account")
    if owner.evaluate("() => window.ordenApp.sync.version") != version:
        failed(f"[v{version}] the owner is not on sync v{version}")
    root = space_root(owner, f"v{version}-owner", space["id"])
    made = owner.evaluate(IMPORT, {"base64": PAPER, "name": "Lecture.pdf", "root": root})
    if made.get("format") != "pdf-pages" or made.get("error"):
        raise SystemExit(f"[v{version}] the import did not make a page note: {made}")
    path = wait_for(
        owner,
        "(name) => window.ordenApp.workspace.files.find((one) => one.path.endsWith('/' + name))?.path",
        f"[v{version}-owner] the page note in the list",
        NOTE,
    )
    inside = path[len(root) :]
    owner.evaluate("(path) => window.ordenApp.workspace.openEntry(path)", path)
    drawn(owner, f"v{version}-owner", 2)
    try:
        note = wait_for(
            owner,
            "(path) => window.ordenApp.sync.tracked(path)?.id ?? null",
            f"[v{version}-owner] the page note on the account",
            path,
            patience=SYNCED,
        )
    except SystemExit:
        say(json.dumps(owner.evaluate(ENGINE)))
        raise
    say(f"[v{version}] the owner holds {NOTE} as {note}")
    if version == 2:
        tree = owner.evaluate(ENGINE)
        files = [
            one[1]
            for space in tree
            for one in space["entries"]
            if one[0] == "file" and not one[3] and (one[1] or one[2] is not None)
        ]
        if files:
            failed(f"[v2] the paper is a file of the tree beside its note: {files}")

    second = device(browser, f"v{version}-second", ORIGIN, token)
    there = space_root(second, f"v{version}-second", space["id"])
    wait_for(
        second,
        "(path) => window.ordenApp.workspace.files.some((one) => one.path === path)",
        f"[v{version}-second] the page note in the list",
        there + inside,
        patience=SYNCED,
    )
    second.evaluate("(path) => window.ordenApp.workspace.openEntry(path)", there + inside)
    drawn(second, f"v{version}-second", 2)
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

    guest = device(browser, f"v{version}-guest", link_to(worker, token, space["id"], note))
    try:
        wait_for(guest, "() => !!window.ordenApp.workspace.active?.note.shared", f"[v{version}-guest] the shared tab")
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
