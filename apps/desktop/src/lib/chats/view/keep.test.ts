import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Save as note in a chat that sits in a space shared to be read. The note and its
 *  files would be written into the owner's space, which nothing may be written in
 *  (B273), so the gesture refuses there and the message's menu does not offer it.
 *  Every write the gesture can make is stood in for and logged. */

const wrote = vi.hoisted(() => [] as string[])
const readOnly = vi.hoisted(() => new Set<string>())

vi.mock('../../workspace/write-file', () => ({
  writeFile: (path: string) => {
    wrote.push(path)
    return Promise.resolve()
  },
}))
vi.mock('../../workspace.svelte', () => ({
  workspace: {
    freeName: (_folder: string, wanted: string) => wanted,
    fileCame: () => Promise.resolve(),
    open: () => Promise.resolve(),
  },
}))
vi.mock('../../sharing.svelte', () => ({
  canWriteAt: (path: string) => ![...readOnly].some((root) => path.startsWith(`${root}/`)),
}))
vi.mock('./source.svelte', () => ({
  store: () => ({
    history: () => Promise.resolve([]),
    fileUrl: () => Promise.resolve('blob:picture'),
  }),
}))
vi.mock('../../assets', () => ({
  storeBeside: (_bytes: ArrayBuffer, beside: string, name: string) => {
    wrote.push(`${beside} + ${name}`)
    return Promise.resolve(name)
  },
}))
vi.mock('../../surfaces.svelte', () => ({ showQuickAdd: () => undefined }))
vi.stubGlobal('fetch', () => Promise.resolve(new Response(new ArrayBuffer(4))))

const { saveAsNote } = await import('./keep')
const { messageMenu } = await import('./message-menu')

const page = {
  id: 'c1',
  me: 'me',
  members: [],
  entry: { path: '/theirs/Team.chat', name: 'Team' },
  view: { meta: { posting: 'everyone' } },
  isSaved: () => false,
}
const message = {
  id: 'm1',
  author: 'someone',
  at: 0,
  body: 'hello',
  files: [{ name: 'photo.png', hash: 'h1' }],
  replies: 0,
  mentions: [],
  deleted: false,
}
const gestures = { reply: () => undefined, quote: () => undefined, edit: () => undefined }
const labels = () =>
  messageMenu(page as never, message as never, 'write', gestures).flatMap((row) =>
    row && 'label' in row ? [row.label] : [],
  )

beforeEach(() => {
  wrote.length = 0
  readOnly.clear()
})

describe('save as note', () => {
  test('writes the note and its files beside a chat in a space that may be written in', async () => {
    await saveAsNote(page as never, message as never, null)

    expect(wrote).toEqual(['/theirs/hello.md + photo.png', '/theirs/hello.md'])
    expect(labels()).toContain('Save as note')
  })

  test('writes nothing in a space shared to be read, and is not offered there', async () => {
    readOnly.add('/theirs')

    await saveAsNote(page as never, message as never, null)

    expect(wrote).toEqual([])
    expect(labels()).not.toContain('Save as note')
    expect(labels()).toContain('Add as task')
  })
})
