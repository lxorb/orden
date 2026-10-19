"""Which order a space's file list is read in, the space's on every device (#423).

Emil: "if I turn on manual for one space, it will remain on for that space even on other
devices". Against the real Worker, signed in: a device that chose an order before this
build - kept under `nib:list-order` - carries it to the account the first time; a device
choosing Manual writes it to the space; and a second device signing in reads the space in
Manual without choosing anything.

    python apps/desktop/test/e2e/sort-synced.py
"""

from __future__ import annotations

import json
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()
OWNER = "sorter@example.com"
PATIENCE = 60


def wait(page: Page, script: str, what: str) -> object:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(250)
    raise SystemExit(f"gave up waiting for {what}")


def device(browser: Browser, label: str, token: str, before: str | None = None) -> Page:
    """A device signed in, with Home in front. `before` is what it kept, by Home's folder,
    under the key a build before this one wrote its choice to."""
    context = browser.new_context(viewport={"width": 1280, "height": 820})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    if before is not None:
        context.add_init_script(f"localStorage.setItem('nib:list-order', {json.dumps(before)})")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, "() => window.nibApp?.workspace?.spaces?.some((s) => s.name === 'Home')", f"[{label}] Home")
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace; const s = ws.spaces.find((o) => o.name === 'Home');"
        " if (ws.activeSpace?.id !== s.id) await ws.showSpace(s.id) }"
    )
    return page


def on_account(worker: harness.Worker, space: str) -> str:
    """The space's order as the account holds it; nothing while the Worker is writing."""
    try:
        return str(worker.query(f"select sort from spaces where id = '{space}'")[0]["sort"])
    except (SystemExit, Exception):  # noqa: BLE001 - a busy database is asked again
        return ""


def drive(browser: Browser, worker: harness.Worker, token: str, space: str) -> None:
    # Where this web build keeps Home, read off a device that has never chosen anything.
    probe = device(browser, "probe", token)
    root = probe.evaluate("() => window.nibApp.workspace.activeSpace.root")
    probe.context.close()

    # A device that chose an order before this build, under the old key, and nothing
    # under the new one.
    desk = device(browser, "desk", token, json.dumps({root: "created-desc"}))
    wait(desk, "() => window.nibApp.workspace.sortMode === 'created-desc'", "[desk] the order it had chosen")
    until = time.monotonic() + PATIENCE
    while on_account(worker, space) != "created-desc" and time.monotonic() < until:
        desk.wait_for_timeout(500)
    if on_account(worker, space) != "created-desc":
        wrong(f"[desk] the order chosen before did not reach the account: {on_account(worker, space)!r}")
    else:
        say("ok   [desk] the order chosen before is carried to the account, once")

    # Manual chosen here, as the menu does.
    desk.evaluate("() => window.nibApp.workspace.setSort('manual')")
    until = time.monotonic() + PATIENCE
    while on_account(worker, space) != "manual" and time.monotonic() < until:
        desk.wait_for_timeout(500)
    if on_account(worker, space) != "manual":
        wrong(f"[desk] Manual did not reach the account: {on_account(worker, space)!r}")
    else:
        say("ok   [desk] Manual is written to the space")

    # Another device, which never chose anything.
    other = device(browser, "other", token)
    try:
        wait(other, "() => window.nibApp.workspace.sortMode === 'manual'", "[other] Manual")
        say("ok   [other] the space is read in Manual on another device")
    except SystemExit as gave_up:
        wrong(f"[other] {gave_up}: {other.evaluate('() => window.nibApp.workspace.sortMode')}")


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(OWNER)
        space = worker.request("/v1/spaces", token=token, body={"name": "Home"})["space"]["id"]
        worker.request(f"/v1/spaces/{space}/notes", token=token, body={"path": "Plan.md", "content": "# Plan\n"})
        drive(browser, worker, token, space)
    return DRIVE.verdict("a space's order is the space's on every device")


if __name__ == "__main__":
    raise SystemExit(main())
