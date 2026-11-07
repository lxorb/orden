
from __future__ import annotations

from collections.abc import Callable

from playwright.sync_api import Browser, Error as PlaywrightError, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WS = "window.nibApp.workspace"
ON_SCREEN = "ONLY-IN-THE-SESSION"
IN_A_SET = "WORDS-IN-A-SET-OUT-OF-SIGHT"

WATCH = """
(() => {
  const armed = sessionStorage.getItem('launch-close');
  if (!armed) return;
  sessionStorage.removeItem('launch-close');
  // The session written as the window goes, and nothing after it: the page goes on running
  // for a moment after a reload is asked for, and a launch ending in that moment shows nothing.
  const go = (ws) => {
    ws.persist();
    ws.persist = () => true;
    sessionStorage.setItem('launch-closed', '1');
    location.reload();
  };
  const every = setInterval(() => {
    const ws = window.nibApp && window.nibApp.workspace;
    if (!ws) return;
    if (armed === 'persist') {
      ws.persist();
      const session = localStorage.getItem('orden:workspace') ?? '';
      if (!session.includes('ONLY-IN-THE-SESSION') || !session.includes('WORDS-IN-A-SET-OUT-OF-SIGHT')) {
        sessionStorage.setItem('launch-lost', '1');
      }
      if (ws.restored && ws.setsWritten() !== ws.setsRead && ws.tabs.length > 2) clearInterval(every);
    } else if (armed === 'list up') {
      if (ws.tree && !ws.tabs.length) { clearInterval(every); go(ws); }
    } else if (ws.restored && ws.setsWritten() !== ws.setsRead) {
      if (!ws.tabs.some((tab) => tab.note.latest.includes('""" + IN_A_SET + """'))) {
        clearInterval(every);
        go(ws);
      }
    }
  }, 0);
})();
"""

def type_draft(page: Page, words: str) -> None:
    page.evaluate(f"()=>{WS}.openBlank()")
    page.wait_for_selector(".cm-content")
    page.locator(".cm-content").first.click()
    page.keyboard.type(words, delay=2)
    wait_for(page, f"()=>{WS}.active?.note.latest.includes({words!r})", "typed")

def through_reload(page: Page, ask: Callable[[], object]) -> None:
    for _ in range(100):
        try:
            ask()
            return
        except PlaywrightError as error:
            if "destroyed" not in str(error) and "navigat" not in str(error):
                raise
            page.wait_for_timeout(100)
    wrong("the page never came back from its reload")

def kept_through(page: Page, armed: str, fires: bool, total: int) -> None:
    page.evaluate(f"()=>{WS}.persist()")
    page.evaluate("(armed)=>sessionStorage.setItem('launch-close', armed)", armed)
    page.reload(wait_until="commit")
    if fires:
        through_reload(
            page,
            lambda: wait_for(
                page, "()=>sessionStorage.getItem('launch-closed')==='1'", f"the window went: {armed}"
            ),
        )
        through_reload(page, lambda: page.evaluate("()=>sessionStorage.removeItem('launch-closed')"))
    through_reload(page, lambda: DRIVE.ready(page))
    for words in (ON_SCREEN, IN_A_SET):
        wait_for(
            page,
            f"()=>{WS}.tabs.some(t=>t.note.latest.includes({words!r}))",
            f"{words} back after: {armed}",
            15,
        )
    if page.evaluate("()=>sessionStorage.getItem('launch-lost')"):
        wrong(f"{armed}: a session written in the launch held neither draft or only one")
    tabs = page.evaluate(f"()=>{WS}.tabs.length")
    say(f"{armed}: both drafts back, {tabs} tabs")
    if tabs != total:
        wrong(f"{armed}: {tabs} tabs came back, not {total}")

def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    ctx.add_init_script(WATCH)
    page = ctx.new_page()
    DRIVE.open(page)
    first = page.evaluate(f"()=>{WS}.activeSpaceId")
    type_draft(page, ON_SCREEN)

    other = page.evaluate(f"async()=>{{const made=await {WS}.addSpace('Other'); return made?.id ?? made}}")
    page.evaluate(f"(id)=>{WS}.selectSpace(id)", other)
    wait_for(page, f"()=>{WS}.activeSpaceId==={other!r}", "in the other space")
    DRIVE.seed(page, *[f"# S{at}\n\nwords {at}\n" for at in range(10)])
    for at in range(10):
        page.evaluate(
            f"""async()=>{{const ws={WS};
            const note=ws.notes.find(one=>one.name.startsWith('S{at}'));
            await ws.openEntry(note.path,{{activate:true}}); ws.keep(ws.active.id)}}"""
        )
    type_draft(page, IN_A_SET)
    page.evaluate(f"(id)=>{WS}.selectSpace(id)", first)
    wait_for(page, f"()=>{WS}.activeSpaceId==={first!r}", "back in the first space")
    total = page.evaluate(f"()=>{WS}.tabs.length")
    say(f"before: {total} tabs")

    kept_through(page, "persist", False, total)
    kept_through(page, "list up", True, total)
    kept_through(page, "set building", True, total)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
