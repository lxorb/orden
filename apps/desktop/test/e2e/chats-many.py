from __future__ import annotations

import os

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
N = int(os.environ.get("CHATS", "1000"))

SETUP = """
async () => {
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: 'http://127.0.0.1:9', model: 'fake-small' })
  ai.setDefault(made.id)
}
"""

SEED = """async (n) => {
  const chat = await window.ordenApp.aiChats()
  const now = Date.now()
  const states = ['done']
  chat.every = Array.from({ length: n }, (_, at) => ({
    id: 'c' + at, title: 'Chat number ' + at + ' about herons and kestrels', state: states[0],
    provider: 'x', model: 'claude-sonnet', updated: now - at * 60000, words: 'words ' + at,
    space: 'any', answered: now - 1, seen: now,
  }))
}"""

TIMED = """async ([selector, act]) => {
  const t0 = performance.now()
  if (act === 'click') document.querySelector(selector).click()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return performance.now() - t0
}"""

BUMP = """async () => {
  const chat = await window.ordenApp.aiChats()
  const t0 = performance.now()
  const every = [...chat.every]
  every[every.length - 1] = { ...every[every.length - 1], updated: Date.now() + 1000 }
  chat.every = every
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return performance.now() - t0
}"""

LIT = """() => { const l = document.querySelector('.threads .row.lit'); if (!l) return null;
  const b = l.getBoundingClientRect(), box = document.querySelector('.threads .list').getBoundingClientRect();
  return { title: l.querySelector('.title').textContent, inside: b.top >= box.top - 1 && b.bottom <= box.bottom + 1 } }"""

HOLE = """() => { const box = document.querySelector('.threads .list').getBoundingClientRect()
  for (let y = box.top + 40; y < box.bottom - 10; y += 14) {
    const at = document.elementFromPoint(box.left + 60, y)
    if (!at || !at.closest('.item')) return { y, at: at && at.className }
  }
  return null }"""

TALKHOLE = """() => { const box = document.querySelector('.talk').getBoundingClientRect()
  const hits = []
  for (let y = box.top + 20; y < box.bottom - 30; y += 14) {
    const at = document.elementFromPoint(box.left + box.width / 2, y)
    if (!at || !at.closest('.item')) hits.push(y)
  }
  return hits.length }"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.evaluate(SETUP)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_timeout(1500)
    for _ in range(5):
        page.evaluate(SEED, N)
        page.wait_for_timeout(1500)
        if page.evaluate("!!document.querySelector('.home .all')"):
            break
    else:
        wrong("Show all never stood")
        DRIVE.shot(page, "no-show-all")
        return
    took = page.evaluate(TIMED, [".home .all", "click"])
    rows = page.evaluate("document.querySelectorAll('.home .item').length")
    say(f"{N} chats: Show all took {took:.0f} ms, {rows} rows in the DOM")
    bumps = [page.evaluate(BUMP) for _ in range(5)]
    say(f"{N} chats: one chat moving to the top took {[round(b) for b in bumps]} ms")
    t0 = page.evaluate("performance.now()")
    page.mouse.move(900, 300)
    for y in range(120, 700, 8):
        page.mouse.move(1100, y)
    t1 = page.evaluate("performance.now()")
    say(f"{N} chats: 73 pointer moves over the list took {t1 - t0:.0f} ms")
    scroll = page.evaluate("""async () => {
      const box = document.querySelector('.talk'); const t0 = performance.now()
      for (let i = 0; i < 20; i++) { box.scrollTop += 400; await new Promise((r) => requestAnimationFrame(r)) }
      return { ms: performance.now() - t0, top: box.scrollTop, rows: document.querySelectorAll('.home .item').length,
        seen: [...document.querySelectorAll('.home .item .title')].filter((t) => { const b = t.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight }).map((t) => t.textContent).slice(0, 2) }
    }""")
    say(f"{N} chats: 20 scroll frames {scroll}")
    holes = page.evaluate(TALKHOLE)
    if holes:
        wrong(f"Show all, scrolled, shows {holes} empty strips")
    want = page.evaluate("""() => { const box = document.querySelector('.talk')
      const rows = [...document.querySelectorAll('.home .item:not(.away) .title')].map((t) => Number(t.textContent.split(' ')[2]))
      return rows.every((one, at) => at === 0 || one === rows[at - 1] + 1) }""")
    if not want:
        wrong("Show all's drawn rows are not in order")
    page.locator(".home .item .row").nth(2).focus()
    page.evaluate("() => { document.querySelector('.talk').scrollTop += 6000 }")
    page.wait_for_timeout(300)
    kept = page.evaluate("() => !!document.activeElement?.closest('.home .item')")
    if not kept:
        wrong("a focused chat row lost the focus when scrolled out of sight")
    DRIVE.shot(page, "show-all")
    page.locator('button[aria-label="Chats"]').last.click()
    page.wait_for_timeout(800)
    page.evaluate(SEED, N)
    wait_for(page, "document.querySelector('.threads .item')", "the list")
    page.locator(".threads input").focus()
    t0 = page.evaluate("performance.now()")
    for _ in range(40):
        page.keyboard.press("ArrowDown")
    lit = page.evaluate(LIT)
    say(f"{N} chats: 40 ArrowDown {page.evaluate('performance.now()') - t0:.0f} ms, lit {lit}")
    if not lit or not lit["inside"] or lit["title"] != "Chat number 40 about herons and kestrels":
        wrong(f"the lit row is not the 41st in sight: {lit}")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    for _ in range(3):
        page.keyboard.press("ArrowDown")
    hole = page.evaluate(HOLE)
    if hole:
        wrong(f"the Chats list shows a hole: {hole}")
    rows = page.evaluate("document.querySelectorAll('.threads .item').length")
    keys = []
    for ch in "heron":
        t0 = page.evaluate("performance.now()")
        page.keyboard.type(ch)
        page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        keys.append(round(page.evaluate("performance.now()") - t0))
    say(f"{N} chats: the Chats list has {rows} rows; typing 'heron' per key {keys} ms")
    t0 = page.evaluate("performance.now()")
    for _ in range(2):
        page.keyboard.press("ArrowDown")
    lit = page.evaluate(LIT)
    say(f"{N} chats: after the search, lit {lit}")
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a thousand chats draw only the rows in sight, keep the focus and follow the keys"))
