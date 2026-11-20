import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import hintSource from './Hint.svelte?raw'
import outwardSource from './Outward.svelte?raw'

const Hint = (await import('./Hint.svelte')).default
const Outward = (await import('./Outward.svelte')).default
const shown: ReturnType<typeof mount>[] = []
function holder(): HTMLElement {
  const one = document.createElement('label')
  one.textContent = 'Words'
  document.body.append(one)
  return one
}
afterEach(() => {
  for (const one of shown.splice(0)) void unmount(one)
  document.body.replaceChildren()
})
function placed(kind: 'hint' | 'outward', target: HTMLElement) {
  return kind === 'hint' ? mount(Hint, { target, props: { text: 'Why' } }) : mount(Outward, { target })
}
test.each(['hint', 'outward'] as const)('the holder of a %s mark is marked while it is there and not after', (kind) => {
  const label = holder()
  const one = placed(kind, label)
  flushSync()
  expect([...label.classList]).toEqual(['orden-marked', `orden-marked-${kind}`])
  void unmount(one)
  flushSync()
  expect([...label.classList]).toEqual([])
})
test('a holder with two marks stays marked until the last goes', () => {
  const label = holder()
  const hint = mount(Hint, { target: label, props: { text: 'Why' } })
  shown.push(mount(Outward, { target: label }))
  flushSync()
  void unmount(hint)
  flushSync()
  expect([...label.classList]).toEqual(['orden-marked', 'orden-marked-outward'])
})
test('no mark finds its holder with :has()', () => {
  expect(hintSource).not.toMatch(/:has\(/)
  expect(outwardSource).not.toMatch(/:has\(/)
})
