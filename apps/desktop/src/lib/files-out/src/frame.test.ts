import { afterEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  asked: [] as { command: string; args: Record<string, unknown> | undefined }[],
  refuse: false,
}))

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  platform: () => 'macos',
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, args })
    return world.refuse ? Promise.reject(new Error('no')) : Promise.resolve(undefined)
  },
}))

const { printInFrame } = await import('./frame')

const PAGE = { width: 8.27, height: 11.69, margin: 0.5, landscape: false }

afterEach(() => {
  world.asked = []
  world.refuse = false
})

describe('printing on a Mac', () => {
  test('hands the page and its paper to the system print sheet', async () => {
    await printInFrame('<p>hello</p>', PAGE)

    expect(world.asked).toEqual([
      {
        command: 'print_page',
        args: { bytes: new TextEncoder().encode('<p>hello</p>'), page: PAGE },
      },
    ])
  })

  test('hands a page built in pieces over as bytes, never as one long string', async () => {
    const pieces = ['<p>', new Blob(['h\u00e9llo']), '</p>']
    await printInFrame(new Blob(pieces), PAGE)

    const sent = world.asked[0]?.args?.bytes
    expect(sent).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(sent as Uint8Array)).toBe('<p>h\u00e9llo</p>')
  })

  test('says no paper when the caller knows none', async () => {
    await printInFrame('<p>hello</p>')

    expect(world.asked[0]?.args?.page).toBeNull()
  })

  test('lets the caller go when the sheet cannot be shown', async () => {
    world.refuse = true

    await expect(printInFrame('<p>hello</p>', PAGE)).resolves.toBeUndefined()
  })
})
