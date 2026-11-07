from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong

SETUP = """
async () => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: 'http://127.0.0.1:9', model: 'fake-small' })
  ai.setDefault(made.id)
  return made.id
}
"""

SEED = """async (provider) => {
  const chat = await window.nibApp.aiChats()
  const { writeThread } = await import('/src/lib/ai/chat/threads.ts')
  const space = chat.space || chat.spaces[0]
  const now = Date.now()
  await writeThread({ id: 'twin', space, title: 'Herons', provider, model: 'fake-small', effort: 'medium', mode: 'ask',
    turns: [{ id: 'u1', role: 'you', at: now - 2000, parts: [], draft: { text: 'Where do herons sleep?', attachments: [] } },
            { id: 'm1', role: 'model', at: now - 1000, parts: [{ kind: 'text', text: 'In trees.' }] }],
    usage: { input: 0, output: 0 }, created: now - 3000, updated: now - 1000 })
  return space
}"""

OPEN = """async () => { const chat = await window.nibApp.aiChats(); await chat.openThread('twin', false); return chat.thread?.title }"""
STORED = """async (space) => { const { readThread } = await import('/src/lib/ai/chat/threads.ts'); const t = await readThread(space, 'twin'); return t ? { title: t.title, pinned: !!t.pinned, archived: !!t.archived } : null }"""
HEADS = """async () => (await window.nibApp.aiChats()).heads.map((one) => one.id)"""


def drive(browser: Browser) -> None:
    a = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    DRIVE.open(a)
    provider = a.evaluate(SETUP)
    a.keyboard.press("Control+Shift+A")
    a.wait_for_timeout(800)
    space = a.evaluate(SEED, provider)
    b = a.context.new_page()
    b.on("pageerror", lambda error: wrong(f"page error in B: {error}"))
    DRIVE.open(b)
    b.keyboard.press("Control+Shift+A")
    b.wait_for_timeout(800)
    say(f"A opened {a.evaluate(OPEN)!r}, B opened {b.evaluate(OPEN)!r}")
    a.evaluate("async () => (await window.nibApp.aiChats()).rename('Herons at night', 'twin')")
    a.wait_for_timeout(600)
    b.evaluate("async () => (await window.nibApp.aiChats()).pin('twin')")
    b.wait_for_timeout(600)
    kept = a.evaluate(STORED, space)
    say(f"after a rename in A and a pin in B: {kept}")
    if not kept or kept["title"] != "Herons at night" or not kept["pinned"]:
        wrong(f"one window wrote over the other: {kept}")
    a.evaluate("async (space) => { const { deleteThread } = await import('/src/lib/ai/chat/threads.ts'); await deleteThread(space, 'twin') }", space)
    a.wait_for_timeout(600)
    b.evaluate("async () => (await window.nibApp.aiChats()).pin('twin', false)")
    b.wait_for_timeout(600)
    gone = a.evaluate(STORED, space)
    say(f"after a delete in A and an unpin in B: stored {gone}, B lists {b.evaluate(HEADS)}")
    if gone is not None:
        wrong(f"a chat deleted in one window came back from the other: {gone}")
    if "twin" in b.evaluate(HEADS):
        wrong("a chat deleted in one window is still listed in the other")
    a.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "two windows on one AI chat keep each other's changes"))
