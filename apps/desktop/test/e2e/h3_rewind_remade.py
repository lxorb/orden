from __future__ import annotations
from harness import Drive
DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong

JS = r"""
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const sid = ws.activeSpace.id
  const docs = await import('/src/lib/agents/docs/index.ts')
  const { review } = await import('/src/lib/ai/review/review.svelte.ts')
  const { invoke } = await import('/src/lib/tauri.ts')
  const nap = (ms = 8) => new Promise((go) => setTimeout(go, ms))
  const read = (rel) => invoke('read_note', { path: root + '/' + rel }).catch(() => null)
  const write = async (rel, text) => {
    await invoke('write_note', { path: root + '/' + rel, content: text })
    await ws.loadTree()
  }
  const t = { id: 'T4', provider: 'p4', space: sid, model: 'm', turns: [], title: '', updated: Date.now() }
  const tool = (verb, answer, at) => ({ kind: 'tool', id: 'c' + Math.random(), verb, args: {}, state: 'ok', result: { text: JSON.stringify(answer) }, at })
  t.turns.push({ id: 'u1', role: 'you', at: Date.now(), parts: [{ kind: 'text', text: 'do' }], draft: { text: 'do' } })
  const m = { id: 'u1m', role: 'model', at: Date.now(), provider: t.provider, parts: [] }
  t.turns.push(m)
  const agent = { id: 'nib-p4', name: 'x', thread: t.id }
  const edit = async (q, r) => {
    await nap()
    await docs.notes.editNote(agent, { path: 'S4.md' }, [{ at: { quote: q }, replace: r }])
    await nap()
  }
  await write('S4.md', '# S4\n\nold words\n')
  await edit('old', 'OLD')
  await nap()
  await ws.remove(root + '/S4.md', false, 'x')
  m.parts.push(tool('trash_file', { path: 'S4.md', trashed: true, space: sid }, Date.now()))
  await nap()
  await write('S4.md', '# S4 new\n\nfresh words\n')
  m.parts.push(tool('create_note', { path: 'S4.md', created: true, space: sid }, Date.now()))
  await edit('fresh', 'FRESH')
  const before = await read('S4.md')
  await review.rewind(t, 'u1', 'notes', null)
  await ws.writesSettled()
  const rewound = await read('S4.md')
  await review.putBack(t, null)
  await ws.writesSettled()
  return { before, rewound, redone: await read('S4.md') }
}
"""


def drive(browser):
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    got = page.evaluate(JS)
    say(str(got))
    if got["before"] != "# S4 new\n\nFRESH words\n":
        wrong(f"before the rewind: {got['before']!r}")
    if got["rewound"] != "# S4\n\nold words\n":
        wrong(f"rewound: {got['rewound']!r}")
    if got["redone"] != "# S4 new\n\nFRESH words\n":
        wrong(f"redone: {got['redone']!r}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
