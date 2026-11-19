from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
OPEN = """async () => {
  const ws = window.ordenApp.workspace
  const spec = JSON.stringify({ shell: 'bash', folder: null, key: 'take-over' })
  await ws.openUnsaved('terminal', spec, 'Shell', null, true)
  ws.showPanel(null)
  return ws.active?.kind
}"""
READY = """async () => {
  const { sessionOf } = await window.ordenApp.terminals()
  const session = sessionOf(window.ordenApp.workspace.active)
  return !!session?.term.element?.getElementsByClassName('xterm-screen')[0]?.getBoundingClientRect().width
}"""
WATCH = """async (writer) => {
  const { sessionOf } = await window.ordenApp.terminals()
  const session = sessionOf(window.ordenApp.workspace.active)
  session.writer = writer
  await new Promise((done) => session.term.write('$ npm run dev\\r\\nready on port 5173\\r\\n', done))
}"""
BAR = """() => {
  const bar = document.querySelector('.terminal .bar')
  if (!bar) return null
  const box = bar.getBoundingClientRect()
  const place = document.querySelector('.terminal').getBoundingClientRect()
  return {
    text: bar.textContent.trim(),
    buttons: [...bar.querySelectorAll('button')].map((one) => one.textContent.trim()),
    inside: box.left >= place.left && box.right <= place.right && box.bottom <= place.bottom,
    height: box.height,
  }
}"""
def drive(browser: Browser) -> None:
    for name, width, height in (("wide", 1280, 820), ("phone", 390, 844)):
        page = DRIVE.page(browser, viewport={"width": width, "height": height})
        DRIVE.open(page)
        say(f"[{name}] opened a {page.evaluate(OPEN)}")
        wait_for(page, READY, "the terminal's screen")
        page.evaluate(WATCH, False)
        wait_for(page, "() => !!document.querySelector('.terminal .bar')", "the bar")
        page.wait_for_timeout(300)
        bar = page.evaluate(BAR)
        say(f"[{name}] the bar says {bar}")
        if not bar or "Typing in another window" not in bar["text"]:
            wrong(f"[{name}] a tab that only watches says nothing about it: {bar}")
        elif bar["buttons"] != ["Take over"] or not bar["inside"]:
            wrong(f"[{name}] the bar is not one Take over inside the terminal: {bar}")
        elif bar["height"] > 44:
            wrong(f"[{name}] the bar wraps onto more than one line: {bar}")
        DRIVE.shot(page, f"take-over-{name}")
        page.evaluate(WATCH, True)
        page.wait_for_timeout(400)
        if page.evaluate(BAR) is not None:
            wrong(f"[{name}] the bar stayed once the tab types again")
        page.context.close()
raise SystemExit(DRIVE.run(drive, "a terminal another window types in shows Take over"))
