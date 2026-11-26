import { describe, expect, test, vi } from 'vitest'

const order = vi.hoisted(() => [] as string[])
vi.mock('../../platform/src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../platform/src/api')>()
  return { ...original, isDesktop: true, internal: { ...original.internal, routed: () => true } }
})
vi.mock('../../web-backend/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web-backend/src/api')>()),
  exportSpace: () => Promise.resolve(void order.push('read the space')),
}))
const { workspace } = await import('../../workspace/src/api')
const { busy } = await import('../../ui-kit/src/api')
const { appCommands } = await import('./api')
describe('exporting a space right after typing', () => {
  test('reads the space only once the open notes are saved', async () => {
    vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({ id: 'mine', name: 'Mine', root: '/Mine' })
    vi.spyOn(workspace, 'savingSettled').mockImplementation(() => Promise.resolve(void order.push('saved')))
    const row = appCommands().find((one) => one.id === 'export-space')
    row?.run()
    await vi.waitFor(() => expect(order).toEqual(['saved', 'read the space']))
    busy.clear()
  })
})
