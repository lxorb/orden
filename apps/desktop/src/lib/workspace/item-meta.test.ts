import type { ItemMeta, MetaPatch } from '@orden/sync-core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { keeping } from './file-ops'
import { type Describing, ItemMetaStore, STORAGE_KEY } from './item-meta.svelte'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const ROOT = '/space'
const OTHER = '/other'

const rootOf = (path: string | null) => (path?.startsWith(OTHER) ? OTHER : ROOT)

let meta: ItemMetaStore

beforeEach(() => {
  localStorage.clear()
  meta = new ItemMetaStore(rootOf)
})

class Account implements Describing {
  held: Record<string, ItemMeta> = {}
  sent: [string, MetaPatch][] = []
  absent = new Set<string>()
  keeps = true

  describedIn(): Record<string, ItemMeta> | null {
    return this.keeps ? { ...this.held } : null
  }

  describe(_root: string, patches: Readonly<Record<string, MetaPatch>>): Promise<string[] | null> {
    if (!this.keeps) return Promise.resolve(null)
    const left: string[] = []
    for (const [path, patch] of Object.entries(patches)) {
      if (this.absent.has(path)) {
        left.push(path)
        continue
      }
      this.sent.push([path, patch])
      const next = Object.fromEntries(
        Object.entries({ ...this.held[path], ...patch }).filter(
          (one): one is [string, string] => one[1] !== null,
        ),
      )
      this.held = Object.fromEntries(
        Object.entries({ ...this.held, [path]: next }).filter(([, one]) => Object.keys(one).length),
      )
    }
    return Promise.resolve(left)
  }
}

describe("a note's own metadata", () => {
  test('is kept by the path in its space, key by key, and cleared key by key', () => {
    meta.set('/space/Plan.md', { icon: 'rocket', 'icon-color': 'red' })
    meta.set('/space/Plan.md', { cover: 'sea.png' })
    expect(meta.of('/space/Plan.md')).toEqual({
      icon: 'rocket',
      'icon-color': 'red',
      cover: 'sea.png',
    })

    meta.set('/space/Plan.md', { icon: null, 'icon-color': null, cover: null })
    expect(meta.of('/space/Plan.md')).toBeNull()
  })

  test('is still there after a restart', () => {
    meta.set('/space/Plan.md', { icon: 'rocket' })
    expect(localStorage.getItem(STORAGE_KEY)).toContain('rocket')
    expect(new ItemMetaStore(rootOf).of('/space/Plan.md')).toEqual({ icon: 'rocket' })
  })

  test('follows a rename, a move into a folder, a folder renamed and a move to another space', () => {
    meta.set('/space/Plan.md', { icon: 'rocket' })
    meta.moved('/space/Plan.md', '/space/Big plan.md')
    expect(meta.of('/space/Big plan.md')).toEqual({ icon: 'rocket' })
    expect(meta.of('/space/Plan.md')).toBeNull()

    meta.moved('/space/Big plan.md', '/space/Work/Big plan.md')
    meta.moved('/space/Work', '/space/Jobs')
    expect(meta.of('/space/Jobs/Big plan.md')).toEqual({ icon: 'rocket' })

    meta.moved('/space/Jobs/Big plan.md', '/other/Big plan.md', ROOT, OTHER)
    expect(meta.of('/space/Jobs/Big plan.md')).toBeNull()
    expect(meta.of('/other/Big plan.md')).toEqual({ icon: 'rocket' })
  })

  test('tells who listens where a note it moved now is, so its rows are read with it (#1229)', () => {
    meta.set('/space/Work/A.md', { icon: 'a' })
    meta.set('/space/B.md', { icon: 'b' })
    const heard: string[] = []
    meta.hear((path) => heard.push(path))
    meta.moved('/space/Work', '/space/Jobs')
    meta.moved('/space/B.md', '/other/B.md', ROOT, OTHER)
    expect(heard).toEqual(['/space/Jobs/A.md', '/other/B.md'])
  })

  test('goes with the note, and with everything in a folder that goes', () => {
    meta.set('/space/Work/A.md', { icon: 'a' })
    meta.set('/space/B.md', { icon: 'b' })
    meta.gone('/space/Work')
    expect(meta.of('/space/Work/A.md')).toBeNull()
    expect(meta.of('/space/B.md')).toEqual({ icon: 'b' })
  })

  test('tells who listens which notes changed', () => {
    const heard: string[] = []
    meta.hear((path) => heard.push(path))
    meta.set('/space/Plan.md', { icon: 'rocket' })
    meta.set('/space/Plan.md', { icon: 'rocket' })
    expect(heard).toEqual(['/space/Plan.md'])
  })
})

