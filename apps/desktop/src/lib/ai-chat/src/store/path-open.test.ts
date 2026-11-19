import { beforeEach, describe, expect, test, vi } from 'vitest'

const ROOT = '/Users/me/Notes'
const opened: [string, unknown][] = []
const revealed: [string, unknown][] = []
const shown: { label: string; run: () => void }[][] = []
vi.mock('@tauri-apps/api/path', () => ({ homeDir: () => Promise.resolve('/Users/me') }))
vi.mock('../../../platform/src/api', async (actual) => ({
  ...(await actual<typeof import('../../../platform/src/api')>()),
  isDesktop: true,
  platform: () => 'macos',
}))
vi.mock('../../../files-out/src/api', () => ({
  reveal: (path: string, how: unknown) => Promise.resolve(void revealed.push([path, how])),
  showLabel: () => 'Show in Finder',
}))
vi.mock('../../../link-index/src/api', () => ({
  links: { holdsFile: (path: string) => path === `${ROOT}/Projects/roadmap.md` },
}))
vi.mock('../../../ui-kit/src/api', async (actual) => ({
  ...(await actual<typeof import('../../../ui-kit/src/api')>()),
  viewport: { drawer: false },
  menu: { show: (_: unknown, rows: { label: string; run: () => void }[]) => void shown.push(rows) },
}))
vi.mock('../../../workspace/src/api', async () => ({
  ...(await import('../../../workspace/src/new-tab')),
  opensLink: (press: MouseEvent) => press.button === 0 || press.button === 1,
  workspace: {
    spaces: [{ root: ROOT }],
    openEntry: (path: string, how: unknown) => Promise.resolve(void opened.push([path, how])),
    closePanel: () => undefined,
  },
}))
const { chatPaths, followPath, pathMenu } = await import('./path-open')

function press(path: string | null, more: Partial<MouseEvent> = {}): MouseEvent & { prevented: boolean } {
  const event = {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    prevented: false,
    target: { closest: () => (path === null ? null : { dataset: { path } }) },
    preventDefault() {
      event.prevented = true
    },
    ...more,
  }
  return event as unknown as MouseEvent & { prevented: boolean }
}
const settled = () => new Promise((done) => setTimeout(done, 0))
beforeEach(() => {
  opened.length = 0
  revealed.length = 0
  shown.length = 0
})
describe('a path pressed in a chat', () => {
  test('that Orden opens from the space opens as a tab, relative to the chat’s space', async () => {
    expect(followPath(press('Projects/roadmap.md'), ROOT)).toBe(true)
    await settled()
    expect(opened).toEqual([[`${ROOT}/Projects/roadmap.md`, {}]])
    expect(revealed).toEqual([])
  })
  test('with the link modifier or the middle button opens behind', async () => {
    followPath(press(`${ROOT}/plan.md`, { button: 1 }), ROOT)
    await settled()
    expect(opened).toEqual([[`${ROOT}/plan.md`, { activate: false, beside: true }]])
  })
  test('outside a space, or of a kind Orden leaves to other apps, shows in the system’s file manager', async () => {
    followPath(press('~/Documents/report.pdf'), ROOT)
    followPath(press(`${ROOT}/cover.png`), ROOT)
    followPath(press('/tmp/out.zip:4'), ROOT)
    await settled()
    expect(opened).toEqual([])
    expect([...revealed].sort((one, other) => one[0].localeCompare(other[0]))).toEqual([
      ['/tmp/out.zip', { system: true }],
      ['/Users/me/Documents/report.pdf', { system: true }],
      [`${ROOT}/cover.png`, { system: true }],
    ])
  })
  test('leaves a press that is not on a path, or by the right button, to the rest of the answer', () => {
    const elsewhere = press(null)
    expect(followPath(elsewhere, ROOT)).toBe(false)
    const right = press('/tmp/a.txt', { button: 2 })
    expect(followPath(right, ROOT)).toBe(false)
    expect(elsewhere.prevented || right.prevented).toBe(false)
  })
})
describe('the menu of a path', () => {
  test('offers a new tab for what Orden opens and the file manager for every path', async () => {
    expect(pathMenu(press(`${ROOT}/plan.md`), ROOT)).toBe(true)
    expect(pathMenu(press('/tmp/a.zip'), ROOT)).toBe(true)
    expect(shown.map((rows) => rows.map((one) => one.label))).toEqual([
      ['Open in a new tab', 'Show in Finder'],
      ['Show in Finder'],
    ])
    shown[0]?.[0]?.run()
    shown[1]?.[0]?.run()
    await settled()
    expect(opened).toEqual([[`${ROOT}/plan.md`, { beside: true }]])
    expect(revealed).toEqual([['/tmp/a.zip', { system: true }]])
  })
  test('is not ours off a path', () => {
    expect(pathMenu(press(null), ROOT)).toBe(false)
    expect(shown).toEqual([])
  })
})
describe('an answer drawn for the chat', () => {
  test('marks the paths this space and this computer can reach', () => {
    const html = chatPaths('<p><code>Projects/roadmap.md</code> <code>Projects/gone.md</code> ~/a.txt</p>', ROOT)
    expect([...html.matchAll(/data-path="([^"]*)"/g)].map((one) => one[1])).toEqual(['Projects/roadmap.md', '~/a.txt'])
  })
})
