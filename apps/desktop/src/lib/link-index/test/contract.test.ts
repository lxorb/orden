import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { type OpenNote, portOf, providePort, type SyncFileOp, workspaceNotes } from '@orden/contracts'
import { pressQueryRow, queryRowsHtml, readsWords, serveLinks, spaceLinks } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}
const reachedApis = () =>
  sources(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
      (found) => found[1],
    ),
  )
test('the module stands on its own reads the workspace, the search, the reading view, the bases and the canvas through no file of theirs', () => {
  expect([...new Set(reachedApis())].sort()).toEqual([
    'graph',
    'launch',
    'link-format',
    'platform',
    'sharing',
    'ui-kit',
  ])
  const text = sources(SRC)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  expect(text).not.toMatch(/(?:from |import\()'[^']*workspace/)
})
describe('the link index', () => {
  test('reads words out of notes, canvases, pages and web shortcuts only', () => {
    expect(['a.md', 'b.canvas', 'c.pages', 'd.url', 'e.png'].map(readsWords)).toEqual([true, true, true, true, false])
  })
  test('draws what a note shows through the services the app lends it', async () => {
    const asked: string[] = []
    serveLinks({
      html: (text, path) => Promise.resolve(`<p>${text} ${String(path)}</p>`),
      bases: () => Promise.resolve(() => () => void asked.push('base stopped')),
    })
    const index = spaceLinks().index(null)
    await expect(index.render?.('words', null)).resolves.toBe('<p>words null</p>')
    const stop = index.mountBase?.({} as HTMLElement, { code: 'filter' })
    await new Promise((resolve) => setTimeout(resolve))
    stop?.()
    expect(asked).toEqual(['base stopped'])
  })
  test('answers a query block from the search the app lends it, leaving out what the workspace leaves out', async () => {
    expect(pressQueryRow(null)).toBe(false)
    const asked: (readonly string[])[] = []
    const unbind = providePort('workspace.notes', {
      ...workspaceNotes(),
      activeRoot: '/s',
      leftOut: () => ['Archive'],
    })
    serveLinks({
      search: (_root, _query, _terms, _limit, found, excluded) => {
        asked.push(excluded)
        found({ hits: [] })
        return Promise.resolve()
      },
    })
    await expect(queryRowsHtml('tag:#plan', 'Nothing found')).resolves.toContain('Nothing found')
    unbind()
    expect(asked).toEqual([['Archive']])
  })
  test('moves nothing when a note keeps its place, and leaves the notes it cannot find open', async () => {
    const opened: string[] = []
    const unbind = providePort('workspace.notes', {
      ...workspaceNotes(),
      documentAt: (path) => {
        opened.push(path)
        return null
      },
    })
    await expect(spaceLinks().retarget('/s/A.md', '/s/A.md', '/s')).resolves.toBe(0)
    await expect(spaceLinks().nameBlock('Plan.md', 1, null)).resolves.toBeNull()
    unbind()
    expect(opened).toEqual([])
  })
  test('a note copied into another folder resolves every link and picture its source resolved', () => {
    const index = spaceLinks()
    void index.build('/s')
    for (const path of ['Work/Plan.md', 'Read me.md', 'Work/Sub/x.md', 'Work/Sub/y.md']) {
      index.noteSaved(`/s/${path}`, `# ${path}`)
    }
    index.fileAdded('assets/a.png')
    expect(index.rebased('![](../assets/a.png)\n[readme](../Read%20me.md)', '/s/Work/Plan.md', '/s/Plan.md')).toBe(
      '![](assets/a.png)\n[readme](Read%20me.md)',
    )
    const inner = '[y](y.md)\n[plan](../Plan.md)\n![](../../assets/a.png)'
    expect(index.rebased(inner, '/s/Work/Sub/x.md', '/s/Copied/Sub/x.md', '/s/Work/Sub')).toBe(
      '[y](y.md)\n[plan](../../Work/Plan.md)\n![](../../assets/a.png)',
    )
    expect(index.rebased(inner, '/s/Work/Sub/x.md', '/s/Copied/Sub/x.md')).toContain('[y](../../Work/Sub/y.md)')
  })
  test('a page note carries its paper through renames, moves into a folder, their undoing and its removal', async () => {
    const before = '![[Paper.pages.pdf]]\n[[Paper.pages.pdf#page=2]]\n[p](Paper.pages.pdf)'
    const card = (file: string) =>
      JSON.stringify({ nodes: [{ id: 'c', type: 'file', file, x: 0, y: 0, width: 9, height: 9 }], edges: [] })
    const disk = new Map([
      ['/s/Paper.pages', '{"nodes":[],"edges":[]}'],
      ['/s/Paper.pages.pdf', '%PDF'],
      ['/s/Alpha.md', before],
      ['/s/Board.canvas', card('Paper.pages.pdf')],
    ])
    const answer = (command: string, args: Record<string, unknown> = {}): unknown => {
      const path = String(args.path)
      if (command === 'path_exists') return disk.has(path)
      if (command === 'read_note') return disk.get(path) ?? Promise.reject(new Error(path))
      if (command === 'write_note') return void disk.set(path, String(args.content))
      if (command === 'scan_links') return { notes: index.held(), files: papers() }
      return null
    }
    const papers = () => [...disk.keys()].filter((one) => one.endsWith('.pdf')).map((one) => one.slice(3))
    const backend = portOf('backend.web')
    providePort('backend.web', {
      invoke: <T>(command: string, args?: Record<string, unknown>) => Promise.resolve(answer(command, args) as T),
    })
    const index = spaceLinks()
    void index.build('/s')
    for (const [path, text] of disk) if (!path.endsWith('.pdf')) index.noteSaved(path, text)
    index.fileAdded(...papers())
    await vi.waitFor(() => expect(index.held()).toHaveLength(3))
    const saved = () => index.noteSaved('/s/Alpha.md', disk.get('/s/Alpha.md') ?? '')
    const open = (path: string): OpenNote | null => {
      const text = disk.get(path)
      if (text === undefined) return null
      const writeTo = (at: string, words: string) => Promise.resolve(void disk.set(at, words)).then(() => words)
      return { text, onDisk: text, flush: () => undefined, edited: () => undefined, wroteAs: () => undefined, writeTo }
    }
    const moved = async (from: string, to: string) => {
      for (const [path, text] of [...disk]) {
        const now = path === from ? to : path === `${from}.pdf` ? `${to}.pdf` : null
        if (now === null) continue
        disk.delete(path)
        disk.set(now, text)
      }
      const op: SyncFileOp = { op: 'moved', kind: 'file', from, to, root: '/s', into: '/s' }
      await index.follow(op)
      await index.retarget(from, to, '/s', open, { moved: true })
    }
    const reached = () => index.outgoing('/s/Alpha.md').map((one) => one.to)
    await moved('/s/Paper.pages', '/s/Thesis.pages')
    expect(reached()).toEqual([null, null, null])
    expect(disk.get('/s/Alpha.md')).toBe(before.replaceAll('Paper', 'Thesis'))
    expect(disk.get('/s/Board.canvas')).toBe(card('Thesis.pages.pdf'))
    saved()
    expect(reached()).toEqual(['Thesis.pages.pdf', 'Thesis.pages.pdf', 'Thesis.pages.pdf'])
    await moved('/s/Thesis.pages', '/s/Paper.pages')
    expect([disk.get('/s/Alpha.md'), disk.get('/s/Board.canvas')]).toEqual([before, card('Paper.pages.pdf')])
    saved()
    await moved('/s/Paper.pages', '/s/Box/Paper.pages')
    saved()
    expect(reached()).toEqual(['Box/Paper.pages.pdf', 'Box/Paper.pages.pdf', 'Box/Paper.pages.pdf'])
    expect(disk.get('/s/Board.canvas')).toBe(card('Box/Paper.pages.pdf'))
    await moved('/s/Box/Paper.pages', '/s/Paper.pages')
    expect([disk.get('/s/Alpha.md'), disk.get('/s/Board.canvas')]).toEqual([before, card('Paper.pages.pdf')])
    saved()
    await index.follow({ op: 'removed', kind: 'file', path: '/s/Paper.pages', root: '/s' })
    expect(reached()).toEqual([null, null, null])
    await index.follow({
      op: 'moved',
      kind: 'file',
      from: '/x/Paper.pages',
      to: '/s/Paper.pages',
      root: null,
      into: '/s',
    })
    expect(reached()).toEqual(['Paper.pages.pdf', 'Paper.pages.pdf', 'Paper.pages.pdf'])
    if (backend.ok) providePort('backend.web', backend.value)
  })
  test('a chat in the space is no file it lists, no node of the graph and no suggestion', async () => {
    const backend = portOf('backend.web')
    const scanned = { notes: [], files: ['Talk.chat', 'b.png'] }
    providePort('backend.web', {
      invoke: <T>(command: string) => Promise.resolve((command === 'scan_links' ? scanned : null) as T),
    })
    const index = spaceLinks()
    void index.build('/s')
    index.noteSaved('/s/A.md', '[[Team.chat]]\n![[Team.chat]]\n[t](Team.chat)')
    index.noteSaved('/s/Team.chat', '{"id":"c1"}')
    index.fileAdded('Lobby.chat', 'a.png')
    index.fileWritten('/s', 'Desk.chat')
    await index.follow({ op: 'created', kind: 'folder', path: '/s/Room', root: '/s' })
    expect(index.index('/s/A.md').files).toEqual(['Room/b.png', 'a.png'])
    expect(index.index('/s/A.md').notes.map((one) => one.path)).toEqual(['A.md'])
    expect(index.pictureOf(true).nodes.map((one) => one.path)).toEqual(['A.md'])
    expect(index.pictureOf(false).nodes.map((one) => one.path)).toEqual(['A.md'])
    expect(index.outgoing('/s/A.md').map((one) => one.to)).toEqual([null, null, null])
    if (backend.ok) providePort('backend.web', backend.value)
  })
  test('a part carved out of a note takes the links into its headings and blocks along, and leaves the rest', async () => {
    const alpha = '[[Beta#Later]] and [[Beta#^blk]] and [[Beta]] and [[Beta#intro-less-heading]]\n[m](Beta.md#Later)'
    const part = '## Later\n\nsoon\n\nkept ^blk\n'
    const card = (subpath?: string) => ({
      id: subpath ?? 'whole',
      type: 'file',
      file: 'Beta.md',
      subpath,
      x: 0,
      y: 0,
      width: 9,
      height: 9,
    })
    const board = (...nodes: object[]) => JSON.stringify({ nodes, edges: [] })
    const disk = new Map([
      ['/s/Beta.md', '# Beta\n\nintro\n'],
      ['/s/Later.md', part],
      ['/s/Alpha.md', alpha],
      ['/s/Board.canvas', board(card('#^blk'), card(), card('#page=2'))],
    ])
    const backend = portOf('backend.web')
    const index = spaceLinks()
    providePort('backend.web', {
      invoke: <T>(command: string) =>
        Promise.resolve((command === 'scan_links' ? { notes: index.held(), files: [] } : null) as T),
    })
    void index.build('/s')
    for (const [path, text] of disk) index.noteSaved(path, text)
    await vi.waitFor(() => expect(index.held()).toHaveLength(4))
    const open = (path: string): OpenNote | null => {
      const text = disk.get(path)
      if (text === undefined) return null
      const writeTo = (at: string, words: string) => Promise.resolve(void disk.set(at, words)).then(() => words)
      return { text, onDisk: text, flush: () => undefined, edited: () => undefined, wroteAs: () => undefined, writeTo }
    }
    const how = { part, wrote: [] as { path: string; before: string; after: string }[], touched: [] as string[] }
    await index.retarget('/s/Beta.md', '/s/Later.md', '/s', open, how)
    const after = '[[Later#Later]] and [[Later#^blk]] and [[Beta]] and [[Beta#intro-less-heading]]\n[m](Later.md#Later)'
    expect(disk.get('/s/Alpha.md')).toBe(after)
    const cards = JSON.parse(disk.get('/s/Board.canvas') ?? '') as { nodes: { file: string }[] }
    expect(cards.nodes.map((one) => one.file)).toEqual(['Later.md', 'Beta.md', 'Beta.md'])
    expect(how.wrote).toContainEqual({ path: '/s/Alpha.md', before: alpha, after })
    expect(how.touched.sort()).toEqual(['/s/Alpha.md', '/s/Board.canvas'])
    expect(disk.get('/s/Beta.md')).toBe('# Beta\n\nintro\n')
    if (backend.ok) providePort('backend.web', backend.value)
  })
  test('holds a path once, whichever of a save and a move onto it comes first', () => {
    const index = spaceLinks()
    void index.build('/s')
    const moved = (from: string, to: string, kind: 'file' | 'folder' = 'file') =>
      index.follow({ op: 'moved', kind, from: `/s/${from}`, to: `/s/${to}`, root: '/s', into: '/s' })
    for (const path of ['Bxx.md', 'Cxx.md', 'A/x.md', 'A/y.md']) index.noteSaved(`/s/${path}`, `# ${path}\n`)
    index.noteSaved('/s/Alpha.md', '[[Gxx]] [[Hxx]] [[B/x]] [[B/y]]')
    index.noteSaved('/s/Gxx.md', '# Gxx\n\nwords\n')
    void moved('Bxx.md', 'Gxx.md')
    void moved('Cxx.md', 'Hxx.md')
    index.noteSaved('/s/Hxx.md', '# Hxx\n')
    index.noteSaved('/s/B/x.md', '# B/x\n')
    void moved('A', 'B', 'folder')
    const paths = index.held().map((one) => one.path)
    expect(paths.sort()).toEqual(['Alpha.md', 'B/x.md', 'B/y.md', 'Gxx.md', 'Hxx.md'])
    expect(index.held().find((one) => one.path === 'Gxx.md')?.headings).toEqual(['Gxx'])
    expect(index.held().find((one) => one.path === 'B/x.md')?.headings).toEqual(['B/x'])
    const nodes = index.pictureOf(false).nodes.map((one) => one.path)
    expect(nodes).toHaveLength(new Set(nodes).size)
    expect(index.backlinks('/s/Gxx.md')).toHaveLength(1)
  })
  test('a note leaving its space names the pictures it reaches there, and its links reach their copies in the new space', async () => {
    const index = spaceLinks()
    void index.build('/s')
    index.spaceOf = (path) => (path.startsWith('/t/') ? '/t' : '/s')
    const plan = '![](../assets/a.png)\n![[b.png]]\n[n](../Other.md)\n[[Other]]\n![](pic.png)'
    index.noteSaved('/s/Work/Plan.md', plan)
    index.noteSaved('/s/Other.md', '# Other')
    index.fileAdded('assets/a.png', 'assets/b.png', 'Work/pic.png')
    const carried = (...paths: string[]) => paths.map((one) => ({ from: `/s/${one}`, to: `/t/${one}` }))
    expect(await index.leaving(plan, '/s/Work/Plan.md', '/t/Plan.md')).toEqual({
      text: '![](assets/a.png)\n![[b.png]]\n[n](../Other.md)\n[[Other]]\n![](Work/pic.png)',
      carry: carried('assets/a.png', 'assets/b.png', 'Work/pic.png'),
    })
    expect(await index.leaving(plan, '/s/Work/Plan.md', '/t/Work/Plan.md', '/s/Work')).toEqual({
      text: plan,
      carry: carried('assets/a.png', 'assets/b.png'),
    })
    expect(await index.leaving(plan, '/s/Work/Plan.md', '/s/Plan.md')).toBeNull()
  })
})
