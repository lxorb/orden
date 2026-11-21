import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
NOTE = "# Lecture 3\n\n![](https%3A//orden.so/i/d054771ca8915121ece460631ce6ca2ae84ccd926ec916bb813aa)\n\n" + "".join(f"Part {at}: words about arrays and strings.\n\n" for at in range(80))
SEED = """async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Lecture')).path, { activate: true })
}"""
WRITE = """async (n) => {
  const { writeFile } = await window.ordenApp.tasks()
  const ws = window.ordenApp.workspace
  await writeFile(ws.activeSpace.root + '/Other ' + n + '.md', '# Other ' + n + '\\n\\nwords [[Lecture 3]]\\n')
  await ws.loadTree()
}"""
LOOK = """() => {
  const now = { same: window.orden === window.__view, connected: window.__view.dom.isConnected, top: window.orden.scrollDOM.scrollTop, editors: document.querySelectorAll('[data-pane] .cm-editor').length, lit: !!document.querySelector('.orden-scrollbar.is-lit, .orden-scrollbar.is-settling') }
  return now
}"""
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 800})
    DRIVE.open(page)
    page.evaluate(SEED, NOTE)
    wait_for(page, "window.orden && document.querySelector('[data-pane] .cm-content')", "the note")
    page.wait_for_timeout(1500)
    page.evaluate("() => { window.orden.scrollDOM.scrollTop = 300 }")
    page.wait_for_timeout(2500)
    page.evaluate("() => { window.__view = window.orden }")
    top = page.evaluate("() => window.orden.scrollDOM.scrollTop")
    for n in range(6):
        page.evaluate(WRITE, n)
        page.wait_for_timeout(1500)
        seen = page.evaluate(LOOK)
        say(f"after write {n}: {json.dumps(seen)}")
        if not seen["same"] or not seen["connected"]:
            wrong(f"writing another file and reading the file list again built the open note's editor again: {seen}")
            break
        if seen["top"] != top:
            wrong(f"the open note moved from {top} to {seen['top']} as another file was written")
        if seen["lit"]:
            wrong(f"the open note's scroll bar lit up as another file was written: {seen}")
raise SystemExit(DRIVE.run(drive, "an open note keeps its editor, its place and its quiet scroll bar while other files are written"))
