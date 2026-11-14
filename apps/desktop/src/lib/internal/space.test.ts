import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readsAsText, webInvoke } from '../web/commands'
import { mountRows } from '../web/store'
import { InternalFolder } from './folder'
import { MemoryBytes } from './memory'
import { mountRoot } from './roots'
import { internalRows } from './rows'

const crate = vi.hoisted(() => ({ calls: [] as { command: string; args: unknown }[] }))

vi.mock('./work', () => ({
  workingFolder: (path: string) =>
    Promise.resolve(
      path.includes('Plans') ? 'C:\\Users\\me\\Orden\\.orden\\.work\\Plans\\Work' : null,
    ),
}))

vi.mock('../crate/src/native', () => ({
  invoke: (command: string, args: unknown) => {
    crate.calls.push({ command, args })
    if (command === 'list_trash')
      return Promise.resolve([
        { id: 'disk-1', kind: 'note', name: 'Old.md', from: '/d/Old.md', trashedAt: 1 },
      ])
    if (command === 'purge_trash_older_than') return Promise.resolve(2)
    return Promise.resolve(null)
  },
}))

const WEB = '/internal-t'
const undo: (() => void)[] = []

afterEach(() => {
  for (const one of undo.splice(0)) one()
  crate.calls.length = 0
})

async function mounted(root = 'C:\\Users\\me\\Orden\\Plans') {
  const bytes = new MemoryBytes()
  let keys = 0
  let clock = 1000
  const folder = await InternalFolder.open('one', bytes, {
    now: () => (clock += 1),
    key: () => `k${String((keys += 1))}`,
    foldsCase: true,
  })
  undo.push(mountRows(WEB, internalRows(folder, WEB, readsAsText)))
  undo.push(mountRoot({ root, web: WEB, folder }))
  return { bytes, folder, root }
}

const keyAt = async (folder: InternalFolder, path: string) => (await folder.at(path))?.key

interface Entry {
  name: string
  path: string
  is_dir: boolean
  children: Entry[]
}

const names = (entry: Entry): unknown =>
  entry.is_dir ? { [entry.name]: entry.children.map(names) } : entry.name

