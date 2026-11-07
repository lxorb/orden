
from __future__ import annotations

import time

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WS = "window.ordenApp.workspace"
MODES = {
    "hang": "LockManager.prototype.request = function(){ return new Promise(()=>{}) }",
    "reject": "LockManager.prototype.request = function(){ return Promise.reject(new DOMException('no','SecurityError')) }",
    "throw": "LockManager.prototype.request = function(){ throw new DOMException('no','SecurityError') }",
}
STARTS_WITHIN = 15

def type_in(page: Page, words: str) -> None:
    page.bring_to_front()
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(words, delay=2)

def drive(browser: Browser) -> None:
    for mode, script in MODES.items():
        ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
        ctx.add_init_script(script)
        a = ctx.new_page()
        began = time.time()
        DRIVE.open(a)
        DRIVE.seed(a, "# Both\n\nbase line\n")
        DRIVE.open_note(a, "Both")
        b = ctx.new_page()
        b.goto(a.url)
        DRIVE.ready(b)
        if time.time() - began > 2 * STARTS_WITHIN:
            wrong(f"{mode}: two windows took {time.time() - began:.0f}s to start")
        wait_for(b, f"()=>{WS}.files.some(f=>f.name.startsWith('Both'))", "the list")
        DRIVE.open_note(b, "Both")
        type_in(a, "FROM-A ")
        wait_for(b, f"()=>{WS}.active.note.latest.includes('FROM-A')", f"{mode}: B hears A", patience=20)
        type_in(b, "FROM-B ")
        wait_for(a, f"()=>{WS}.active.note.latest.includes('FROM-B')", f"{mode}: A hears B", patience=20)
        say(f"{mode}: held")
        ctx.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
