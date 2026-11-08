from __future__ import annotations

import json
import subprocess

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

ROW = ".sheet .setting.pressable"

RELEASE = json.loads((harness.APP / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
COMMIT = subprocess.run(
    ["git", "rev-parse", "--short", "HEAD"], cwd=harness.APP, capture_output=True, text=True, check=False
).stdout.strip()
VERSION = f"{RELEASE} ({COMMIT})" if COMMIT else RELEASE

def fresh(browser: Browser, finger: bool) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 820},
        has_touch=finger,
        is_mobile=finger,
        permissions=["clipboard-read", "clipboard-write"],
        **({"user_agent": PHONE} if finger else {}),
    )
    DRIVE.open(page)
    return page

def clipboard(page: Page) -> str:
    return str(page.evaluate("() => navigator.clipboard.readText()"))

def settings(page: Page, label: str, version: str) -> None:
    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, f"!!document.querySelector({ROW!r})", f"[{label}] the Version row")
    row = page.locator(ROW).filter(has_text="Version").last
    row.scroll_into_view_if_needed()
    said = row.locator(".said").inner_text().strip()
    say(f"[{label}] the row says {said!r}")
    if said != f"{version}, Stable":
        wrong(f"[{label}] Version says {said!r}, not the build and its channel")
    shot(page, f"{label}-settings")

    page.evaluate("() => navigator.clipboard.writeText('')")
    row.click()
    page.wait_for_timeout(300)
    if clipboard(page) != version:
        wrong(f"[{label}] a press on Version copied {clipboard(page)!r}")
    if row.locator(".said").inner_text().strip() != "Copied":
        wrong(f"[{label}] the row does not say it copied")
    shot(page, f"{label}-copied")
    page.evaluate("() => (window.ordenApp.settings.open = false)")
    page.wait_for_timeout(1800)

def searched(page: Page, label: str, version: str) -> None:
    for word in ("about", "version"):
        page.locator("body").click(position={"x": 600, "y": 400})
        for _ in range(2):
            page.keyboard.down("Shift")
            page.keyboard.up("Shift")
            page.wait_for_timeout(60)
        wait_for(page, "!!document.querySelector('.palette input')", f"[{label}] the palette")
        page.keyboard.type(word)
        page.wait_for_timeout(400)
        first = page.locator(".palette [role=option]").first
        text = first.inner_text()
        say(f"[{label}] {word!r} finds first: {' '.join(text.split())!r}")
        if "Version" not in text or version not in text:
            wrong(f"[{label}] {word!r} does not find the version first: {text!r}")
        shot(page, f"{label}-search-{word}")
        page.evaluate("() => navigator.clipboard.writeText('')")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        if clipboard(page) != version:
            wrong(f"[{label}] Enter on {word!r} did not copy the version: {clipboard(page)!r}")
        if not page.evaluate("() => !!document.querySelector('.palette input')"):
            wrong(f"[{label}] the palette went away after copying")
        page.keyboard.press("Escape")
        page.wait_for_timeout(1800)

def drive(browser: Browser) -> None:
    for label, finger in (("desktop", False), ("phone", True)):
        page = fresh(browser, finger)
        settings(page, label, VERSION)
        if not finger:
            searched(page, label, VERSION)
        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the version is in Settings and the search, and copies"))