describe('a space Orden keeps, through the file commands', () => {
  test('lists what is written, folders and empty ones too, from its index', async () => {
    const { folder } = await mounted()
    await webInvoke('write_note', { path: `${WEB}/Work/Plan.md`, content: 'ship it' })
    await webInvoke('create_folder', { path: `${WEB}/Empty` })
    await webInvoke('write_bytes', { path: `${WEB}/Work/cat.png`, base64: 'AQI=' })

    const tree = await webInvoke<Entry>('read_tree', { root: WEB, options: { every: true } })
    expect(tree.children.map(names)).toEqual([{ Empty: [] }, { Work: ['cat.png', 'Plan.md'] }])
    expect(await webInvoke('read_note', { path: `${WEB}/Work/Plan.md` })).toBe('ship it')
    expect((await folder.at('Empty'))?.key).toBeNull()
    expect(await webInvoke('path_exists', { path: `${WEB}/Work/cat.png` })).toBe(true)
  })

  test('renames a folder as one step: every key stays and no byte is written again', async () => {
    const { bytes, folder } = await mounted()
    await webInvoke('write_note', { path: `${WEB}/Work/Plan.md`, content: 'ship it' })
    await webInvoke('write_bytes', { path: `${WEB}/Work/cat.png`, base64: 'AQI=' })
    const plan = await keyAt(folder, 'Work/Plan.md')
    const cat = await keyAt(folder, 'Work/cat.png')
    const written = bytes.writes

    await webInvoke('rename_note', { from: `${WEB}/Work`, to: `${WEB}/Done` })

    expect(bytes.writes).toBe(written)
    expect(await keyAt(folder, 'Done/Plan.md')).toBe(plan)
    expect(await keyAt(folder, 'Done/cat.png')).toBe(cat)
    expect(await folder.at('Work')).toBeNull()
  })

  test('a PDF takes its highlights along, and a page note its paper', async () => {
    const { folder } = await mounted()
    await webInvoke('write_bytes', { path: `${WEB}/Paper.pdf`, base64: 'AQI=' })
    await webInvoke('write_highlights', { path: `${WEB}/Paper.pdf`, content: '[1]' })
    await webInvoke('write_note', { path: `${WEB}/Talk.pages`, content: '{}' })
    await webInvoke('write_bytes', { path: `${WEB}/Talk.pages.pdf`, base64: 'AQI=' })
    const paper = await keyAt(folder, 'Talk.pages.pdf')

    await webInvoke('rename_note', { from: `${WEB}/Paper.pdf`, to: `${WEB}/Read.pdf` })
    await webInvoke('rename_note', { from: `${WEB}/Talk.pages`, to: `${WEB}/Slides.pages` })

    expect(await webInvoke('read_highlights', { path: `${WEB}/Read.pdf` })).toBe('[1]')
    expect(await keyAt(folder, 'Slides.pages.pdf')).toBe(paper)
    expect((await folder.list()).map((one) => one.path)).toEqual([
      'Read.pdf',
      'Read.pdf.highlights.json',
      'Slides.pages',
      'Slides.pages.pdf',
    ])
  })

  test('puts a deleted folder back from Recently deleted under the keys it had', async () => {
    const { bytes, folder } = await mounted()
    await webInvoke('write_note', { path: `${WEB}/Work/Plan.md`, content: 'ship it' })
    const plan = await keyAt(folder, 'Work/Plan.md')

    const item = await webInvoke<{ id: string; from: string }>('trash_item', {
      path: `${WEB}/Work`,
      kind: 'folder',
    })
    expect(item.from).toBe(`${WEB}/Work`)
    expect(await webInvoke('path_exists', { path: `${WEB}/Work` })).toBe(false)
    expect(bytes.texts.has(plan ?? '')).toBe(true)
    expect((await webInvoke<{ id: string }[]>('list_trash')).map((one) => one.id)).toEqual([
      item.id,
    ])

    await webInvoke('create_folder', { path: `${WEB}/Work` })
    expect(await webInvoke('restore_trash', { id: item.id })).toBe(`${WEB}/Work 2`)
    expect(await keyAt(folder, 'Work 2/Plan.md')).toBe(plan)
    expect(await webInvoke('list_trash')).toEqual([])
  })

  test('copies under new keys, and deletes a folder with everything in it', async () => {
    const { bytes, folder } = await mounted()
    await webInvoke('write_note', { path: `${WEB}/Work/Plan.md`, content: 'ship it' })
    await webInvoke('create_folder', { path: `${WEB}/Work/Empty` })

    await webInvoke('copy_path', { from: `${WEB}/Work`, to: `${WEB}/Copy` })
    expect(await keyAt(folder, 'Copy/Plan.md')).not.toBe(await keyAt(folder, 'Work/Plan.md'))
    expect((await folder.at('Copy/Empty'))?.key).toBeNull()

    await webInvoke('delete_folder', { path: `${WEB}/Work` })
    expect((await folder.list()).map((one) => one.path)).toEqual([
      'Copy',
      'Copy/Empty',
      'Copy/Plan.md',
    ])
    expect([...bytes.texts.values()]).toEqual(['ship it'])
  })

  test('takes an empty folder away and leaves one with something in it', async () => {
    const { folder } = await mounted()
    await webInvoke('create_folder', { path: `${WEB}/Empty` })
    await webInvoke('write_note', { path: `${WEB}/Full/Plan.md`, content: 'x' })

    await webInvoke('remove_empty_folder', { path: `${WEB}/Empty` })
    await webInvoke('remove_empty_folder', { path: `${WEB}/Full` })

    expect((await folder.list()).map((one) => one.path)).toEqual(['Full', 'Full/Plan.md'])
  })
})

