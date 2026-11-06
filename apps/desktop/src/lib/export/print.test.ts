import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ asked: [] as unknown[], refuse: null as string | null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, output: args?.output })
    return world.refuse ? Promise.reject(new Error(world.refuse)) : Promise.resolve(undefined)
  },
}))

vi.mock('../i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
  message: (_error: unknown, fallback: string) => fallback,
}))

const { busy } = await import('../busy.svelte')
const { writtenPdf } = await import('./print')

const PAGE = { width: 8.27, height: 11.69, margin: 0.5, landscape: false }

beforeEach(() => {
  world.asked = []
  world.refuse = null
  busy.clear()
})

afterEach(() => {
  busy.clear()
})

describe('writing a PDF straight to a file', () => {
  test('asks the machine to print to the file that was chosen', async () => {
    expect(await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)).toBe(true)
    expect(world.asked).toEqual([{ command: 'print_pdf', output: '/home/plan.pdf' }])
  })

  test('says nothing on the line when it works', async () => {
    await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)
    expect(busy.trouble).toBeNull()
  })

  test('says the road changed when it cannot', async () => {
    world.refuse = 'the print was interrupted: 0x80070005'

    expect(await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)).toBe(false)
    expect(busy.trouble).toBe('The file could not be written, so it goes to the print dialog')
  })

  test('says it in the app own words rather than the printer own', async () => {
    world.refuse = 'the print was interrupted: 0x80070005'
    await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)

    expect(busy.trouble).not.toContain('0x80070005')
  })
})
