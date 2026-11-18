import { expect, test, vi } from 'vitest'
import { commandRowsLoaded, registerCommandRows } from '@orden/contracts'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const { blockCommands, blockRows } = await import('../src/api')

test('Dictate typed after a slash starts in the note it was typed in, as it does from the palette', async () => {
  const seen: unknown[] = []
  registerCommandRows('record', () =>
    Promise.resolve((view?: object) => [
      { id: 'dictate', label: 'Dictate', byHand: true, run: () => void seen.push(view) },
    ]),
  )
  await commandRowsLoaded()
  const view = { state: { readOnly: false } } as never
  blockCommands(view)
    .find((one) => one.id === 'dictate')
    ?.run()
  blockRows()
    .find((one) => one.label === 'Dictate')
    ?.run(view)

  expect(seen).toEqual([view, view])
})
