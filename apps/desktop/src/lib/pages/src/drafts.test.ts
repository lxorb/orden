import { expect, test, vi } from 'vitest'

const sizing = vi.hoisted(() => ({ asked: 0, answer: (): void => undefined }))
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
})
vi.mock('../../pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pdf/src/api')>()),
  pageSizes: () => {
    sizing.asked += 1
    return new Promise<{ width: number; height: number }[]>((resolve) => {
      const before = sizing.answer
      sizing.answer = () => {
        before()
        resolve([{ width: 794, height: 1123 }])
      }
    })
  },
}))
const { NoteDoc, Tab } = await import('../../documents/src/api')
const { draftPdf } = await import('./drafts')
test('one PDF handed in twice at once opens one draft, and both are handed it', async () => {
  const tabs: InstanceType<typeof Tab>[] = []
  const ws = {
    tabs,
    spaces: [],
    openUnsaved(kind: 'pages', text: string, name: string) {
      const note = new NoteDoc({ kind, path: null, name, text, dirty: true }, () => undefined)
      const tab = new Tab(note, 'pane')
      tabs.push(tab)
      return tab
    },
  }
  const first = draftPdf(ws, '/home/me/Lecture.pdf')
  const second = draftPdf(ws, '/home/me/Lecture.pdf')
  await vi.waitFor(() => expect(sizing.asked).toBe(2))
  sizing.answer()
  await Promise.all([first, second])
  expect(tabs).toHaveLength(1)
  expect(await draftPdf(ws, '/home/me/Lecture.pdf')).toBe(tabs[0])
})
