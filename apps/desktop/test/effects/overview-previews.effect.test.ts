import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/surfaces.svelte', async (original) => {
  const Drawn = (await import('./Drawn.svelte')).default
  const drawn = () => Promise.resolve(Drawn)
  return {
    ...(await original<typeof import('../../src/lib/surfaces.svelte')>()),
    askPanel: drawn,
    canvasSurface: drawn,
    chatSurface: drawn,
    conversationSurface: drawn,
    explorerSurface: drawn,
    timeSurface: drawn,
    graphSurface: drawn,
    pagesSurface: drawn,
    viewSurface: drawn,
  }
})

vi.mock('../../src/lib/terminal/sessions.svelte', () => ({
  screenOf: () => ({ text: '$ make\nall done', cols: 80 }),
}))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { TAB_KINDS } = await import('../../src/lib/workspace/tab-kinds')
const { faces } = await import('../../src/lib/overview/src/faces.svelte')
const { scrollbackOf } = await import('../../src/lib/overview/src/previews')
const Offstage = (await import('../../src/lib/overview/src/Offstage.svelte')).default

let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
})

async function until(done: () => boolean) {
  for (let waited = 0; !done() && waited < 20_000; waited += 25) {
    await new Promise((later) => setTimeout(later, 25))
    flushSync()
  }
}

test('every kind that is drawn from itself is drawn off the screen once, and kept as its window’s picture', async () => {
  const kinds = Object.entries(TAB_KINDS)
    .filter(([, traits]) => traits.preview === 'drawn')
    .map(([kind]) => kind as keyof typeof TAB_KINDS)
  expect(kinds.length).toBeGreaterThan(5)
  const tabs = kinds.map(
    (kind) =>
      new Tab(
        new NoteDoc(
          { kind, path: null, name: `A ${kind}`, text: '', dirty: false },
          () => undefined,
        ),
        'pane',
      ),
  )
  workspace.tabs = tabs
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(Offstage, { target, props: { tabs, width: 800, height: 600 } })
  flushSync()
  await until(() => tabs.every((tab) => faces.of(tab.id)?.html))
  for (const tab of tabs) expect(faces.of(tab.id)?.html, tab.kind).toContain('drawn:')
  target.remove()
})

test('a terminal’s window is its screen as it is now, not only what was written down of it', async () => {
  const tab = new Tab(
    new NoteDoc(
      { kind: 'terminal', path: null, name: 'Shell', text: '', dirty: false },
      () => undefined,
    ),
    'pane',
  )
  expect((await scrollbackOf(tab))?.text).toBe('$ make\nall done')
})

test('no kind is left with nothing but a picture of it, but an application, whose picture keeps its frame', () => {
  const only = Object.entries(TAB_KINDS)
    .filter(([, traits]) => traits.preview === 'picture')
    .map(([kind]) => kind)
  expect(only).toEqual(['application'])
})
