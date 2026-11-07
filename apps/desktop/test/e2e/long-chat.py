from __future__ import annotations

import os

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
N = int(os.environ.get("TURNS", "400"))

SETUP = """
async () => {
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: 'http://127.0.0.1:9', model: 'fake-small' })
  ai.setDefault(made.id)
  return made.id
}
"""

SEED = """async ([n, provider]) => {
  const chat = await window.ordenApp.aiChats()
  const { writeThread } = await import('/src/lib/ai/chat/threads.ts')
  const space = chat.space || (chat.spaces && chat.spaces[0])
  const now = Date.now()
  const body = (at) => `## Part ${at}\\n\\nHerons **stand** still in the *shallows* for a long time, then [strike](https://example.com/${at}).\\n\\n` +
    `- one ${at}\\n- two\\n- three\\n\\n| a | b |\\n|---|---|\\n| ${at} | ${at * 2} |\\n\\n` +
    '```js\\n' + Array.from({ length: 12 }, (_, i) => `const line${i} = ${at} + ${i}`).join('\\n') + '\\n```\\n\\nThe end of answer ' + at + '.'
  const turns = []
  for (let at = 0; at < n; at++) {
    turns.push({ id: 'u' + at, role: 'you', at: now - (n - at) * 1000, parts: [], draft: { text: 'Question number ' + at, attachments: [] } })
    turns.push({ id: 'm' + at, role: 'model', at: now - (n - at) * 1000 + 500, parts: [{ kind: 'text', text: body(at) }] })
  }
  await writeThread({ id: 'long', space, title: 'A long chat', provider, model: 'fake-small', effort: 'medium', mode: 'ask',
    turns, usage: { input: 0, output: 0 }, created: now - n * 1000, updated: now })
  return space
}"""

OPEN = """async () => {
  const chat = await window.ordenApp.aiChats()
  await chat.refresh?.()
  const t0 = performance.now()
  await chat.openThread('long')
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const t1 = performance.now()
  await new Promise((r) => setTimeout(r, 500))
  return { open: t1 - t0, settled: performance.now() - t0, said: document.querySelectorAll('.talk .said').length,
    nodes: document.querySelectorAll('.talk *').length }
}"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    provider = page.evaluate(SETUP)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_timeout(1500)
    space = page.evaluate(SEED, [N, provider])
    say(f"seeded {N * 2} turns in {space!r}")
    page.evaluate("""() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: false }) }""")
    took = page.evaluate(OPEN)
    say(f"opening: {took}")
    say(f"long tasks while opening: {page.evaluate('window.__long')}")
    page.evaluate("window.__long = []")
    field = page.locator(".ask textarea, textarea").first
    field.click()
    t0 = page.evaluate("performance.now()")
    page.keyboard.type("What about the egrets?", delay=0)
    page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    say(f"typing 22 keys: {page.evaluate('performance.now()') - t0:.0f} ms, long tasks {page.evaluate('window.__long')}")
    page.evaluate("window.__long = []")
    t0 = page.evaluate("performance.now()")
    page.evaluate("""async () => { const box = document.querySelector('.talk'); for (let i = 0; i < 30; i++) { box.scrollTop -= 1500; await new Promise((r) => requestAnimationFrame(r)) } }""")
    say(f"30 scroll frames up: {page.evaluate('performance.now()') - t0:.0f} ms, long tasks {page.evaluate('window.__long')}")
    held = page.evaluate("""async () => {
      const box = document.querySelector('.talk')
      const seen = () => [...box.querySelectorAll('.said .bubble')].find((one) => { const b = one.getBoundingClientRect(), r = box.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom })
      const out = []
      for (let i = 0; i < 60; i++) {
        box.scrollTop = 700
        await new Promise((r) => setTimeout(r, 60))
        const before = seen()
        const words = before && before.textContent
        const top = before && before.getBoundingClientRect().top
        box.scrollTop = 500
        await new Promise((r) => setTimeout(r, 120))
        const after = [...box.querySelectorAll('.said .bubble')].find((one) => one.textContent === words)
        out.push({ words, moved: after ? Math.round(after.getBoundingClientRect().top - top) : null, said: box.querySelectorAll('.said').length })
        if (box.querySelectorAll('.said').length >= %d) break
      }
      return out
    }""" % N)
    say(f"scrolling to the top: {held[:3]} ... {held[-2:]}")
    if held[-1]["said"] < N:
        wrong(f"scrolling up drew only {held[-1]['said']} of {N} questions")
    if any(one["moved"] is None or abs(one["moved"] - 200) > 2 for one in held if one["words"]):
        wrong("a question in sight jumped when earlier turns were drawn above it")
    DRIVE.shot(page, "long")
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a long chat opens on its last turns and draws the earlier ones as it is scrolled up"))
