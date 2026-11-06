import { beforeEach, describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  texts: new Map<string, string>(),
  signedIn: false,
  root: '/space',
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    scanned: () => Promise.resolve(),
    rootOf: () => held.root,
    held: () =>
      [...held.texts.keys()].map((path) => {
        const text = held.texts.get(path) ?? ''
        return {
          path: path.slice(held.root.length + 1),
          icon: /^icon:/m.test(text) ? 'x' : null,
          iconColor: null,
          cover: /^cover:/m.test(text) ? 'x' : null,
        }
      }),
  },
}))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
})

const { ItemMetaStore } = await import('./item-meta.svelte')
const { moveOwnKeysSoon } = await import('./own-keys-moved')

const workspace = {
  itemMeta: new ItemMetaStore(() => held.root),
  noteText: (path: string) => Promise.resolve(held.texts.get(path) ?? null),
  replaceInNotes: (changes: readonly { path: string; after: string }[]) => {
    for (const change of changes) held.texts.set(change.path, change.after)
    return Promise.resolve(changes.length)
  },
}

const PLAN = '/space/Plan.md'

async function moved(root = held.root) {
  moveOwnKeysSoon(root, workspace, held.signedIn)
  await new Promise((done) => setTimeout(done, 20))
}

beforeEach(() => {
  held.texts.clear()
  held.signedIn = false
  held.root = '/space'
})

describe("a space's notes from before Orden kept its own metadata", () => {
  test('have their icon, colour and cover moved out of the text, once', async () => {
    held.texts.set(
      PLAN,
      '---\ntitle: Plan\nicon: rocket\nicon-color: red\ncover: sea.png\n---\n\n# Plan\n',
    )
    held.texts.set('/space/Bare.md', '# Bare\n')
    await moved()

    expect(workspace.itemMeta.of(PLAN)).toEqual({
      icon: 'rocket',
      'icon-color': 'red',
      cover: 'sea.png',
    })
    expect(held.texts.get(PLAN)).toBe('---\ntitle: Plan\n---\n\n# Plan\n')
    expect(held.texts.get('/space/Bare.md')).toBe('# Bare\n')
    expect(workspace.itemMeta.movedFromText('/space')).toBe(true)

    held.texts.set('/space/Imported.md', '---\nicon: leaf\n---\n\n# From Obsidian\n')
    await moved()
    expect(held.texts.get('/space/Imported.md')).toBe('---\nicon: leaf\n---\n\n# From Obsidian\n')
  })

  test('keep what the metadata already says over what the text still said', async () => {
    held.root = '/kept'
    workspace.itemMeta.set('/kept/Plan.md', { icon: 'star' }, '/kept')
    held.texts.set('/kept/Plan.md', '---\nicon: rocket\ncover: sea.png\n---\n\n# Plan\n')
    await moved('/kept')
    expect(workspace.itemMeta.of('/kept/Plan.md', '/kept')).toEqual({
      icon: 'star',
      cover: 'sea.png',
    })
    expect(held.texts.get('/kept/Plan.md')).toBe('# Plan\n')
  })

  test('stay in the text where the account cannot keep the metadata for the other devices', async () => {
    held.root = '/synced'
    held.signedIn = true
    held.texts.set('/synced/Plan.md', '---\nicon: rocket\n---\n\n# Plan\n')
    await moved('/synced')
    expect(held.texts.get('/synced/Plan.md')).toBe('---\nicon: rocket\n---\n\n# Plan\n')
    expect(workspace.itemMeta.of('/synced/Plan.md', '/synced')).toBeNull()
    expect(workspace.itemMeta.movedFromText('/synced')).toBe(false)
  })
})
