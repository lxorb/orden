#!/usr/bin/env python3
"""Two windows, two sessions (H2-DESKTOP-12): two pages on one origin share storage as two
windows of the app do. A draft in the first survives the second writing last, the second
opens with no copies of the first's tabs, and the next launch has the first's arrangement
and the words the second left."""

from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
TABS = "()=>window.nibApp.workspace.tabs.map(t=>t.note.latest)"


def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = ctx.new_page()
    b.goto(a.url)
    DRIVE.ready(b)
    if b.evaluate("()=>window.nibApp.workspace.tabs.length"):
        wrong("a new window opened with copies of the first's tabs")

    a.bring_to_front()
    a.evaluate("()=>window.nibApp.workspace.openBlank()")
    a.wait_for_selector(".cm-content")
    a.locator(".cm-content").first.click()
    a.keyboard.type("ONLY IN WINDOW A", delay=2)
    b.bring_to_front()
    b.evaluate("()=>window.nibApp.workspace.openBlank()")
    b.wait_for_selector(".cm-content")
    b.locator(".cm-content").first.click()
    b.keyboard.type("ONLY IN WINDOW B", delay=2)
    a.evaluate("()=>window.nibApp.workspace.persist()")
    b.evaluate("()=>window.nibApp.workspace.persist()")
    say("both drafts written down, B last")

    a.close(run_before_unload=True)
    b.close(run_before_unload=True)
    c = ctx.new_page()
    c.goto(DRIVE.origin)
    DRIVE.ready(c)
    wait_for(
        c,
        "()=>window.nibApp.workspace.tabs.some(t=>t.note.latest.includes('WINDOW B'))",
        "the words of the window that went come along",
    )
    tabs = c.evaluate(TABS)
    say(f"next launch: {tabs}")
    if not any("ONLY IN WINDOW A" in one for one in tabs):
        wrong("the first window's draft is gone")
    if not c.evaluate("()=>localStorage.getItem('nib:workspace:1')===null"):
        wrong("the second window's entry stayed behind its words")
    c.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
