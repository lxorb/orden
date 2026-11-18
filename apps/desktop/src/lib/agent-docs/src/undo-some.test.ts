import { describe, expect, test } from 'vitest'
import { type Desk, located } from './desk'
import { editNote, putBackAt, tracksMoved, tracksOf, undoAgent, undoSomeAt } from './edit'
import { touchedBy } from './touched'
import { deskOpen, deskWith } from './test-desk'

const A = { path: 'a.md' }

let made = 0
function anAgent() {
  made++
  return { id: `some-${String(made)}`, name: 'Orden Claude' }
}

function idsOf(agent: { id: string }, path: string): string[] {
  return tracksOf(agent.id).get(`/space/${path}`)?.ids ?? []
}

function swap(desk: Desk, agent: { id: string; name: string }, quote: string, replace: string) {
  return editNote(desk, agent, A, [{ at: { quote }, replace }])
}

function some(desk: Desk, agent: { id: string; name: string }, ids: string[], token?: string) {
  return undoSomeAt(desk, agent, located(desk, A), new Set(ids), token)
}

describe('one change taken back among others', () => {
  test('goes, and the reader’s typing and the agent’s later edits elsewhere stay', async () => {
    const { desk, pane } = deskOpen('a.md', 'one two three')
    const agent = anAgent()

    await swap(desk, agent, 'one', 'ONE')
    pane.type(pane.text.length, ' four')
    await swap(desk, agent, 'three', 'THREE')
    pane.type(0, '> ')
    expect(pane.text).toBe('> ONE two THREE four')

    const [first = ''] = idsOf(agent, 'a.md')
    expect(await some(desk, agent, [first])).toEqual([first])
    expect(pane.text).toBe('> one two THREE four')
    expect(idsOf(agent, 'a.md')).toHaveLength(1)

    await undoAgent(desk, agent, A)
    expect(pane.text).toBe('> one two three four')
  })

  test('takes a later edit that rewrote its words with it', async () => {
    const { desk, pane } = deskOpen('a.md', 'alpha')
    const agent = anAgent()

    await swap(desk, agent, 'alpha', 'beta gamma')
    await swap(desk, agent, 'gamma', 'delta')
    expect(pane.text).toBe('beta delta')

    const [first = '', second] = idsOf(agent, 'a.md')
    expect(await some(desk, agent, [first])).toEqual([first, second])
    expect(pane.text).toBe('alpha')
  })

  test('is one Ctrl+Z, which puts it back', async () => {
    const { desk, pane } = deskOpen('a.md', 'one two')
    const agent = anAgent()

    await swap(desk, agent, 'one', 'ONE')
    await swap(desk, agent, 'two', 'TWO')
    await some(desk, agent, idsOf(agent, 'a.md').slice(0, 1))
    expect(pane.text).toBe('one TWO')

    pane.undo()
    expect(pane.text).toBe('ONE TWO')
    expect(idsOf(agent, 'a.md')).toHaveLength(2)
  })

  test('in a closed note, through what was written there since', async () => {
    const { desk, pane, close, fileOf, disk } = deskOpen('a.md', 'one two')
    const agent = anAgent()
    await swap(desk, agent, 'one', 'ONE')
    await swap(desk, agent, 'two', 'TWO')
    expect(pane.text).toBe('ONE TWO')
    close('a.md')
    disk.set('/space/a.md', 'ONE TWO three')

    await some(desk, agent, idsOf(agent, 'a.md').slice(1))
    expect(fileOf('a.md')).toBe('ONE two three')
  })

  test('comes back with a Redo, through what was typed since', async () => {
    const { desk, pane } = deskOpen('a.md', 'one two')
    const agent = anAgent()
    await swap(desk, agent, 'two', 'TWO')

    await some(desk, agent, idsOf(agent, 'a.md'), 'rewind-1')
    expect(pane.text).toBe('one two')
    pane.type(0, 'zero ')

    const note = located(desk, A)
    expect(await putBackAt(desk, agent, note, 'rewind-1')).toHaveLength(1)
    expect(pane.text).toBe('zero one TWO')
    expect(await putBackAt(desk, agent, note, 'rewind-1')).toEqual([])
  })
})

describe('a closed note whose write is refused', () => {
  test('keeps what would have gone, to be asked for again', async () => {
    const { desk, fileOf, refusing } = deskWith({ 'a.md': 'one two' })
    const agent = anAgent()
    await swap(desk, agent, 'two', 'TWO')
    const ids = idsOf(agent, 'a.md')
    const note = located(desk, A)

    refusing.next = true
    expect(await some(desk, agent, ids, 'rewind-1')).toEqual([])
    expect(idsOf(agent, 'a.md')).toEqual(ids)
    expect(tracksOf(agent.id).get('/space/a.md')?.holds('rewind-1')).toBe(false)
    expect(fileOf('a.md')).toBe('one TWO')

    expect(await some(desk, agent, ids, 'rewind-1')).toEqual(ids)
    expect(fileOf('a.md')).toBe('one two')

    refusing.next = true
    expect(await putBackAt(desk, agent, note, 'rewind-1')).toEqual([])
    expect(idsOf(agent, 'a.md')).toEqual([])
    expect(fileOf('a.md')).toBe('one two')

    expect(await putBackAt(desk, agent, note, 'rewind-1')).toEqual(ids)
    expect(fileOf('a.md')).toBe('one TWO')
  })
})

