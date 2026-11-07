from __future__ import annotations

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

def deck(name: str) -> str:
    return "\n---\n\n".join(f"# {name} {at}\n\nbody {at}\n\nNote: {name} words {at}\n" for at in range(1, 8))

STAGE = "() => document.querySelector('.stage')?.innerText.trim().split('\\n')[0] ?? ''"
HEAD = "() => document.querySelector('.presenter .now')?.innerText.trim().split('\\n')[0] ?? ''"

def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1100, "height": 760})
    ctx.add_init_script("Element.prototype.requestFullscreen = () => Promise.resolve()")
    a = ctx.new_page()
    DRIVE.open(a)
    DRIVE.seed(a, deck("Alpha"), deck("Beta"))
    DRIVE.open_note(a, "Alpha")
    b = ctx.new_page(); b.goto(a.url); DRIVE.ready(b)
    DRIVE.open_note(b, "Beta")
    a.evaluate("() => window.nibApp.present.start()"); a.wait_for_selector(".stage")
    b.evaluate("() => window.nibApp.present.start()"); b.wait_for_selector(".stage")
    a.wait_for_timeout(300)
    with b.expect_popup() as told:
        b.keyboard.press("p")
    p = told.value
    p.wait_for_selector(".presenter", timeout=20000)
    p.wait_for_timeout(500)
    say(f"presenter shows {p.evaluate(HEAD)!r}; A {a.evaluate(STAGE)!r} B {b.evaluate(STAGE)!r}")
    if not p.evaluate(HEAD).startswith("Beta 1"):
        wrong(f"presenter opened from Beta shows {p.evaluate(HEAD)!r}")
    p.keyboard.press("ArrowRight"); p.wait_for_timeout(200)
    p.keyboard.press("ArrowRight"); p.wait_for_timeout(500)
    sa, sb = a.evaluate(STAGE), b.evaluate(STAGE)
    say(f"after two moves: A {sa!r} B {sb!r} presenter {p.evaluate(HEAD)!r}")
    if not sa.startswith("Alpha 1"):
        wrong(f"the presenter of Beta moved Alpha to {sa!r}")
    if not sb.startswith("Beta 3"):
        wrong(f"the presenter did not move Beta: {sb!r}")
    a.keyboard.press("ArrowRight"); a.wait_for_timeout(500)
    if not p.evaluate(HEAD).startswith("Beta 3"):
        wrong(f"Alpha's own move took the presenter: {p.evaluate(HEAD)!r}")
    b.keyboard.press("Escape"); b.wait_for_timeout(300); b.keyboard.press("Escape")
    b.wait_for_timeout(1500)
    say(f"Beta stopped: presenter {'closed' if p.is_closed() else repr(p.evaluate(HEAD))}; B on {b.evaluate('() => window.nibApp.present.on')}")
    if not p.is_closed() and not p.evaluate(HEAD).startswith("Alpha 2"):
        wrong(f"after Beta stopped the presenter shows {p.evaluate(HEAD)!r}, not Alpha 2")
    a.keyboard.press("Escape"); a.wait_for_timeout(300); a.keyboard.press("Escape")
    a.wait_for_timeout(1500)
    say(f"Alpha stopped: presenter closed {p.is_closed()}")
    if not p.is_closed():
        wrong("the presenter stayed open after both shows ended")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "presenter-two"))
