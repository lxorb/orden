import { beforeEach, expect, test, vi } from 'vitest'

const sent = vi.hoisted(() => [] as { command: string; args: unknown }[])

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  invoke: (command: string, args: unknown) => {
    sent.push({ command, args })
    return Promise.resolve()
  },
}))

const { rememberGround } = await import('./ground')

function grounds(body: string) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element) =>
      ({
        backgroundColor: element === document.body ? body : 'rgb(35, 41, 50)',
      }) as CSSStyleDeclaration,
  )
}

async function remembered() {
  rememberGround()
  await new Promise((done) => requestAnimationFrame(() => done(undefined)))
  return sent.at(-1)
}

beforeEach(() => {
  sent.length = 0
  vi.restoreAllMocks()
})

test('the window is told the ground it is painted, which a page drawn over it shows', async () => {
  grounds('rgb(14, 16, 19)')
  expect(await remembered()).toEqual({
    command: 'remember_ground',
    args: { colour: 'rgb(14, 16, 19)', paint: 'rgb(14, 16, 19)' },
  })
})

test('a ground seen through is painted with the colour beneath it, never with nothing', async () => {
  grounds('rgba(0, 0, 0, 0)')
  expect(await remembered()).toEqual({
    command: 'remember_ground',
    args: { colour: 'rgba(0, 0, 0, 0)', paint: 'rgb(35, 41, 50)' },
  })
})
