import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { workspace } = await import('../../workspace.svelte')
const { links } = await import('../../link-index.svelte')
const { unlocks } = await import('../../protect/unlocked.svelte')
const NoteCard = (await import('./NoteCard.svelte')).default

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`
const LOCK = { root: ROOT, key: 'Diary.md', way: 'password' as const }

beforeEach(() => {
  workspace.spaces = [{ id: 'space', name: 'Space', root: ROOT }]
  workspace.protection.set(ROOT, NOTE, 'password')
  unlocks.lockAll()
  vi.spyOn(links, 'targetOf').mockReturnValue('Diary.md')
  vi.spyOn(workspace, 'rootHolding').mockReturnValue(ROOT)
  vi.spyOn(workspace, 'noteText').mockResolvedValue('# Diary\n\nwhat nobody may read')
})

afterEach(() => {
  vi.restoreAllMocks()
  unlocks.lockAll()
  workspace.protection.set(ROOT, NOTE, null)
})

async function settled() {
  for (let round = 0; round < 5; round++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
}

describe('a chat card for a protected note', () => {
  test('shows none of its words while the note is shut, and them once it opens and none when it shuts again', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const shown = mount(NoteCard, { target, props: { target: 'Diary', from: `${ROOT}/Chat.md` } })
    await settled()
    expect(target.textContent).toContain('Diary')
    expect(target.textContent).not.toContain('nobody')

    unlocks.unlock([LOCK])
    await settled()
    expect(target.textContent).toContain('what nobody may read')

    unlocks.close([LOCK])
    await settled()
    expect(target.textContent).not.toContain('nobody')
    void unmount(shown)
    target.remove()
  })
})
