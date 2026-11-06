import { afterEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  asked: [] as { command: string; args: Record<string, unknown> | undefined }[],
  refuse: false,
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  platform: () => 'macos',
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, args })
    return world.refuse ? Promise.reject(new Error('no')) : Promise.resolve(undefined)
  },
}))

const { printInFrame } = await import('../export')

const PAGE = { width: 8.27, height: 11.69, margin: 0.5, landscape: false }

afterEach(() => {
  world.asked = []
  world.refuse = false
})

describe('printing on a Mac', () => {
  test('hands the page and its paper to the system print sheet', async () => {
    await printInFrame('<p>hello</p>', PAGE)

    expect(world.asked).toEqual([
      { command: 'print_page', args: { html: '<p>hello</p>', page: PAGE } },
    ])
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
