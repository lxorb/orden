import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  native: false,
  kept: new Map<string, string>(),
  files: new Map<string, Uint8Array>(),
}))
interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}
function treeOf(root: string): Listed {
  const node: Listed = { path: root, is_dir: true, children: [] }
  for (const path of [...world.files.keys()].filter((one) => one.startsWith(`${root}/`)).sort()) {
    let at = node
    const parts = path.slice(root.length + 1).split('/')
    parts.forEach((part, index) => {
      const here = `${at.path}/${part}`
      let next = at.children?.find((child) => child.path === here)
      if (!next) {
        next = index === parts.length - 1 ? { path: here, is_dir: false } : { path: here, is_dir: true, children: [] }
        at.children?.push(next)
      }
      at = next
    })
  }
  return node
}
vi.mock('../../platform/src/api', () => ({
  get isNative() {
    return world.native
  },
  storedText: (key: string) => world.kept.get(key) ?? null,
  keep: (key: string, value: string) => {
    world.kept.set(key, value)
    return true
  },
  invoke: (_command: string, { root }: { root: string }) => Promise.resolve(treeOf(root)),
  fileBytes: (path: string) => Promise.resolve(world.files.get(path) ?? new Uint8Array()),
}))
vi.mock('../../files-out/src/api', () => ({
  handOver: () => undefined,
  zipOf: () => Promise.resolve(new Uint8Array()),
}))
const { dismissWebEnding, spaceEntries, WEB_ENDING, webEndingDue } = await import('./web-ending')
const NOON = new Date(2027, 0, 10, 12)
beforeEach(() => {
  world.native = false
  world.kept.clear()
  world.files.clear()
})
describe('the notice that Orden on the web is ending', () => {
  test('shows in the public web app', () => {
    expect(webEndingDue(NOON, '', false)).toBe(true)
  })
  test('never shows in the app on a desktop or a phone', () => {
    world.native = true
    expect(webEndingDue(NOON, '', false)).toBe(false)
  })
  test('never shows in the demo', () => {
    expect(webEndingDue(NOON, '?demo', false)).toBe(false)
    expect(webEndingDue(NOON, '?demo=phone', false)).toBe(false)
  })
  test('stays out of a drive unless the drive asks for it', () => {
    expect(webEndingDue(NOON, '', true)).toBe(false)
    world.kept.set('orden:web-ending', 'show')
    expect(webEndingDue(NOON, '', true)).toBe(true)
    expect(webEndingDue(NOON, '?demo', true)).toBe(false)
  })
  test('dismissed, it stays away for the rest of that day and is back the next', () => {
    dismissWebEnding(NOON)
    expect(webEndingDue(NOON, '', false)).toBe(false)
    expect(webEndingDue(new Date(2027, 0, 10, 23, 59), '', false)).toBe(false)
    expect(webEndingDue(new Date(2027, 0, 11, 0, 1), '', false)).toBe(true)
  })
  test('says what the owner asked it to say, with no dash or dot standing between its parts', () => {
    expect(WEB_ENDING).toBe(
      'Orden on the web ends on <date>. Get Orden for your desktop, or Orden Notes, Todo, Chat and Track for your phone.',
    )
    expect(WEB_ENDING).not.toMatch(/[—·•]/)
  })
})
describe('what Export saves', () => {
  test('is every file of every space, under its space, with its own bytes', async () => {
    world.files.set('/Notes/Read me.md', new TextEncoder().encode('# Read me'))
    world.files.set('/Notes/assets/pic.png', new Uint8Array([1, 2, 3]))
    world.files.set('/Notes/deep/er/one.md', new TextEncoder().encode('one'))
    world.files.set('/Work/plan.canvas', new TextEncoder().encode('{}'))
    world.files.set('/Other/not asked.md', new TextEncoder().encode('no'))
    const entries = await spaceEntries(['/Notes', '/Work'])
    expect(entries.map((one) => one.path).sort()).toEqual([
      'Notes/Read me.md',
      'Notes/assets/pic.png',
      'Notes/deep/er/one.md',
      'Work/plan.canvas',
    ])
    expect(entries.find((one) => one.path === 'Notes/assets/pic.png')?.body).toEqual(new Uint8Array([1, 2, 3]))
  })
  test('is an empty archive where there is nothing, not an error', async () => {
    expect(await spaceEntries(['/Empty'])).toEqual([])
    expect(await spaceEntries([])).toEqual([])
  })
})
