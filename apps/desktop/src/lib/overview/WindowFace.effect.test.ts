import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const { workspace } = await import('../workspace.svelte')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { unlocks } = await import('../protect/src/unlocked.svelte')
const WindowFace = (await import('./WindowFace.svelte')).default

const ROOT = '/space'
const PATH = `${ROOT}/Diary.md`

let target: HTMLElement | undefined
let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  target?.remove()
  workspace.protection.set(ROOT, PATH, null)
})

async function until(done: () => boolean) {
  for (let waited = 0; !done() && waited < 10_000; waited += 20) {
    await new Promise((later) => setTimeout(later, 20))
    flushSync()
  }
}

async function face(drawn: (shown: HTMLElement) => boolean): Promise<HTMLElement> {
  const note = new NoteDoc(
    {
      kind: 'note',
      path: PATH,
      name: 'Diary.md',
      text: '# Diary\n\nthe secret words',
      dirty: false,
    },
    () => undefined,
  )
  const tab = new Tab(note, 'pane')
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(WindowFace, { target, props: { tab, face: null, width: 400, height: 300 } })
  flushSync()
  const shownIn = target
  await until(() => drawn(shownIn))
  return shownIn
}

describe('a window of the overview', () => {
  test('of a note shows its words', async () => {
    const drawn = await face((one) => one.textContent.includes('secret words'))
    expect(drawn.textContent).toContain('secret words')
  })

  test('of the same note protected and shut shows its name and none of its words', async () => {
    workspace.protection.set(ROOT, PATH, 'password')
    unlocks.lockAll()
    let waited = false
    setTimeout(() => (waited = true), 300)
    const drawn = await face(() => waited)
    expect(drawn.textContent).toContain('Diary')
    expect(drawn.textContent).not.toContain('secret words')
  })
})
