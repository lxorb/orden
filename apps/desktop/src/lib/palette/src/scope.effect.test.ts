import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { SCOPE_KEY } from './scope'

vi.mock('../../commands/src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../commands/src/api')>()
  const run = () => undefined
  return {
    ...real,
    paletteCommands: (...given: Parameters<typeof real.paletteCommands>) => [
      ...real.paletteCommands(...given),
      { id: 'theme-contrast', label: 'Theme: Contrast', run },
      { id: 'theme-contrast-again', label: 'Theme: Contrast', run, checked: true },
    ],
  }
})
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.scrollIntoView = () => undefined
const { spaceSets, workspace } = await import('../../workspace/src/api')
const { default: Palette } = await (await import('./api')).loadPalette()
await (await import('@orden/contracts')).registered()
const OLD = { id: 'old', name: 'Old', root: '/notes/Old' }
const WORK = { id: 'work', name: 'Work', root: '/notes/Work' }
let target: HTMLElement
let made: ReturnType<typeof mount> | null = null
function hidden() {
  if (made) void unmount(made, { outro: false })
  made = null
}
function shown() {
  made = mount(Palette, { target, props: { open: true } })
  flushSync()
}
function typed(words: string) {
  const input = target.querySelector('input')
  if (!input) throw new Error('no palette field')
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
const chip = () => target.querySelector<HTMLButtonElement>('.orden-chip')
const rows = () =>
  [...target.querySelectorAll('[role="option"]')].map((one) => ({
    label: one.querySelector('.orden-row-label')?.textContent ?? '',
    from: one.querySelector('.from')?.textContent ?? null,
    ticked: one.querySelector('.tick') !== null,
  }))
beforeAll(async () => {
  await spaceSets()
  workspace.spaces = [{ ...WORK }, { ...OLD }]
  await workspace.showSpace(OLD.id)
  workspace.openBlank('Mountains', '# Mountains')
  await workspace.showSpace(WORK.id)
  workspace.openBlank('Mountain hut', '# Mountain hut')
})
beforeEach(() => {
  localStorage.clear()
  workspace.archivedSpaces.set(OLD.root, false)
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  hidden()
  target.remove()
})
describe('the chip', () => {
  test('reads All spaces first, flips to Only this space and back, gives the field its focus back, and is kept', () => {
    shown()
    expect(chip()?.textContent).toBe('All spaces')
    chip()?.click()
    flushSync()
    expect(chip()?.textContent).toBe('Only this space')
    expect(document.activeElement).toBe(target.querySelector('input'))
    expect(localStorage.getItem(SCOPE_KEY)).toBe('here')
    hidden()
    shown()
    expect(chip()?.textContent).toBe('Only this space')
    chip()?.click()
    flushSync()
    expect(chip()?.textContent).toBe('All spaces')
    expect(localStorage.getItem(SCOPE_KEY)).toBe('all')
  })
  test('is not there with one space, and no row names its space', () => {
    localStorage.setItem(SCOPE_KEY, 'here')
    workspace.archivedSpaces.set(OLD.root, true)
    shown()
    typed('Mountain')
    expect(chip()).toBeNull()
    expect(rows().map((one) => one.label)).toContain('Mountain hut')
    expect(rows().filter((one) => one.from !== null)).toEqual([])
  })
})
describe('what is searched', () => {
  test('all spaces: every tab is listed with the space it is from', () => {
    shown()
    typed('Mountain')
    const found = rows()
    expect(found.find((one) => one.label === 'Mountains')?.from).toMatch(/Old$/)
    expect(found.find((one) => one.label === 'Mountain hut')?.from).toMatch(/Work$/)
  })
  test('only this space: a tab of another space is not listed, and no row names its space', () => {
    localStorage.setItem(SCOPE_KEY, 'here')
    shown()
    typed('Mountain')
    const found = rows()
    expect(found.map((one) => one.label)).toContain('Mountain hut')
    expect(found.map((one) => one.label)).not.toContain('Mountains')
    expect(found.filter((one) => one.from !== null)).toEqual([])
  })
})
describe('a row', () => {
  test('is listed once though two commands read the same, and the checked one stays', () => {
    shown()
    for (const words of ['Contrast', '>Contrast']) {
      typed(words)
      const same = rows().filter((one) => one.label === 'Theme: Contrast')
      expect(same).toEqual([{ label: 'Theme: Contrast', from: null, ticked: true }])
    }
  })
})
