import { expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => ({
  answers: [] as { command: string; answer: (value: unknown) => void }[],
}))

vi.mock('../../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/src/api')>()),
  isDesktop: true,
  invoke: (command: string) => new Promise((answer) => asked.answers.push({ command, answer })),
}))

const { remote } = await import('./hosts.svelte')

function answered(command: string, value: unknown) {
  const at = asked.answers.findIndex((one) => one.command === command)
  const [one] = asked.answers.splice(at, 1)
  one?.answer(value)
}

const settled = () => new Promise((done) => setTimeout(done, 0))

test('a list asked for before a change is kept does not take the change back', async () => {
  const listing = remote.refresh()
  const keeping = remote.keep((kept) => ({ ...kept, order: ['pi', 'nas'] }))

  answered('remote_keep', { own: [], about: {}, order: ['pi', 'nas'], groups: [] })
  await keeping
  answered('remote_hosts', { config: [], kept: { order: ['nas', 'pi'] }, file: null })
  await listing
  await settled()

  expect(remote.kept.order).toEqual(['pi', 'nas'])
})
