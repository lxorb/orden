import { afterEach, describe, expect, test, vi } from 'vitest'

const { workspace } = await import('../../workspace.svelte')
const { unlocks } = await import('../../protect/src/api')
const { templates, templateWords } = await import('./templates')

const ROOT = '/space'
const SHUT = `${ROOT}/Templates/Diary.md`
const OPEN = `${ROOT}/Templates/Meeting.md`
const LOCK = { root: ROOT, key: 'Templates/Diary.md', way: 'password' as const }

afterEach(() => {
  vi.restoreAllMocks()
  unlocks.lockAll()
  workspace.protection.set(ROOT, SHUT, null)
})

describe('a protected template that is shut', () => {
  test('is neither offered nor lends its words to a new note', async () => {
    vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({ id: 's', name: 'S', root: ROOT })
    vi.spyOn(workspace, 'notes', 'get').mockReturnValue([
      { name: 'Diary.md', path: SHUT },
      { name: 'Meeting.md', path: OPEN },
    ] as never)
    vi.spyOn(workspace, 'noteText').mockResolvedValue('what nobody may read')
    workspace.protection.set(ROOT, SHUT, 'password')
    unlocks.lockAll()

    expect((await templates()).map((one) => one.path)).toEqual([OPEN])
    expect(await templateWords(SHUT, 'Today')).toBe('')

    unlocks.unlock([LOCK])
    expect((await templates()).map((one) => one.path)).toEqual([SHUT, OPEN])
    expect(await templateWords(SHUT, 'Today')).toContain('what nobody may read')
  })
})
