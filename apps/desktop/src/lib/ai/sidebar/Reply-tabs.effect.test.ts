import { flushSync, mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { expect, test, vi } from 'vitest'

const drawing = vi.hoisted(() => ({ count: 0 }))

vi.mock('../drawn', async (importOriginal) => {
  const real = await importOriginal<typeof import('../drawn')>()
  return {
    ...real,
    answerHtml: (...args: Parameters<typeof real.answerHtml>) => {
      drawing.count++
      return real.answerHtml(...args)
    },
  }
})

vi.mock('./chat.svelte', () => ({
  chat: { unfolded: false, root: '/n/Work', head: null, provider: null, models: {}, resets: {} },
}))

const { workspace } = await import('../../workspace.svelte')
const Reply = (await import('./Reply.svelte')).default

test('an answer is not drawn again when another tab comes to the front', () => {
  const front = new SvelteMap<'tab', { id: string; path: string }>([
    ['tab', { id: 'a', path: '/n/Work/Herons.md' }],
  ])
  Object.defineProperty(workspace, 'panelTab', {
    configurable: true,
    get: () => front.get('tab'),
  })
  const turn = {
    id: 't1',
    role: 'model',
    parts: [
      { kind: 'text', text: 'See [[Kestrels]] and **this**.' },
      { kind: 'text', text: 'And a second part.' },
    ],
  }
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Reply, {
    target,
    props: { turn: turn as never, sources: [], last: true, live: false },
  })
  flushSync()
  const drawn = drawing.count
  expect(drawn).toBeGreaterThan(0)
  expect(target.querySelector('.words strong')?.textContent).toBe('this')

  for (const [id, path] of [
    ['b', '/n/Work/Hovering.md'],
    ['c', '/n/Work/Wading.md'],
  ] as const) {
    front.set('tab', { id, path })
    flushSync()
  }

  expect(drawing.count).toBe(drawn)
  void unmount(shown)
  target.remove()
})
