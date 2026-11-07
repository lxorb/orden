import { afterEach, describe, expect, test, vi } from 'vitest'
import { READER } from '../../automation/caller'
import { copySecret } from '../../pass/clipboard'
import { clipboard } from './clipboard'

vi.mock('./asks', () => ({ asked: () => Promise.resolve(null) }))

function holding(held: string) {
  vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve(held) } })
}

const read = { verb: 'clipboard', args: { op: 'read' }, caller: READER }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('an agent reading the clipboard', () => {
  test('reads what the reader copied', async () => {
    holding('a link')
    expect(await clipboard(read)).toMatchObject({ ok: true, result: { text: 'a link' } })
  })

  test('is refused while the clipboard holds a secret Pass copied', async () => {
    const board = { read: () => Promise.resolve(''), write: () => Promise.resolve() }
    await copySecret('hunter2', 0, board)
    holding('hunter2')
    await expect(clipboard(read)).rejects.toMatchObject({ code: 'protected' })
    holding('something else')
    expect(await clipboard(read)).toMatchObject({ ok: true, result: { text: 'something else' } })
  })
})
