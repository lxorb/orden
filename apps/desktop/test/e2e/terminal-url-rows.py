from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

OPEN = """async () => {
  const ws = window.ordenApp.workspace
  window.__opened = []
  ws.openPage = (uri) => { window.__opened.push(uri); return null }
  const spec = JSON.stringify({ shell: 'bash', folder: null, key: 'url-rows' })
  await ws.openUnsaved('terminal', spec, 'Shell', null, true)
  ws.showPanel(null)
  return ws.active?.kind
}"""

READY = """async () => {
  const { sessionOf } = await window.ordenApp.terminals()
  const tab = window.ordenApp.workspace.active
  const session = tab && sessionOf(tab)
  return !!session?.term.element?.getElementsByClassName('xterm-screen')[0]?.getBoundingClientRect().width
}"""

WRITE = """async (kind) => {
  const { sessionOf } = await window.ordenApp.terminals()
  const term = sessionOf(window.ordenApp.workspace.active).term
  const cols = term.cols
  const address = (length) => {
    let text = 'https://us-east-1.signin.aws.amazon.com/v1/authorize?response_type=code&client_id='
    for (let n = 0; text.length < length; n++) text += 'abcdef0123456789'[n % 16]
    return text
  }
  const chunks = (text, width) => {
    const rows = []
    for (let at = 0; at < text.length; at += width) rows.push(text.slice(at, at + width))
    return rows
  }
  let url = address(cols * 2 + Math.floor(cols / 2))
  let data = ''
  let rows = [0, 1, 2]
  let below = null
  if (kind === 'soft') data = url + '\\r\\n$ '
  if (kind === 'hard') data = chunks(url, cols).join('\\r\\n') + '\\r\\n$ '
  if (kind === 'hyperlink')
    data = chunks(url, cols).map((row) => `\\x1b]8;id=u;${url}\\x07${row}\\x1b]8;;\\x07`).join('\\r\\n') + '\\r\\n$ '
  if (kind === 'panel') {
    const inner = cols - 4
    url = address(inner * 2 + Math.floor(inner / 2))
    const top = '\\u256d\\u2500 Authentication ' + '\\u2500'.repeat(cols - 20) + '\\u256e'
    const bottom = '\\u2570' + '\\u2500'.repeat(cols - 2) + '\\u256f'
    const lines = ['Open this address to sign in:'.padEnd(inner), ...chunks(url, inner).map((row) => row.padEnd(inner))]
    data = [top, ...lines.map((line) => `\\u2502 ${line} \\u2502`), bottom, '$ '].join('\\r\\n')
    rows = [2, 3, 4]
  }
  if (kind === 'plain') {
    url = address(cols)
    data = url + '\\r\\nPress Enter to continue\\r\\n$ '
    rows = [0]
    below = 1
  }
  await new Promise((done) => term.write('\\x1b[2J\\x1b[3J\\x1b[H' + data, done))
  return { url, rows, below, cols }
}"""

UNDER = """async () => {
  const { sessionOf } = await window.ordenApp.terminals()
  const session = sessionOf(window.ordenApp.workspace.active)
  const screen = session.term.element.getElementsByClassName('xterm-screen')[0]
  const lines = [...screen.children].find((one) => one.children.length === session.term.rows)
  return [...(lines?.children ?? [])].map((row) =>
    [...row.children].filter((one) => one.style.textDecoration.includes('underline')).map((one) => one.textContent).join(''),
  )
}"""

CELL = """async ([x, y]) => {
  const { sessionOf } = await window.ordenApp.terminals()
  const session = sessionOf(window.ordenApp.workspace.active)
  const screen = session.term.element.getElementsByClassName('xterm-screen')[0]
  const box = screen.getBoundingClientRect()
  const width = box.width / session.term.cols
  const height = box.height / session.term.rows
  return [box.left + (x + 0.5) * width, box.top + (y + 0.5) * height]
}"""

BORDERS = str.maketrans("", "", "│ ")


def point(page: Page, x: int, y: int) -> tuple[float, float]:
    away = page.evaluate(CELL, [x, 20])
    page.mouse.move(away[0], away[1])
    page.wait_for_timeout(60)
    at = page.evaluate(CELL, [x, y])
    page.mouse.move(at[0], at[1])
    page.wait_for_timeout(250)
    return at[0], at[1]


def opens(page: Page, x: int, y: int) -> list[str]:
    page.evaluate("() => { window.__opened = [] }")
    at = point(page, x, y)
    page.keyboard.down("Control")
    page.mouse.down()
    page.mouse.up()
    page.keyboard.up("Control")
    page.wait_for_timeout(150)
    return page.evaluate("() => window.__opened")


def case(page: Page, kind: str) -> None:
    drawn = page.evaluate(WRITE, kind)
    url, rows, cols = drawn["url"], drawn["rows"], drawn["cols"]
    say(f"[{kind}] {len(url)} characters over rows {rows} at {cols} columns")
    for y in rows:
        point(page, 5, y)
        under = page.evaluate(UNDER)
        lit = [n for n, text in enumerate(under) if text.strip()]
        if kind != "hyperlink":
            if lit != rows:
                wrong(f"[{kind}] pointing at row {y} underlines rows {lit}, not {rows}")
            if "".join(under).translate(BORDERS) != url:
                wrong(f"[{kind}] pointing at row {y} underlines {''.join(under)!r}")
        got = opens(page, 5, y)
        if got != [url]:
            wrong(f"[{kind}] a Ctrl+click on row {y} opens {got!r}, not the whole address")
    if drawn["below"] is not None:
        y = drawn["below"]
        point(page, 3, y)
        if any(text.strip() for text in page.evaluate(UNDER)):
            wrong(f"[{kind}] the sentence under the address is underlined")
        got = opens(page, 3, y)
        if got:
            wrong(f"[{kind}] a Ctrl+click on the sentence under the address opens {got!r}")
    DRIVE.shot(page, f"url-rows-{kind}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    say(f"opened a {page.evaluate(OPEN)}")
    wait_for(page, READY, "the terminal's screen")
    page.wait_for_timeout(1000)
    for kind in ("soft", "hard", "panel", "hyperlink", "plain"):
        case(page, kind)
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a terminal address over three rows is one whole link"))
