import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  followed: [] as { path: string | null; target: string }[],
  hrefs: [] as string[],
  closed: 0,
}))

vi.mock('./ai/quick.svelte', () => ({
  quick: {
    open: true,
    ready: true,
    question: '',
    turns: [
      { role: 'you', text: 'Where do herons nest?' },
      {
        role: 'model',
        text: 'In reeds, says [[Birds]], and [the list](Lists/Nests.md) and [a page](https://example.com).',
      },
    ],
    running: false,
    trouble: null,
    context: null,
    texts: [],
    close: () => world.closed++,
    ask: () => undefined,
    stop: () => undefined,
    drop: () => undefined,
  },
}))

vi.mock('./link-index.svelte', async (original) => ({
  ...(await original<typeof import('./link-index.svelte')>()),
  links: {
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target === 'Birds' ? 'Birds.md' : null,
    index: () => [],
    version: 0,
  },
}))

vi.mock('./open-link', async (original) => ({
  ...(await original<typeof import('./open-link')>()),
  followNote: (jump: { path: string | null; target: string }) => world.followed.push(jump),
  followHref: (href: string) => world.hrefs.push(href),
}))

const QuickQuestion = (await import('./QuickQuestion.svelte')).default

test('a note an answer names opens from the quick question, as from the side chat', () => {
  const target = document.createElement('div')
  document.body.append(target)
  const drawn = mount(QuickQuestion, { target, props: {} })
  flushSync()

  const anchors = [...target.querySelectorAll<HTMLAnchorElement>('.talk a')]
  expect(anchors.map((one) => one.textContent)).toEqual(['Birds', 'the list', 'a page'])
  for (const one of anchors) one.click()

  expect(world.followed.map((one) => one.path)).toEqual(['Birds.md', 'Lists/Nests.md'])
  expect(world.hrefs).toEqual(['https://example.com'])
  expect(world.closed).toBe(3)
  void unmount(drawn)
  target.remove()
})
