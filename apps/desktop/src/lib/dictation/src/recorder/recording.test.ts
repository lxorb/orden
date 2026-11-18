import { beforeEach, expect, test, vi } from 'vitest'

let opening: ((held: { stop: () => Promise<unknown>; extension: string }) => void) | null = null
let full: (() => void) | undefined
const stopped: string[] = []

vi.mock('./microphone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./microphone')>()),
  record: (listening: { full?: () => void } = {}) =>
    new Promise((resolve) => {
      full = listening.full
      opening = resolve
    }),
}))

vi.mock('./note', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./note')>()),
  noteToRecordInto: () => Promise.resolve('/space/Recordings.md'),
}))

const { recorder } = await import('./recording.svelte')

beforeEach(() => {
  opening = null
  stopped.length = 0
})

test('a stop pressed while the microphone opens stops it as soon as it is open', async () => {
  void recorder.start()
  await vi.waitFor(() => expect(opening).not.toBeNull())

  void recorder.stop()

  opening?.({
    stop: () => {
      stopped.push('stopped')
      return Promise.resolve({ bytes: new ArrayBuffer(0), seconds: 0 })
    },
    extension: 'weba',
  })

  await vi.waitFor(() => expect(stopped).toEqual(['stopped']))
  expect(recorder.on).toBe(false)
})

test('a recording that grows full stops and is kept, not left listening', async () => {
  void recorder.start()
  await vi.waitFor(() => expect(opening).not.toBeNull())

  opening?.({
    stop: () => {
      stopped.push('stopped')
      return Promise.resolve({ bytes: new ArrayBuffer(0), seconds: 0 })
    },
    extension: 'weba',
  })
  await vi.waitFor(() => expect(recorder.on).toBe(true))

  full?.()

  await vi.waitFor(() => expect(stopped).toEqual(['stopped']))
  expect(recorder.on).toBe(false)
})

test('the time shown counts from the moment the microphone opens, not the wait for it', async () => {
  let now = 1_000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  void recorder.start()
  await vi.waitFor(() => expect(opening).not.toBeNull())

  now = 6_000
  opening?.({
    stop: () => Promise.resolve({ bytes: new ArrayBuffer(0), seconds: 0 }),
    extension: 'weba',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  now = 7_000
  await vi.waitFor(() => expect(recorder.elapsed).toBeGreaterThan(0))

  expect(recorder.elapsed).toBe(1)
  await recorder.stop()
  clock.mockRestore()
})
