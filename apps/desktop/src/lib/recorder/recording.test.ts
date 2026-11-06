import { beforeEach, expect, test, vi } from 'vitest'

let opening: ((held: { stop: () => Promise<unknown>; extension: string }) => void) | null = null
const stopped: string[] = []

vi.mock('./microphone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./microphone')>()),
  record: () =>
    new Promise((resolve) => {
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
