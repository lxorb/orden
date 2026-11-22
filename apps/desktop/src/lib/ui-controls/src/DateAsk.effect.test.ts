import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const DateAsk = (await import('./DateAsk.svelte')).default
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  document.body.replaceChildren()
})
test('the layer that catches a press beside the picker is a clear scrim, not a mark that covers the page', () => {
  shown = mount(DateAsk, {
    target: document.body,
    props: { kind: 'date', value: '2026-11-22', at: new DOMRect(10, 10, 40, 20), onpick: () => undefined },
  })
  flushSync()
  const catcher = document.querySelector<HTMLElement>('.catch')
  expect(catcher?.classList.contains('orden-scrim')).toBe(true)
  expect(catcher?.classList.contains('is-clear')).toBe(true)
  expect(catcher?.hasAttribute('data-covers')).toBe(false)
})
