import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

type Seen = { contentRect: { width: number; height: number } }[]
const watchers: ((seen: Seen) => void)[] = []
const none = () => undefined
window.matchMedia = () =>
  ({
    matches: false,
    addListener: none,
    removeListener: none,
    addEventListener: none,
    removeEventListener: none,
  }) as unknown as MediaQueryList
globalThis.ResizeObserver = class {
  observe = none
  unobserve = none
  disconnect = none
  constructor(heard: (seen: Seen) => void) {
    watchers.push(heard)
  }
} as unknown as typeof ResizeObserver
Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) } })
vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
}))
const { FitAddon } = await import('@xterm/addon-fit')
const fits = vi.spyOn(FitAddon.prototype, 'fit').mockImplementation(() => undefined)
const { workspace } = await import('../../workspace/src/api')
const { sessionOf } = await import('./sessions.svelte')
const { shells } = await import('./shells.svelte')
const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)))
test('a terminal brought back fits in a later frame, and only when its size changed (#2290)', async () => {
  const tab = workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k1' }), 'Build')
  const before = watchers.length
  const session = sessionOf(tab)
  const sized = watchers.slice(before).at(-1)
  if (!sized) throw new Error('the terminal watches no size')
  const place = document.createElement('div')
  document.body.append(place)
  await session.attach(place, false)
  sized([{ contentRect: { width: 800, height: 600 } }])
  await frame()
  const xterm = (session as unknown as { term: object }).term
  fits.mockClear()
  session.detach()
  await session.attach(place, true)
  expect(fits).not.toHaveBeenCalled()
  sized([{ contentRect: { width: 0, height: 0 } }])
  sized([{ contentRect: { width: 800, height: 600 } }])
  session.show(false, false)
  session.show(true, true)
  await frame()
  expect(fits).not.toHaveBeenCalled()
  expect((session as unknown as { term: object }).term).toBe(xterm)
  sized([{ contentRect: { width: 900, height: 600 } }])
  await frame()
  expect(fits).toHaveBeenCalledTimes(1)
})
test('a terminal turned into its file explorer keeps its session, and one asked for in a folder starts there (#2274)', () => {
  const words = JSON.stringify({ folder: '/notes/Lab', back: [], ahead: [] })
  const tab = workspace.openUnsaved(
    'terminal',
    JSON.stringify({ shell: 'bash', folder: '/notes/Lab', key: 'k2' }),
    'Lab',
  )
  const session = sessionOf(tab)
  workspace.turn(tab.id, { kind: 'explorer', words, title: 'Lab' })
  flushSync()
  expect(workspace.tucked.map((one) => one.id)).toEqual([tab.id])
  expect(sessionOf(tab)).toBe(session)
  const asked = workspace.openUnsaved('terminal', JSON.stringify({ folder: '/notes/Lab' }), 'Lab')
  const spec = (sessionOf(asked) as unknown as { spec(): { shell: string; folder: string | null } }).spec()
  expect(spec).toMatchObject({ shell: shells.chosen?.id ?? '', folder: '/notes/Lab' })
})
test('a screen shown again does not answer the questions in it to the shell, and keys typed after it reach the shell whole (#2274)', async () => {
  const tab = workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k3' }), 'Held')
  const session = sessionOf(tab)
  const place = document.createElement('div')
  document.body.append(place)
  await session.attach(place, false)
  const written: string[] = []
  const inside = session as unknown as {
    pty: string | null
    source: object
    screen(said: { screen: string; cols: number; rows: number; restored: null }): void
    term: { write(data: string, done: () => void): void; input(data: string): void }
  }
  inside.pty = 'p1'
  inside.source = {
    write: (data: string) => {
      written.push(data)
      return Promise.resolve()
    },
    resize: () => undefined,
  }
  inside.screen({ screen: 'PS C:\\> \x1b[6n\x1b[c', cols: 80, rows: 24, restored: null })
  await new Promise((done) => inside.term.write('', () => done(null)))
  inside.term.input('$env:TURNMARK\r')
  await vi.waitFor(() => expect(written.join('')).toContain('TURNMARK'))
  expect(written.join('')).toBe('$env:TURNMARK\r')
})
test('a terminal put behind that does not hold the keyboard is left alone, and one that does lets it go (#2290)', async () => {
  const tab = workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k4' }), 'Behind')
  const session = sessionOf(tab)
  const place = document.createElement('div')
  document.body.append(place)
  await session.attach(place, false)
  const term = (session as unknown as { term: { blur(): void } }).term
  const blurs = vi.spyOn(term, 'blur')
  const away = document.createElement('input')
  document.body.append(away)
  away.focus()
  session.show(false, false)
  expect(blurs).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(away)
  session.show(true, false)
  const inside = place.querySelector<HTMLElement>('textarea') ?? place.appendChild(document.createElement('textarea'))
  inside.focus()
  session.show(false, false)
  expect(
    (session as unknown as { pressed(event: KeyboardEvent): boolean }).pressed(
      new KeyboardEvent('keydown', { key: 'a' }),
    ),
  ).toBe(false)
  await new Promise((done) => requestAnimationFrame(done))
  expect(place.contains(document.activeElement)).toBe(false)
  away.remove()
})