describe('the call to the crate, on a desktop', () => {
  test('a path in a kept space is answered by its folder, spelled as the app spells it', async () => {
    const { internalInvoke } = await import('./route')
    const { folder, root } = await mounted()
    const all = () => [{ root, web: WEB, folder }]

    await internalInvoke(
      'write_note',
      { path: `${root}\\Work\\Plan.md`, content: 'ship it' },
      all(),
    )
    const tree = await internalInvoke<Entry>('read_tree', { root }, all())

    expect(tree.name).toBe('Plans')
    expect(tree.path).toBe(root)
    expect(tree.children[0]?.path).toBe(`${root}\\Work`)
    expect(tree.children[0]?.children[0]?.path).toBe(`${root}\\Work\\Plan.md`)
    expect(await internalInvoke('file_stamp', { path: `${root}\\Work\\Plan.md` }, all())).toEqual({
      modified: 1001,
      len: 7,
    })
    expect(await internalInvoke('file_stamp', { path: `${root}\\Work` }, all())).toBeNull()
    const { forInternal } = await import('./roots')
    expect(forInternal('file_there', { path: `${root}\\Work\\Plan.md` })).toBe(true)
    expect(await internalInvoke('file_there', { path: `${root}\\Work\\Plan.md` }, all())).toBe(true)
    expect(await internalInvoke('file_there', { path: `${root}\\Work` }, all())).toBe(true)
    expect(await internalInvoke('file_there', { path: `${root}\\Gone.md` }, all())).toBe(false)
    await expect(internalInvoke('read_tree', { root: `${root}\\Nope` }, all())).rejects.toThrow(
      'not a folder',
    )
    expect(crate.calls).toEqual([])
  })

  test('Recently deleted lists both, and each item is put back by whoever holds it', async () => {
    const { internalInvoke } = await import('./route')
    const { folder, root } = await mounted()
    const all = () => [{ root, web: WEB, folder }]
    await internalInvoke('write_note', { path: `${root}\\Plan.md`, content: 'x' }, all())
    const item = await internalInvoke<{ id: string; from: string }>(
      'trash_item',
      { path: `${root}\\Plan.md`, kind: 'note' },
      all(),
    )
    expect(item.from).toBe(`${root}\\Plan.md`)

    const listed = await internalInvoke<{ id: string; from: string }[]>('list_trash', {}, all())
    expect(listed.map((one) => [one.id, one.from])).toEqual([
      [item.id, `${root}\\Plan.md`],
      ['disk-1', '/d/Old.md'],
    ])

    expect(await internalInvoke('restore_trash', { id: item.id }, all())).toBe(`${root}\\Plan.md`)
    await internalInvoke('restore_trash', { id: 'disk-1' }, all())
    expect(crate.calls.map((one) => one.command)).toContain('restore_trash')
    expect(await internalInvoke('purge_trash_older_than', { age: 0 }, all())).toBe(2)
  })

  test('a shell in a kept space starts in its working folder, and nothing else reaches the disk', async () => {
    const { internalInvoke } = await import('./route')
    const { forInternal } = await import('./roots')
    const { folder, root } = await mounted()
    const all = () => [{ root, web: WEB, folder }]

    expect(forInternal('pty_spawn', { folder: `${root}\\Work` })).toBe(true)
    expect(forInternal('pty_spawn', { folder: 'C:\\Users\\me' })).toBe(false)
    await internalInvoke('pty_spawn', { id: 't1', folder: `${root}\\Work` }, all())
    expect(crate.calls).toEqual([
      {
        command: 'pty_spawn',
        args: { id: 't1', folder: 'C:\\Users\\me\\Orden\\.orden\\.work\\Plans\\Work' },
      },
    ])

    expect(
      await internalInvoke('same_pdf', { from: '/tmp/Paper.pdf', space: root }, all()),
    ).toBeNull()
    expect(crate.calls).toHaveLength(1)
  })
})
