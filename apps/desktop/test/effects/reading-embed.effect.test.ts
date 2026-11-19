import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { world } from './reading-embed-world.svelte'
import { idle } from './settle'

vi.mock('../../src/lib/reading/src/drawn', () => ({ inlineFiles: () => () => undefined }))
vi.mock('../../src/lib/reading/src/render', () => ({
  readingHtml: async (source: { text: string }) => {
    await Promise.resolve()
    return source.text
      .split('\n')
      .filter(Boolean)
      .map((line) => `<p>${line === '![[Flow]]' ? world.embedded : line}</p>`)
      .join('')
  },
  unreadableHtml: (text: string) => text,
  tagAnchor: (tag: string) => `#${tag}`,
}))
vi.mock('../../src/lib/ui-kit/src/scrollbar', () => ({
  scrollbar: () => ({ destroy: () => undefined }),
}))
vi.mock('../../src/lib/sharing/src/api', () => ({ trustsHtmlIn: () => false }))
vi.mock('../../src/lib/link-index/src/api', () => ({
  links: {
    get version() {
      return world.version
    },
    index: () => null,
    locksSeen: () => '',
  },
}))
vi.mock('../../src/lib/workspace/src/api', () => ({
  workspace: {
    rootHolding: () => null,
    notePlace: () => undefined,
    toggleReading: () => undefined,
  },
}))
const Reading = (await import('../../src/lib/reading/src/Reading.svelte')).default
let shown: ReturnType<typeof mount> | null = null
afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
  world.embedded = 'first words'
  world.version = 0
})
async function opened() {
  const tab = {
    id: 't1',
    path: '/s/Today.md',
    shown: 'Today',
    anchor: undefined,
    get doc() {
      return world.doc
    },
    note: {
      get revision() {
        return world.revision
      },
      flush: () => undefined,
    },
  }
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(Reading, { target, props: { tab: tab as never, focused: true } })
  flushSync()
  await idle(50)
  flushSync()
  return target
}
test('an embedded note saved elsewhere shows its new words in the reading view', async () => {
  const target = await opened()
  expect(target.querySelector('article')?.textContent).toBe('Todayfirst words')
  world.embedded = 'second words'
  world.version++
  flushSync()
  await idle(400)
  flushSync()
  expect(target.querySelector('article')?.textContent).toBe('Todaysecond words')
})
