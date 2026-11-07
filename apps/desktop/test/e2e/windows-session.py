
from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
TABS = "()=>window.ordenApp.workspace.tabs.map(t=>t.note.latest)"

def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = ctx.new_page()
    b.goto(a.url)
    DRIVE.ready(b)
    if b.evaluate("()=>window.ordenApp.workspace.tabs.length"):
        wrong("a new window opened with copies of the first's tabs")

    a.bring_to_front()
    a.evaluate("()=>window.ordenApp.workspace.openBlank()")
    a.wait_for_selector(".cm-content")
    a.locator(".cm-content").first.click()
    a.keyboard.type("ONLY IN WINDOW A", delay=2)
    b.bring_to_front()
    b.evaluate("()=>window.ordenApp.workspace.openBlank()")
    b.wait_for_selector(".cm-content")
    b.locator(".cm-content").first.click()
    b.keyboard.type("ONLY IN WINDOW B", delay=2)
    a.evaluate("()=>window.ordenApp.workspace.persist()")
    b.evaluate("()=>window.ordenApp.workspace.persist()")
    say("both drafts written down, B last")

    b.reload()
    DRIVE.ready(b)
    wait_for(b, "()=>window.ordenApp.workspace.tabs.some(t=>t.note.latest.includes('WINDOW B'))", "B back")
    if b.evaluate("()=>window.ordenApp.workspace.tabs.filter(t=>t.note.latest.includes('WINDOW B')).length") != 1:
        wrong("a reload brought a draft back twice")

    a.close(run_before_unload=True)
    b.close(run_before_unload=True)
    c = ctx.new_page()
    c.goto(DRIVE.origin)
    DRIVE.ready(c)
    wait_for(
        c,
        "()=>window.ordenApp.workspace.tabs.some(t=>t.note.latest.includes('WINDOW B'))",
        "the words of the window that went come along",
        patience=30,
    )
    tabs = c.evaluate(TABS)
    say(f"next launch: {tabs}")
    if not any("ONLY IN WINDOW A" in one for one in tabs):
        wrong("the first window's draft is gone")
    if not c.evaluate("()=>localStorage.getItem('orden:workspace:1')===null"):
        wrong("the second window's entry stayed behind its words")
    c.reload()
    DRIVE.ready(c)
    c.wait_for_timeout(1200)
    many = c.evaluate("()=>window.ordenApp.workspace.tabs.filter(t=>t.note.latest.includes('WINDOW')).length")
    if many != 2:
        wrong(f"a reload left {many} tabs of the two drafts")
    c.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
