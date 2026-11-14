import '../sync-ports'
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
const { newMirror, notePass } = await import('../sync-mirror/src/api')
const { push } = await notePass()

const ROOT = '/spaces/One'
const PATH = `${ROOT}/a.md`
const NOBODY = new Set<string>()

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

function account() {
  const offers: string[] = []
  const told: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const asked = new Request(url, init)
    if (asked.method !== 'POST' || !asked.url.endsWith('/notes')) return Response.json({})
    const { content } = (await asked.json()) as { content: string }
    offers.push(content)
    return Response.json({ error: 'too big' }, { status: 413 })
  })
  const mirror = newMirror('one', ROOT)
  const pass = () => push(mirror, 'token', NOBODY, { refused: (path) => told.push(path) })
  return { offers, told, pass }
}

test('a refused note changed in place is offered again, with the words that went down', async () => {
  const note = await opened('a [[old]]\n')
  const { offers, told, pass } = account()
  await pass()
  await pass()
  expect(offers).toEqual(['a [[old]]\n'])
  expect(told).toEqual(['a.md'])

  d.files.set(PATH, 'a [[old]]\nfrom a git pull\n')
  const after = 'a [[new]]\n'
  const knew = change(note, after)
  const written = await writeEdited(note, PATH, after, knew)
  expect(written).toBe('a [[new]]\nfrom a git pull\n')

  await pass()
  expect(offers).toEqual(['a [[old]]\n', 'a [[new]]\nfrom a git pull\n'])
})

test('a write that did not go down asks the account nothing new until it has', async () => {
  const note = await opened('a [[old]]\n')
  const { offers, pass } = account()
  await pass()

  const after = 'a [[new]]\n'
  const knew = change(note, after)
  refused.times = 1
  expect(await writeEdited(note, PATH, after, knew)).toBeNull()
  expect(note.dirty).toBe(true)
  await pass()
  expect(offers).toEqual(['a [[old]]\n'])

  await workspace.writesSettled()
  await vi.waitFor(() => expect(d.files.get(PATH)).toBe(after), { timeout: 5000 })
  await pass()
  expect(offers).toEqual(['a [[old]]\n', after])
})
