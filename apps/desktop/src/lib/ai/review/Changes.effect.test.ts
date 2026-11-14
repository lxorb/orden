import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const { workspace } = await import('../../workspace.svelte')
const { unlocks } = await import('../../protect/src/unlocked.svelte')
const Changes = (await import('./Changes.svelte')).default

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }

const change = {
  id: 'one',
  agent: 'claude',
  path: NOTE,
  at: 1,
  spots: [{ from: 0, to: 10, inserted: 'what nobody may read', removed: '' }],
  turn: null,
  added: 1,
  removed: 0,
}

beforeEach(() => {
  workspace.spaces = [{ id: 'space', name: 'Space', root: ROOT }]
  workspace.protection.set(ROOT, NOTE, 'password')
  unlocks.lockAll()
})

afterEach(() => {
  unlocks.lockAll()
  workspace.protection.set(ROOT, NOTE, null)
})

describe('an agent change to a protected note', () => {
  test('shows none of its words while the note is shut', () => {
    const target = document.createElement('div')
    document.body.append(target)
    const shown = mount(Changes, {
      target,
      props: {
        notes: [{ path: NOTE, agent: 'claude', changes: [change], added: 1, removed: 0 }],
        files: [],
        thread: { space: 'space' } as never,
        open: true,
      },
      intro: false,
    })
    flushSync()
    expect(target.textContent).toContain('Diary')
    expect(target.textContent).not.toContain('nobody')

    unlocks.unlock([LOCK])
    flushSync()
    expect(target.textContent).toContain('what nobody may read')
    void unmount(shown)
    target.remove()
  })
})