describe('a note or folder deleted and put back', () => {
  test('comes back with what Orden kept about it, wherever it is put back', () => {
    meta.set('/space/Groceries.md', { 'todo-list': 'yes', icon: 'cart' })
    const follow = keeping(meta)
    void follow({
      op: 'removed',
      path: '/space/Groceries.md',
      kind: 'file',
      root: ROOT,
      back: 'b1',
    })
    expect(meta.of('/space/Groceries.md')).toBeNull()

    void follow({
      op: 'created',
      path: '/space/Groceries 2.md',
      kind: 'file',
      root: ROOT,
      back: 'b1',
      putBack: true,
    })
    expect(meta.of('/space/Groceries 2.md')).toEqual({ 'todo-list': 'yes', icon: 'cart' })
  })

  test('a folder brings back its own and everything in it, after a restart too', () => {
    meta.set('/space/Projects', { 'todo-lists': 'marked' })
    meta.set('/space/Projects/Trip.md', { 'todo-list': 'yes' })
    meta.set('/space/Plan.md', { icon: 'rocket' })
    meta.gone('/space/Projects', ROOT, 'b2')

    const again = new ItemMetaStore(rootOf)
    again.cameBack('/space/Projects', ROOT, 'b2')
    expect(again.of('/space/Projects')).toEqual({ 'todo-lists': 'marked' })
    expect(again.of('/space/Projects/Trip.md')).toEqual({ 'todo-list': 'yes' })
    expect(again.of('/space/Plan.md')).toEqual({ icon: 'rocket' })
  })

  test('is put back once, and never over what the item has since', () => {
    meta.set('/space/A.md', { icon: 'a' })
    meta.gone('/space/A.md', ROOT, 'b3')
    meta.set('/space/A.md', { icon: 'new' })
    meta.cameBack('/space/A.md', ROOT, 'b3')
    expect(meta.of('/space/A.md')).toEqual({ icon: 'new' })

    meta.gone('/space/A.md', ROOT)
    meta.cameBack('/space/A.md', ROOT, 'b3')
    expect(meta.of('/space/A.md')).toBeNull()
  })
})

describe('with an account that keeps metadata', () => {
  test('a space signed in for the first time sends what it held, and then shows what the account says', async () => {
    meta.set('/space/Plan.md', { icon: 'rocket' })
    const account = new Account()
    account.held['Other.md'] = { cover: 'sea.png' }
    meta.describeBy(account)

    await meta.fromEngine(ROOT)
    expect(account.sent).toEqual([['Plan.md', { icon: 'rocket' }]])
    expect(meta.itemsOf(ROOT)).toEqual({
      'Plan.md': { icon: 'rocket' },
      'Other.md': { cover: 'sea.png' },
    })

    account.held = { 'Plan.md': { icon: 'star' } }
    await meta.fromEngine(ROOT)
    expect(meta.itemsOf(ROOT)).toEqual({ 'Plan.md': { icon: 'star' } })
  })

  test('a change goes up at once, and one the account cannot place yet is kept until it can', async () => {
    const account = new Account()
    meta.describeBy(account)
    await meta.fromEngine(ROOT)

    account.absent.add('New.md')
    meta.set('/space/New.md', { icon: 'leaf' })
    await vi.waitFor(() => expect(account.sent.length).toBe(0))
    await meta.fromEngine(ROOT)
    expect(meta.of('/space/New.md')).toEqual({ icon: 'leaf' })

    account.absent.clear()
    await meta.fromEngine(ROOT)
    expect(account.sent).toEqual([['New.md', { icon: 'leaf' }]])
    expect(meta.of('/space/New.md')).toEqual({ icon: 'leaf' })
  })

  test('an account that keeps none leaves this device its own', async () => {
    const account = new Account()
    account.keeps = false
    meta.describeBy(account)
    meta.set('/space/Plan.md', { icon: 'rocket' })
    await meta.fromEngine(ROOT)
    expect(meta.describes(ROOT)).toBe(false)
    expect(meta.of('/space/Plan.md')).toEqual({ icon: 'rocket' })
  })
})
