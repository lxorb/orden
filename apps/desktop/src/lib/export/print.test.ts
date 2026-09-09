import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The one place a PDF is written straight to a file, and what it does when the
 *  machine cannot. The printer itself is stood in for; what is under test is that
 *  a road that changed says so. */
const world = vi.hoisted(() => ({ asked: [] as unknown[], refuse: null as string | null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, output: args?.output })
    return world.refuse ? Promise.reject(new Error(world.refuse)) : Promise.resolve(undefined)
  },
}))

/** English for English: what the line says is checked as the key it is asked
 *  for, and the dictionaries are held to their own test. */
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

  /** Somebody who chose a filename and waited is about to be handed a print
   *  dialog they did not ask for. A road that changes without a word reads as a
   *  fault rather than as a fallback. */
  test('says the road changed when it cannot', async () => {
    world.refuse = 'the print was interrupted: 0x80070005'

    expect(await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)).toBe(false)
    expect(busy.trouble).toBe('The file could not be written, so it goes to the print dialog')
  })

  /** What was thrown is the print engine's own sentence, in English and with a
   *  code in it, and it tells the reader nothing they can act on. */
  test('says it in the app own words rather than the printer own', async () => {
    world.refuse = 'the print was interrupted: 0x80070005'
    await writtenPdf('<p>hello</p>', '/home/plan.pdf', PAGE)

    expect(busy.trouble).not.toContain('0x80070005')
  })
})
