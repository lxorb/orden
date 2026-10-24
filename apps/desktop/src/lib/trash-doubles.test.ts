import { describe, expect, test, vi } from 'vitest'

vi.mock('./workspace.svelte', () => ({ workspace: { spaces: [] } }))
vi.mock('./sync.svelte', () => ({ sync: { remoteIdFor: () => null } }))
vi.mock('./tauri', () => ({ invoke: () => Promise.resolve([]) }))
vi.mock('./account.svelte', () => ({ account: { accountToken: null } }))
vi.mock('./api', () => ({ api: {} }))
vi.mock('./prompt.svelte', () => ({ prompt: {} }))

const { doublesOf } = await import('./trash-doubles')
type Item = Parameters<typeof doublesOf>[0][number]

/** The notes sync put in this device's trash for a note the account's Recently deleted
 *  holds too, listed twice until #765: found by place and by when, and nothing else. */
describe('a device’s trash entry the account holds too', () => {
  const item = (
    id: string,
    from: string,
    deletedAt: number,
    kind: Item['kind'] = 'note',
  ): Item => ({
    id,
    ref: id,
    kind,
    name: from.split('/').pop() ?? from,
    detail: '',
    deletedAt,
    purgeAt: deletedAt + 1,
    source: 'device',
    from,
  })
  const account = [{ spaceId: 'sp1', path: 'Journal/2026-10-20.md', deletedAt: 1000 }]
  const folderOf = (id: string) => (id === 'sp1' ? 'Notes' : null)

  test('is the same note at the same place, gone from here after the account had it', () => {
    expect(doublesOf([item('d1', 'Notes/Journal/2026-10-20.md', 5000)], account, folderOf)).toEqual(
      ['d1'],
    )
  })

  test('is not a note deleted here before the account’s went, which is the reader’s own', () => {
    expect(doublesOf([item('d1', 'Notes/Journal/2026-10-20.md', 500)], account, folderOf)).toEqual(
      [],
    )
  })

  test('is not anything at another place, a folder, or a space this device does not hold', () => {
    expect(
      doublesOf(
        [
          item('d1', 'Notes/Journal/2026-10-21.md', 5000),
          item('d2', 'Notes/Journal/2026-10-20.md', 5000, 'folder'),
        ],
        account,
        folderOf,
      ),
    ).toEqual([])
    expect(
      doublesOf([item('d1', 'Notes/Journal/2026-10-20.md', 5000)], account, () => null),
    ).toEqual([])
  })
})
