import { readBase, type Base } from '@orden/bases'
import { expect, test, vi } from 'vitest'

const note = {
  text: '',
  writes: [] as (() => void)[],
}

vi.mock('../../workspace/src/api', async (original) => ({
  ...(await original<typeof import('../../workspace/src/api')>()),
  noteText: async () => note.text,
  writeNoteText: async (_ws: unknown, _path: string, _before: string, after: string) => {
    note.text = after
    await new Promise<void>((done) => note.writes.push(done))
  },
}))

const { LiveView } = await import('./live.svelte')
const { fenceSource } = await import('./source')

const CODE = 'views:\n  - type: table\n    name: First\n'

const named = (base: Base, name: string): Base => ({
  ...base,
  views: base.views.map((view, at) => (at === 0 ? { ...view, name } : view)),
})

const settled = () => new Promise((done) => setTimeout(done, 5))

test('a second change to a database in a note, made while the first is written, is kept too', async () => {
  note.text = `# Plan\n\n\`\`\`base\n${CODE}\`\`\`\n`
  const live = new LiveView(fenceSource(CODE, '/space/Plan.md'))
  await live.reload()
  const base = live.base ?? readBase(CODE)

  const first = live.change(named(base, 'Second'))
  await settled()
  const second = live.change(named(base, 'Third'))
  for (let round = 0; round < 4; round++) {
    await settled()
    for (const write of note.writes.splice(0)) write()
  }
  await Promise.all([first, second])

  expect(note.text).toContain('name: Third')
  expect(note.text).not.toContain('name: Second')
})

test('a load that lands after a change was made leaves the change on screen', async () => {
  let land: (base: Base) => void = () => undefined
  let saves = 0
  const live = new LiveView({
    scope: null,
    load: () => new Promise<Base>((done) => (land = done)),
    save: async () => {
      saves++
    },
  })
  const loading = live.reload()
  const old = readBase(CODE)
  await live.change(named(old, 'Changed'))
  land(old)
  await loading
  await settled()

  expect(live.base?.views[0]?.name).toBe('Changed')
  expect(saves).toBe(1)
})
