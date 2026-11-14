import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ asked: [] as unknown[], refuse: null as string | null }))

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, output: args?.output, bytes: args?.bytes })
    return world.refuse ? Promise.reject(new Error(world.refuse)) : Promise.resolve(undefined)
  },
}))

vi.mock('../../ui-kit/src/message', () => ({
  message: (_error: unknown, fallback: string) => fallback,
}))

const { busy } = await import('../../ui-kit/src/api')
const { writtenPdf } = await import('./sheet')

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
    expect(world.asked).toEqual([
      {
        command: 'print_pdf',
        output: '/home/plan.pdf',
        bytes: new TextEncoder().encode('<p>hello</p>'),
      },
    ])
  })

  test('hands a page built in pieces over as bytes, never as one long string', async () => {
    const page = new Blob(['<p>', new Blob(['h\u00e9llo']), '</p>'])
    expect(await writtenPdf(page, '/home/plan.pdf', PAGE)).toBe(true)

    const sent = (world.asked[0] as { bytes?: unknown }).bytes
    expect(sent).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(sent as Uint8Array)).toBe('<p>h\u00e9llo</p>')
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
