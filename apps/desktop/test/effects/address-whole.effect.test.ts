import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

const WebBar = (await import('../../src/lib/web-tab/src/WebBar.svelte')).default
const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')

const ADDRESS = 'https://www.example.com/docs/guide?tab=install#linux'

let target: HTMLElement
let app: ReturnType<typeof mount>
const page = pages.of('whole')

function field(): HTMLInputElement {
  const found = target.querySelector('input')
  if (!found) throw new Error('no field')
  return found
}

beforeEach(() => {
  page.url = ADDRESS
  page.title = 'Installing - Example docs'
  target = document.createElement('div')
  document.body.append(target)
  const none = () => undefined
  app = mount(WebBar, {
    target,
    props: {
      page,
      tab: 'whole',
      focused: false,
      book: 'tests',
      onstep: none,
      onhistory: none,
      onaddress: none,
      onmenu: none,
      onsite: none,
      ondownloads: none,
      ontyping: none,
      onzoom: none,
      onbrowser: none,
    },
  })
  flushSync()
})

afterEach(() => {
  void unmount(app)
  target.remove()
})

test('reads the whole address at rest, scheme, www, path, query and fragment', () => {
  expect(field().value).toBe(ADDRESS)
  expect(field().value).not.toContain('Example docs')
})

test('follows the page to the next address, still whole', () => {
  page.url = 'http://example.org/a/b?c=d'
  flushSync()
  expect(field().value).toBe('http://example.org/a/b?c=d')
})

test('and a press changes nothing about what it says, only selects it to type over', () => {
  const box = field()
  box.focus()
  flushSync()
  expect(box.value).toBe(ADDRESS)
  box.blur()
  flushSync()
  expect(box.value).toBe(ADDRESS)
})
