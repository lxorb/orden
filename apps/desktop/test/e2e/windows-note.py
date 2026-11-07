
from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
LIVE = "()=>window.ordenApp.workspace.active.note.latest"

def type_in(page, words: str) -> None:
    page.bring_to_front()
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(words, delay=3)

def drive(browser: Browser) -> None:
    ctx = DRIVE.context(browser, viewport={"width": 1200, "height": 800})
    a = ctx.new_page()
    DRIVE.open(a)
    DRIVE.seed(a, "# Both\n\nbase line\n")
    DRIVE.open_note(a, "Both")
    b = ctx.new_page()
    b.goto(a.url)
    DRIVE.ready(b)
    wait_for(b, "()=>window.ordenApp.workspace.files.some(f=>f.name.startsWith('Both'))", "the list")
    DRIVE.open_note(b, "Both")
    root = a.evaluate("()=>window.ordenApp.workspace.activeSpace.root")
    path = f"{root}/Both.md"
    read = "(p)=>window.ordenApp.workspace.noteText(p)"

    type_in(a, "FROM-A ")
    wait_for(b, "()=>window.ordenApp.workspace.active.note.latest.includes('FROM-A')", "B hears A")
    say(f"B reads: {b.evaluate(LIVE)!r}")
    type_in(b, "FROM-B ")
    wait_for(a, "()=>window.ordenApp.workspace.active.note.latest.includes('FROM-B')", "A hears B")
    wait_for(
        a,
        "async ()=>{const t=await window.ordenApp.workspace.noteText("
        + repr(path)
        + ");return t.includes('FROM-A')&&t.includes('FROM-B')}",
        "both on the disk",
    )
    say(f"disk: {a.evaluate(read, path)!r}")
    if a.evaluate(LIVE) != b.evaluate(LIVE):
        wrong(f"the windows differ: {a.evaluate(LIVE)!r} against {b.evaluate(LIVE)!r}")

    a.evaluate("()=>{const n=window.ordenApp.workspace.active.note;n.live.edit([{from:0,to:0,insert:'TOP-A '}]);}")
    b.evaluate("()=>{const n=window.ordenApp.workspace.active.note;n.live.edit([{from:n.live.text.length,to:n.live.text.length,insert:'END-B '}]);}")
    wait_for(
        a,
        "async ()=>{const t=await window.ordenApp.workspace.noteText("
        + repr(path)
        + ");return t.includes('TOP-A')&&t.includes('END-B')}",
        "both of a moment on the disk",
    )

    a.evaluate("async (r)=>{await window.ordenApp.workspace.noteFrom('# Fresh\\n\\nx\\n',r)}", root)
    wait_for(b, "()=>window.ordenApp.workspace.files.some(f=>f.name.startsWith('Fresh'))", "B's list")
    say("a note made in A is in B's list")

    b.bring_to_front()
    b.evaluate("()=>{const n=window.ordenApp.workspace.active.note;n.live.edit([{from:0,to:0,insert:'LATE-B '}]);}")
    a.evaluate("async (p)=>{await window.ordenApp.workspace.remove(p,false)}", path)
    wait_for(
        b,
        "()=>!window.ordenApp.workspace.files.some(f=>f.name==='Both.md')",
        "B's list without it",
    )
    b.wait_for_timeout(1500)
    files = b.evaluate("async ()=>{await window.ordenApp.workspace.loadTree();return window.ordenApp.workspace.files.map(f=>f.name)}")
    say(f"files: {files}")
    if "Both.md" in files:
        wrong("a note deleted in A came back when B typed")
    kept = b.evaluate("()=>window.ordenApp.workspace.tabs.some(t=>t.note.latest.includes('LATE-B'))")
    if not kept:
        wrong("the words B had unwritten went with the note")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
