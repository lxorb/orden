import { flushSync } from 'svelte'
import { beforeAll, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'scan_links') return scanned(String(args?.root))
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { scanNote } = await import('@orden/scan/note')
const { scanRows } = await import('@orden/bases/scan')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { links } = await import('../../src/lib/link-index.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
const { runAgentVerb } = await import('../../src/lib/agents/workspace/index')
const { callerOf } = await import('../../src/lib/automation/caller')

function scanned(root: string) {
  const inside = [...(disk.current?.files ?? [])].filter(([path]) => path.startsWith(`${root}/`))
  const relative = (path: string) => path.slice(root.length + 1)
  return {
    notes: inside
      .filter(([path]) => path.endsWith('.md'))
      .map(([path, text]) => ({
        ...scanNote(relative(path), text),
        ...scanRows(text),
        stamp: { size: text.length, mtime: 1, ctime: 1 },
      })),
    files: inside.filter(([path]) => !path.endsWith('.md')).map(([path]) => relative(path)),
  }
}

const WORK = '/spaces/Work'
const HOME = '/spaces/Home'

const { rows } = await import('../../src/lib/rows/rows.svelte')
const tasks = (space: string) =>
  rows
    .of(space)
    .filter((row) => row.kind === 'task')
    .map((row) => `${row.path}: ${row.task?.text ?? ''}`)

beforeAll(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(`${WORK}/A/Plan.md`, '- [ ] Read [spec](Spec.md)\n')
  one.files.set(`${WORK}/A/Spec.md`, '# Spec\n')
  one.files.set(`${HOME}/A/Plan.md`, '- [ ] Read [spec](Spec.md)\n')
  one.files.set(`${HOME}/A/Spec.md`, '# Spec\n')
  for (const root of [WORK, HOME]) {
    one.folders.add(`${root}/A`)
    one.folders.add(`${root}/B`)
  }

  workspace.spaces = [
    { id: 'work', name: 'Work', root: WORK },
    { id: 'home', name: 'Home', root: HOME },
  ]
  workspace.activeSpaceId = 'work'
  await workspace.loadTree()
  void startup.shown()
  await links.build(WORK)
  flushSync()
  await vi.waitFor(() => {
    expect(tasks('Work')).toEqual(['A/Plan.md: Read [spec](Spec.md)'])
    expect(tasks('Home')).toEqual(['A/Plan.md: Read [spec](Spec.md)'])
  })
})

test('a note moved to another folder, its own relative link rewritten, keeps the rows of its words', async () => {
  const one = disk.current
  await workspace.move(`${WORK}/A/Plan.md`, `${WORK}/B`)
  await workspace.writesSettled()

  expect(one?.files.get(`${WORK}/B/Plan.md`)).toBe('- [ ] Read [spec](../A/Spec.md)\n')
  expect(tasks('Work')).toEqual(['B/Plan.md: Read [spec](../A/Spec.md)'])

  await workspace.undoFileAction()
  await workspace.writesSettled()
  expect(one?.files.get(`${WORK}/A/Plan.md`)).toBe('- [ ] Read [spec](../A/Spec.md)\n')
  expect(tasks('Work')).toEqual(['A/Plan.md: Read [spec](../A/Spec.md)'])
})

test('and the same when an agent moves it in a space not in front', async () => {
  const agent = callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes: ['tree', 'notes.read'],
    spaces: ['Work', 'Home'],
    mode: 'unsupervised',
  })
  const answer = await runAgentVerb(
    'move_file',
    { space: 'Home', path: 'A/Plan.md', to: 'B/Plan.md' },
    agent,
  )
  expect(answer).toMatchObject({ ok: true })

  expect(disk.current?.files.get(`${HOME}/B/Plan.md`)).toBe('- [ ] Read [spec](../A/Spec.md)\n')
  expect(tasks('Home')).toEqual(['B/Plan.md: Read [spec](../A/Spec.md)'])
})
