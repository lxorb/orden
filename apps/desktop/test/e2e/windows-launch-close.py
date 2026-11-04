#!/usr/bin/env python3
"""A window going in its launch (H4-WINDOWS-1 and 2): the session comes back a piece at a time,
and a session written before a piece is back keeps that piece as it was read. A draft on
screen and one in a set out of sight, through a session written at every moment of a launch,
a reload as the list is up and the tabs are not, and a reload while the set is being built."""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WS = "window.nibApp.workspace"
ON_SCREEN = "ONLY-IN-THE-SESSION"
IN_A_SET = "WORDS-IN-A-SET-OUT-OF-SIGHT"

# Armed for one launch by sessionStorage: what a window going does, at the moment it says.
WATCH = """
(() => {
  const armed = sessionStorage.getItem('launch-close');
  if (!armed) return;
  sessionStorage.removeItem('launch-close');
  const go = () => {
    sessionStorage.setItem('launch-closed', '1');
    location.reload();
  };
  const every = setInterval(() => {
    const ws = window.nibApp && window.nibApp.workspace;
    if (!ws) return;
    if (armed === 'persist') {
      ws.persist();
      if (ws.restored && ws.setsWritten() !== ws.setsRead && ws.tabs.length > 2) clearInterval(every);
    } else if (armed === 'list up') {
      if (ws.tree && !ws.tabs.length) { clearInterval(every); go(); }
    } else if (ws.restored && ws.setsWritten() !== ws.setsRead) {
      if (!ws.tabs.some((tab) => tab.note.latest.includes('""" + IN_A_SET + """'))) {
        clearInterval(every);
        go();
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


def kept_through(page: Page, armed: str, fires: bool) -> None:
    page.evaluate(f"()=>{WS}.persist()")
    page.evaluate("(armed)=>sessionStorage.setItem('launch-close', armed)", armed)
    page.reload(wait_until="commit")
    DRIVE.ready(page)
    if fires:
        wait_for(page, "()=>sessionStorage.getItem('launch-closed')==='1'", f"the window went: {armed}")
        page.evaluate("()=>sessionStorage.removeItem('launch-closed')")
        DRIVE.ready(page)
    for words in (ON_SCREEN, IN_A_SET):
        wait_for(
            page,
            f"()=>{WS}.tabs.some(t=>t.note.latest.includes({words!r}))",
            f"{words} back after: {armed}",
            timeout=15000,
        )
    tabs = page.evaluate(f"()=>{WS}.tabs.length")
    say(f"{armed}: both drafts back, {tabs} tabs")
    if tabs != 13:
        wrong(f"{armed}: {tabs} tabs came back, not 13")


def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    ctx.add_init_script(WATCH)
    page = ctx.new_page()
    DRIVE.open(page)
    first = page.evaluate(f"()=>{WS}.activeSpaceId")
    type_draft(page, ON_SCREEN)

    other = page.evaluate(f"async()=>{{const made=await {WS}.addSpace('Other'); return made?.id ?? made}}")
    page.evaluate(f"(id)=>{WS}.selectSpace(id)", other)
    wait_for(page, f"(id)=>{WS}.activeSpaceId===id", "in the other space", other)
    DRIVE.seed(page, *[f"# S{at}\n\nwords {at}\n" for at in range(10)])
    for at in range(10):
        page.evaluate(
            f"""async()=>{{const ws={WS};
            const note=ws.notes.find(one=>one.name.startsWith('S{at}'));
            await ws.openEntry(note.path,{{activate:true}}); ws.keep(ws.active.id)}}"""
        )
    type_draft(page, IN_A_SET)
    page.evaluate(f"(id)=>{WS}.selectSpace(id)", first)
    wait_for(page, f"(id)=>{WS}.activeSpaceId===id", "back in the first space", first)
    total = page.evaluate(f"()=>{WS}.tabs.length")
    say(f"before: {total} tabs")
    if total != 13:
        say("the first space opens with a note of its own, counted")

    kept_through(page, "persist", False)
    kept_through(page, "list up", True)
    kept_through(page, "set building", True)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