describe('a closed note opened and written in while its write is refused', () => {
  test('takes back the agent’s words, not the ones beside them', async () => {
    const { desk, open, disk } = deskWith({ 'a.md': 'one two' })
    const agent = anAgent()
    await swap(desk, agent, 'two', 'TWO')

    const replace = desk.replaceInNotes.bind(desk)
    let pane: ReturnType<typeof open> | null = null
    desk.replaceInNotes = () => {
      desk.replaceInNotes = replace
      pane = open('a.md')
      const note = desk.documentAt('/space/a.md')
      if (note) tracksOf(agent.id).get('/space/a.md')?.follow(note)
      pane.type(0, 'zero ')
      return Promise.resolve(0)
    }
    expect(await undoAgent(desk, agent, A)).toEqual({ undone: 0 })

    expect(await undoAgent(desk, agent, A)).toEqual({ undone: 1 })
    expect(disk.size).toBe(1)
    expect((pane as unknown as { text: string }).text).toBe('zero one two')
  })
})

describe('where an agent’s edits are', () => {
  test('is carried through the reader’s typing, and forgotten once taken back', async () => {
    const { desk, pane } = deskOpen('a.md', 'one two')
    const agent = anAgent()
    await swap(desk, agent, 'two', 'TWO')

    const track = tracksOf(agent.id).get('/space/a.md')
    const [id = ''] = track?.ids ?? []
    expect(track?.spansOf(id)).toEqual([{ from: 4, to: 7, removed: 'two', inserted: 'TWO' }])

    pane.type(0, 'ah ')
    expect(track?.spansOf(id)).toEqual([{ from: 7, to: 10, removed: 'two', inserted: 'TWO' }])

    await undoAgent(desk, agent, A)
    expect(track?.spansOf(id)).toEqual([])
  })
})

describe('a note an agent edited, moved', () => {
  test('is still the agent’s to take back, at its new name', async () => {
    const { desk, disk, fileOf } = deskWith({ 'Heron.md': 'A heron strikes' })
    const agent = anAgent()
    await editNote(desk, agent, { path: 'Heron.md' }, [
      { at: { quote: 'strikes' }, replace: 'STRIKES' },
    ])

    disk.set('/space/Bird.md', disk.get('/space/Heron.md') ?? '')
    disk.delete('/space/Heron.md')
    tracksMoved('/space/Heron.md', '/space/Bird.md')

    expect(idsOf(agent, 'Heron.md')).toEqual([])
    expect(idsOf(agent, 'Bird.md')).toHaveLength(1)
    expect(touchedBy('/space/Heron.md')).toEqual([])
    expect(touchedBy('/space/Bird.md').map((one) => one.id)).toEqual([agent.id])

    expect(await undoAgent(desk, agent, { path: 'Bird.md' })).toEqual({ undone: 1 })
    expect(fileOf('Bird.md')).toBe('A heron strikes')
    expect(touchedBy('/space/Bird.md')).toEqual([])
  })

  test('goes with the folder it is in, and its version from before is not kept twice', async () => {
    const { desk, disk, written } = deskWith({ 'Old/a.md': 'one two' })
    const agent = anAgent()
    await editNote(desk, agent, { path: 'Old/a.md' }, [{ at: { quote: 'one' }, replace: 'ONE' }])

    disk.set('/space/New/a.md', disk.get('/space/Old/a.md') ?? '')
    disk.delete('/space/Old/a.md')
    tracksMoved('/space/Old', '/space/New')
    expect(idsOf(agent, 'New/a.md')).toHaveLength(1)

    await editNote(desk, agent, { path: 'New/a.md' }, [{ at: { quote: 'two' }, replace: 'TWO' }])
    expect(idsOf(agent, 'New/a.md')).toHaveLength(2)
    expect(written.map((one) => one.keeping?.snapshot)).toEqual([true, false])
  })

  test('onto a name with a track of its own keeps both, each back when the way is clear', async () => {
    const { desk, disk, fileOf } = deskWith({ 'A.md': 'aaa', 'B.md': 'bbb' })
    const agent = anAgent()
    await editNote(desk, agent, { path: 'B.md' }, [{ at: { quote: 'bbb' }, replace: 'BBB' }])
    await editNote(desk, agent, { path: 'A.md' }, [{ at: { quote: 'aaa' }, replace: 'AAA' }])

    const heldBack = disk.get('/space/B.md') ?? ''
    disk.set('/space/B.md', disk.get('/space/A.md') ?? '')
    disk.delete('/space/A.md')
    tracksMoved('/space/A.md', '/space/B.md')
    expect(idsOf(agent, 'B.md')).toHaveLength(1)
    expect(touchedBy('/space/B.md').map((one) => one.edits)).toEqual([1])

    expect(await undoAgent(desk, agent, { path: 'B.md' })).toEqual({ undone: 1 })
    expect(fileOf('B.md')).toBe('aaa')

    disk.set('/space/A.md', 'aaa')
    disk.set('/space/B.md', heldBack)
    tracksMoved('/space/B.md', '/space/A.md')
    expect(idsOf(agent, 'B.md')).toHaveLength(1)
    expect(touchedBy('/space/B.md').map((one) => one.edits)).toEqual([1])
    expect(await undoAgent(desk, agent, { path: 'B.md' })).toEqual({ undone: 1 })
    expect(fileOf('B.md')).toBe('bbb')
  })
})
