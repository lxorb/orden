import { providePort, registerCommand } from '@orden/contracts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const online = { made: null as string[] | null }
const noting = (what: string) => () => {
  online.made?.push(what)
  return Promise.resolve()
}
providePort('terminal.making', {
  open: noting('terminal'),
  shells: () => Promise.resolve([]),
  warm: () => Promise.resolve(),
  pickHost: noting('remote'),
  online: noting('online'),
})
registerCommand('ai.tab', () => Promise.resolve(() => void noting('ai')()))
await import('../../web-tab/src/api')
const { fitsWhole, groupOf, kindLines, newKinds } = await import('./new-kinds')
const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { EXPERIMENTAL_WORD, hiddenKinds, PASS_WORD } = await import('../../gates/src/api')
let was: 'phone' | 'tablet' | 'desktop'
beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  localStorage.clear()
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, PASS_WORD]
})
afterEach(() => {
  viewport.device = was
  vi.restoreAllMocks()
})
function makers(): string[] {
  const made: string[] = []
  vi.spyOn(workspace, 'openBlank').mockImplementation(() => void made.push('note'))
  vi.spyOn(workspace, 'newCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'openPage').mockImplementation((url: string) => {
    made.push(`web ${url}`)
    return null
  })
  vi.spyOn(workspace, 'newPages').mockImplementation(async () => void made.push('pages'))
  online.made = made
  return made
}
describe('the kinds a new tab can be', () => {
  test('are the four, an AI chat, an online terminal and Pass, in the order a reader is offered them', () => {
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages', 'ai', 'online', 'pass', 'web'])
  })
  test('stand in groups: notes, chats, terminals, the browser, then the apps', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['ai'],
      ['online'],
      ['web'],
      ['pass'],
    ])
  })
  test('fold into one card a group of several, which offers them all, and leave one alone', async () => {
    const [notes, , terminals] = kindLines(newKinds())
    expect(groupOf(terminals ?? [])?.kind).toBe('online')
    expect(groupOf(terminals ?? [])?.grouped).toBeUndefined()
    const group = groupOf(notes ?? [])
    expect(group?.label()).toBe('Notes')
    expect(group?.grouped).toBe(true)
    expect(group?.letter).toBe('')
    const rows = await group?.others?.()
    expect(rows?.map((row) => row && [row.label, row.hint])).toEqual([
      ['New note', 'N'],
      ['New canvas', 'C'],
      ['New page note', 'P'],
    ])
  })
  test('are shown whole while every line fits, and as groups once they do not', () => {
    const lines = kindLines(newKinds())
    const card = { width: 144, height: 120, gap: 12 }
    expect(fitsWhole(lines, { width: 1000, height: 700 }, card, false)).toBe(true)
    expect(fitsWhole(lines, { width: 1000, height: 400 }, card, false)).toBe(false)
    expect(fitsWhole(lines, { width: 300, height: 600 }, card, false)).toBe(false)
    expect(fitsWhole(lines, { width: 300, height: 700 }, { ...card, height: 48 }, true)).toBe(true)
    expect(fitsWhole(lines, { width: 0, height: 0 }, card, false)).toBe(true)
  })
  test('read as the words every menu in the app already uses', () => {
    expect(newKinds().map((one) => one.label())).toEqual([
      'New note',
      'New canvas',
      'New page note',
      'New AI chat',
      'Online terminal',
      'Pass',
      'New web note',
    ])
  })
  test('each wears the mark its own files wear', () => {
    expect(newKinds().map((one) => one.mark)).toEqual(['note', 'canvas', 'pages', 'chat', 'terminal', 'key', 'web'])
  })
  test('leave the website out on a phone', () => {
    viewport.device = 'phone'
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages', 'online', 'pass'])
  })
  test('and on a tablet', () => {
    viewport.device = 'tablet'
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages', 'online', 'pass'])
  })
  test('make one each', async () => {
    const made = makers()
    for (const one of newKinds()) one.make()
    await vi.waitFor(() =>
      expect([...made].sort()).toEqual(['ai', 'canvas', 'note', 'online', 'pages', 'web https://www.google.com/']),
    )
  })
  test('a web note opens the search engine this device chose', async () => {
    const made = makers()
    const { searchEngine } = await import('../../web-tab/src/search-engine.svelte')
    searchEngine.choose('duckduckgo')
    newKinds()
      .find((one) => one.kind === 'web')
      ?.make()
    await vi.waitFor(() => expect(made).toEqual(['web https://duckduckgo.com/']))
    searchEngine.choose('google')
  })
  test('in the pane that asked', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)
    newKinds()[0]?.make('a-pane')
    expect(focused).toHaveBeenCalledWith('a-pane')
  })
  test('and in whichever pane has the keyboard when nobody names one', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)
    newKinds()[0]?.make()
    expect(focused).not.toHaveBeenCalled()
  })
  test('each answers a letter of its own', () => {
    const letters = newKinds().map((one) => one.letter)
    expect(letters).toEqual(['n', 'c', 'p', 'q', 'o', 'k', 'w'])
    expect(new Set(letters).size).toBe(letters.length)
  })
})
