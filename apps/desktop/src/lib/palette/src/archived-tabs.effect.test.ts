import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'

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
function offered(target: HTMLElement, words: string): string[] {
  const input = target.querySelector('input')
  if (!input) throw new Error('no palette field')
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  return [...target.querySelectorAll('[role="option"] .orden-row-label')].map((one) => one.textContent)
}
test('a tab of an archived space is not listed, and is again once the space is unarchived', async () => {
  await spaceSets()
  workspace.spaces = [{ ...WORK }, { ...OLD }]
  await workspace.showSpace(OLD.id)
  workspace.openBlank('Mountains', '# Mountains')
  await workspace.showSpace(WORK.id)
  workspace.openBlank('Mountain hut', '# Mountain hut')
  workspace.archivedSpaces.set(OLD.root, true)
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(Palette, { target, props: { open: true } })
  flushSync()
  try {
    const archived = offered(target, 'Mountain')
    expect(archived).toContain('Mountain hut')
    expect(archived).not.toContain('Mountains')
    workspace.archivedSpaces.set(OLD.root, false)
    flushSync()
    expect(offered(target, 'Mountain')).toEqual(expect.arrayContaining(['Mountain hut', 'Mountains']))
  } finally {
    void unmount(made, { outro: false })
    target.remove()
  }
})
