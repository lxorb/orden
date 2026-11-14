import { expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const refused = vi.hoisted(() => ({ times: 0 }))
vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'write_note' && refused.times > 0) {
      refused.times -= 1
      return Promise.reject(new Error('no room'))
    }
    return disk.current!.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { startAcross } = await import('./across')
await startAcross()
const { writeEdited } = await import('./in-turn')

const ROOT = '/spaces/One'
const PATH = `${ROOT}/a.md`

async function opened(words: string) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add(ROOT)
  d.files.set(PATH, words)
  workspace.spaces = [{ id: 'one', name: 'One', root: ROOT }]
  workspace.activeSpaceId = 'one'
  workspace.tabs = []
  await workspace.loadTree()
  await workspace.open(PATH)
  return workspace.tabs[0]!.note
}

function change(note: Awaited<ReturnType<typeof opened>>, words: string) {
  const knew = note.onDisk
  note.edited([{ from: 0, to: note.latest.length, insert: words }], words)
  return knew
}

test('an outside edit it had not heard of is taken in, not replaced', async () => {
  const note = await opened('a [[old]]\n\nend\n')
  d.files.set(PATH, 'a [[old]]\n\nend\nfrom a git pull\n')
  const after = 'a [[new]]\n\nend\n'
  const knew = change(note, after)

  const written = await writeEdited(note, PATH, after, knew)

  expect(d.files.get(PATH)).toBe('a [[new]]\n\nend\nfrom a git pull\n')
  expect(written).toBe('a [[new]]\n\nend\nfrom a git pull\n')
  expect(note.latest).toBe('a [[new]]\n\nend\nfrom a git pull\n')
  expect(note.dirty).toBe(false)
})

test('a refused write stays owed and lands', async () => {
  const note = await opened('a [[old]]\n')
  const after = 'a [[new]]\n'
  const knew = change(note, after)
  refused.times = 1

  const written = await writeEdited(note, PATH, after, knew)

  expect(written).toBeNull()
  expect(note.dirty).toBe(true)
  expect(d.files.get(PATH)).toBe('a [[old]]\n')

  await workspace.writesSettled()
  await vi.waitFor(() => expect(d.files.get(PATH)).toBe('a [[new]]\n'), { timeout: 5000 })
  expect(note.dirty).toBe(false)
})
