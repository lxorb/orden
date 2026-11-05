
from __future__ import annotations

from playwright.sync_api import Browser, BrowserContext, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WS = "window.nibApp.workspace"
LIVE = f"()=>{WS}.active.note.latest"
READ = f"(p)=>{WS}.noteText(p)"


def type_in(page: Page, words: str) -> None:
    page.bring_to_front()
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(words, delay=2)


def another(ctx: BrowserContext, url: str) -> Page:
    page = ctx.new_page()
    page.goto(url)
    DRIVE.ready(page)
    return page


def line_endings(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    root = a.evaluate(f"()=>{WS}.activeSpace.root")
    path = f"{root}/CR.md"
    DRIVE.seed(a, "# CR\r\n\r\nfirst para\r\n\r\nsecond para\r\n")
    DRIVE.open_note(a, "CR")
    b = another(ctx, a.url)
    wait_for(b, f"()=>{WS}.files.some(f=>f.name.startsWith('CR'))", "the list")
    DRIVE.open_note(b, "CR")
    if "\r" in a.evaluate(LIVE) or "\r" in (a.evaluate(f"()=>{WS}.active.note.onDisk") or ""):
        wrong("a note holds a line ending its rope does not")

    type_in(b, "FROM-B ")
    wait_for(a, f"()=>{WS}.active.note.latest.includes('FROM-B')", "A hears B")
    if a.evaluate(f"()=>{WS}.active.note.dirty"):
        wrong("A heard B and is dirty for it")

    type_in(a, "FROM-A ")
    wait_for(b, f"()=>{WS}.active.note.latest.includes('FROM-A')", "B hears A: A went on writing")
    wait_for(a, f"()=>!{WS}.active.note.dirty", "A clean again")
    wait_for(b, f"()=>!{WS}.active.note.dirty", "B clean again")
    c = another(ctx, a.url)
    disk = c.evaluate(READ, path)
    for token in ("FROM-A", "FROM-B", "second para"):
        if disk.count(token) != 1:
            wrong(f"{token} is on the disk {disk.count(token)} times: {disk!r}")
    if a.evaluate(LIVE) != b.evaluate(LIVE):
        wrong("the two windows hold different words")
    ctx.close()


def out_of_sight(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = another(ctx, a.url)
    b.bring_to_front()
    first = b.evaluate(f"()=>{WS}.activeSpaceId")
    other = b.evaluate(f"async ()=>{{const m=await {WS}.addSpace('Other'); return m?.id ?? m}}")
    b.evaluate(f"(id)=>{WS}.selectSpace(id)", other)
    b.wait_for_timeout(300)
    b.evaluate(f"()=>{WS}.openBlank()")
    b.wait_for_selector(".cm-content")
    b.locator(".cm-content").first.click()
    b.keyboard.type("WORDS IN A SET OUT OF SIGHT", delay=2)
    b.evaluate(f"(id)=>{WS}.selectSpace(id)", first)
    b.wait_for_timeout(500)
    b.evaluate(f"()=>{WS}.persist()")
    a.close(run_before_unload=True)
    b.close(run_before_unload=True)

    c = ctx.new_page()
    c.goto(DRIVE.origin)
    DRIVE.ready(c)
    wait_for(
        c,
        f"()=>{WS}.tabs.some(t=>t.note.latest.includes('WORDS IN A SET'))",
        "the words of a set out of sight come along",
        patience=30,
    )
    c.reload()
    DRIVE.ready(c)
    wait_for(c, f"()=>{WS}.tabs.some(t=>t.note.latest.includes('WORDS IN A SET'))", "and stay")
    held = f"()=>{WS}.tabs.filter(t=>t.note.latest.includes('WORDS IN A SET')).length"
    if c.evaluate(held) != 1:
        wrong(f"the words came back {c.evaluate(held)} times")
    ctx.close()


def no_room(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = another(ctx, a.url)
    b.bring_to_front()
    b.evaluate(f"()=>{WS}.openBlank()")
    b.wait_for_selector(".cm-content")
    b.locator(".cm-content").first.click()
    b.keyboard.type("WORDS WITH NO ROOM", delay=2)
    b.evaluate(f"()=>{WS}.persist()")
    a.close(run_before_unload=True)
    b.close(run_before_unload=True)

    c = ctx.new_page()
    c.add_init_script(
        "const put = Storage.prototype.setItem;"
        "Storage.prototype.setItem = function (k, v) {"
        "  if (String(k).startsWith('nib:workspace')) throw new DOMException('full', 'QuotaExceededError');"
        "  return put.call(this, k, v) }"
    )
    c.goto(DRIVE.origin)
    DRIVE.ready(c)
    wait_for(c, f"()=>{WS}.tabs.some(t=>t.note.latest.includes('WITH NO ROOM'))", "the words here", patience=30)
    c.wait_for_timeout(500)
    kept = c.evaluate(
        "()=>Object.keys(localStorage).filter(k=>(localStorage.getItem(k)||'').includes('WITH NO ROOM'))"
    )
    if not kept:
        wrong("storage full, and the only entry holding the words let them go")
    ctx.close()


def stale(browser: Browser, gone: bool) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    DRIVE.seed(a, "# Both\n\nbase line\n")
    DRIVE.open_note(a, "Both")
    b = another(ctx, a.url)
    wait_for(b, f"()=>{WS}.files.some(f=>f.name.startsWith('Both'))", "the list")
    DRIVE.open_note(b, "Both")
    root = a.evaluate(f"()=>{WS}.activeSpace.root")
    path = f"{root}/Both.md"
    a.bring_to_front()
    a.wait_for_timeout(1500)
    type_in(a, "OLD-FROM-A ")
    a.evaluate(f"()=>{WS}.persist()")
    held = a.evaluate(
        "()=>JSON.parse(localStorage.getItem('nib:workspace')).layout.frame.pane.tabs"
        ".find(t=>t.name.startsWith('Both'))"
    )
    if not held.get("dirty") or held.get("base") != "# Both\n\nbase line\n":
        wrong(f"the session does not say what the words were typed on: {held!r}")
    a.close(run_before_unload=False)
    b.wait_for_timeout(1500)
    if gone:
        b.evaluate(f"(p)=>{WS}.remove(p)", path)
    else:
        type_in(b, "NEWER-IN-B ")
        wait_for(b, f"()=>!{WS}.active.note.dirty", "B wrote")

    c = ctx.new_page()
    c.goto(DRIVE.origin)
    DRIVE.ready(c)
    wait_for(c, f"()=>{WS}.tabs.some(t=>t.note.latest.includes('OLD-FROM-A'))", "the old words kept")
    if gone:
        tab = c.evaluate(f"()=>{WS}.tabs.filter(t=>t.note.latest.includes('OLD-FROM-A')).map(t=>t.path)")
        if tab != [None]:
            wrong(f"a file that went came back: {tab!r}")
        c.wait_for_timeout(1500)
        if c.evaluate(f"(p)=>{WS}.files.some(f=>f.path===p)", path):
            wrong("the file is in the list again")
    else:
        wait_for(c, f"()=>{WS}.tabs.some(t=>t.note.latest.includes('NEWER-IN-B'))", "the newer words too")
        wait_for(b, f"()=>{WS}.active.note.latest.includes('OLD-FROM-A')", "B hears the old words merged")
        wait_for(c, f"()=>!{WS}.tabs.find(t=>t.path!==null).note.dirty", "C wrote")
        d = another(ctx, c.url)
        disk = d.evaluate(READ, path)
        for token in ("OLD-FROM-A", "NEWER-IN-B"):
            if disk.count(token) != 1:
                wrong(f"{token} is on the disk {disk.count(token)} times: {disk!r}")
    ctx.close()


def heard_writes(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    DRIVE.seed(a, "# Hub\n\nsee [[Target]] here\n", "# Target\n\nx\n")
    DRIVE.open_note(a, "Hub")
    b = another(ctx, a.url)
    wait_for(b, f"()=>{WS}.files.some(f=>f.name.startsWith('Hub'))", "the list")
    root = a.evaluate(f"()=>{WS}.activeSpace.root")
    b.bring_to_front()
    b.wait_for_timeout(1500)
    b.evaluate(f"async ([f,t])=>{{await {WS}.rename(f,t)}}", [f"{root}/Target.md", "Renamed.md"])
    wait_for(a, f"()=>{WS}.active.note.latest.includes('[[Renamed]]')", "A sees the link rewritten")
    if a.evaluate(f"()=>{WS}.active.note.dirty"):
        wrong("a note that only heard is dirty")
    type_in(a, "TYPED-IN-A ")
    wait_for(a, f"()=>!{WS}.active.note.dirty", "A wrote")
    disk = b.evaluate(READ, f"{root}/Hub.md")
    if "[[Renamed]]" not in disk or "TYPED-IN-A" not in disk or "[[Target]]" in disk:
        wrong(f"the disk says {disk!r}")
    ctx.close()


def rewrite_in_turn(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    DRIVE.seed(a, "# Hub\n\nsee [[Target]] here\n", "# Target\n\nx\n")
    b = another(ctx, a.url)
    wait_for(b, f"()=>{WS}.files.some(f=>f.name.startsWith('Hub'))", "the list")
    DRIVE.open_note(b, "Hub")
    root = a.evaluate(f"()=>{WS}.activeSpace.root")
    hub = f"{root}/Hub.md"
    c = another(ctx, a.url)
    c.evaluate(
        "(p)=>{navigator.locks.request('nib:file:'+p,()=>new Promise(go=>{window.letGo=go}));"
        "return new Promise(r=>setTimeout(r,50))}",
        hub,
    )
    type_in(b, "WORDS-IN-B ")
    a.bring_to_front()
    a.evaluate(f"([f,t])=>{{window.renaming={WS}.rename(f,t)}}", [f"{root}/Target.md", "Renamed.md"])
    a.wait_for_timeout(800)
    c.evaluate("()=>window.letGo()")
    wait_for(b, f"()=>{WS}.active.note.latest.includes('[[Renamed]]')", "B sees the link")
    wait_for(b, f"()=>!{WS}.active.note.dirty", "B clean")
    disk = c.evaluate(READ, hub)
    for token in ("[[Renamed]]", "WORDS-IN-B"):
        if token not in disk:
            wrong(f"{token} is not on the disk: {disk!r}")
    ctx.close()


def busy_launch(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = ctx.new_page()
    b.add_init_script(
        "const ask = LockManager.prototype.request; let once = false;"
        "LockManager.prototype.request = function (name, ...rest) {"
        "  const answer = ask.call(this, name, ...rest);"
        "  if (!once && String(name).startsWith('nib:probe:')) { once = true;"
        "    const until = Date.now() + 2300; while (Date.now() < until); }"
        "  return answer }"
    )
    b.goto(a.url)
    DRIVE.ready(b)
    keys = [p.evaluate(f"()=>{WS}.sessionKey") for p in (a, b)]
    if keys[0] == keys[1]:
        wrong(f"two windows on one session: {keys!r}")
    ctx.close()


def space_made(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    b = another(ctx, a.url)
    wait_for(a, f"()=>{WS}.spaces.length>0", "a space here")
    a.wait_for_timeout(1200)
    b.evaluate(f"async()=>{{await {WS}.addSpace('Second')}}")
    wait_for(a, f"()=>{WS}.spaces.some(s=>s.name==='Second')", "the other window offers the space")
    ctx.close()


def drive(browser: Browser) -> None:
    space_made(browser)
    say("a space made in the other window: held")
    line_endings(browser)
    say("line endings: held")
    out_of_sight(browser)
    say("set out of sight: held")
    no_room(browser)
    say("no room for what is taken: held")
    stale(browser, gone=False)
    say("old words over a newer file: held")
    stale(browser, gone=True)
    say("old words over a file gone: held")
    heard_writes(browser)
    say("whole-file writes heard: held")
    rewrite_in_turn(browser)
    say("a rewrite in the file's turn: held")
    busy_launch(browser)
    say("a busy launch: held")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
