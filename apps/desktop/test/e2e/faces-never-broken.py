from __future__ import annotations

import json
import struct
import sys
import time
import zlib
from pathlib import Path

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

OWNER = "faces-owner@example.com"
MEMBER = "faces-member@example.com"
SPACE = "Faces"
GONE = "f" * 64

PATIENCE = 40

MAIN_FOOT = "[data-sidebar] .foot"
SHEET = "[role=dialog]"

BROKEN = (
    "(where) => [...document.querySelectorAll(where + ' img')].filter("
    "  (img) => img.complete && img.naturalWidth === 0 && img.getClientRects().length > 0"
    ").map((img) => img.getAttribute('src'))"
)
DRAWN = (
    "([where, hash]) => [...document.querySelectorAll(where + ' img')].some("
    "  (img) => img.src.includes(hash) && img.complete && img.naturalWidth > 0)"
)
INITIAL = (
    "([where, letter]) => [...document.querySelectorAll(where + ' .orden-badge, ' + where + ' .initial')]"
    ".some((one) => one.textContent.trim() === letter && !one.querySelector('img'))"
)


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)


def picture() -> Path:
    width, height = 96, 72
    rows = b"".join(
        b"\x00" + bytes(value for x in range(width) for value in (x * 2, y * 3, 160))
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )
    path = SHOTS / "face.png"
    path.write_bytes(png)
    return path


def wait_for(page: Page, script: str, what: str, arg: object = None, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    page.screenshot(path=str(SHOTS / "gave-up.png"))
    raise SystemExit(f"gave up waiting for {what}")


def signed_in(browser: Browser, token: str, label: str, gone: bool = False) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, reduced_motion="reduce")
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    if gone:
        context.route("**/i/*", lambda route: route.fulfill(status=404, body="Not found"))
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp && window.ordenApp.account.signedIn", f"[{label}] the session")
    return page


def wear_a_face(page: Page) -> dict:
    page.evaluate("() => window.ordenApp.settings.show('account')")
    change = page.get_by_role("button", name="Change", exact=True)
    change.wait_for(timeout=30_000)
    change.click()
    with page.expect_file_chooser() as chosen:
        page.get_by_role("menuitem", name="Choose a picture").click()
    chosen.value.set_files(str(picture()))
    page.get_by_role("dialog", name="Profile picture").wait_for(timeout=10_000)
    page.wait_for_selector(".window canvas", timeout=10_000)
    page.get_by_role("button", name="Keep", exact=True).click()
    face = wait_for(page, "() => window.ordenApp.account.user?.avatar ?? null", "the face to be worn")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return face


def show_share(page: Page) -> None:
    page.evaluate(
        "(name) => { const space = window.ordenApp.workspace.spaces.find((one) => one.name === name);"
        " return window.ordenApp.share.show(space) }",
        SPACE,
    )
    page.get_by_role("dialog").wait_for(timeout=10_000)


def main() -> int:
    worker = Worker()
    failures: list[str] = []

    def none_broken(page: Page, where: str, what: str) -> None:
        broken = page.evaluate(BROKEN, where)
        if broken:
            failures.append(f"{what} shows a broken picture: {broken}")
        else:
            say(f"{what}: no broken picture")

    with DRIVE.session() as browser:
        worker.start()
        owner_token = worker.account(OWNER)
        worker.account(MEMBER)
        space = worker.request("/v1/spaces", owner_token, {"name": SPACE})["space"]
        worker.request(f"/v1/spaces/{space['id']}/share/invite", owner_token, {"email": MEMBER, "role": "write"})

        owner = signed_in(browser, owner_token, "owner")
        face = wear_a_face(owner)
        letter = owner.evaluate("() => window.ordenApp.account.name.trim().charAt(0).toUpperCase()")
        say(f"the owner wears {face['s'][:12]}…, initial {letter}")

        wait_for(owner, DRAWN, "the face drawn in the main sidebar", [MAIN_FOOT, face["s"]])
        none_broken(owner, MAIN_FOOT, "the main sidebar")

        show_share(owner)
        wait_for(owner, DRAWN, "the face drawn on the Share sheet", [SHEET, face["s"]])
        none_broken(owner, SHEET, "the Share sheet")
        owner.locator(SHEET).screenshot(path=str(SHOTS / "share-face.png"))
        owner.keyboard.press("Escape")
        owner.wait_for_timeout(300)

        owner.evaluate(
            "(gone) => { const account = window.ordenApp.account;"
            " account.user = { ...account.user, avatar: { s: gone, l: gone } } }",
            GONE,
        )
        wait_for(owner, INITIAL, "the initial in the main sidebar once the picture is gone", [MAIN_FOOT, letter])
        none_broken(owner, MAIN_FOOT, "the main sidebar with its picture gone")

        gone = signed_in(browser, owner_token, "gone", gone=True)
        wait_for(gone, INITIAL, "the initial in the main sidebar when pictures fail", [MAIN_FOOT, letter])
        none_broken(gone, MAIN_FOOT, "the main sidebar when pictures fail")
        wait_for(gone, f"() => window.ordenApp.workspace.spaces.some((one) => one.name === {SPACE!r})", "the space")
        show_share(gone)
        wait_for(gone, INITIAL, "the initial on the Share sheet when pictures fail", [SHEET, letter])
        none_broken(gone, SHEET, "the Share sheet when pictures fail")
        gone.locator(SHEET).screenshot(path=str(SHOTS / "share-initial.png"))

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nno broken picture in the main sidebar or the Share sheet, loaded or failed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
