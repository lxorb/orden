import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Something shared to the app on a phone, while the open space is one shared with
 *  this account to be read (B280). A note of its own would be written into that space,
 *  which the sync refuses on every pass, so none is made and nothing is written. */

const readOnly = vi.hoisted(() => ({ on: true }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => !readOnly.on }))

const imported: unknown[] = []
vi.mock('../import/apply', () => ({
  applyImport: (plan: unknown, target: unknown) => {
    imported.push({ plan, target })
    return Promise.resolve({ paths: [], stepped: 0 })
  },
}))

/** What the activity holds: a link shared from a browser. */
const activity = {
  handed: () => '',
  shared: () => JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: 'a link' }] }),
  sharedDone: () => undefined,
}
vi.mock('./bridge', () => ({
  onTheActivity: () => true,
  method: (name: keyof typeof activity) => activity[name],
  answer: () => undefined,
}))
vi.mock('./widgets.svelte', () => ({ watchWidgets: () => () => undefined }))
vi.mock('../commands', () => ({ appCommands: () => [] }))
vi.mock('../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../insert-picture', () => ({ putPicture: () => undefined, writeAtCaret: () => undefined }))
vi.mock('../prompt.svelte', () => ({ prompt: { choose: () => Promise.resolve('new') } }))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'theirs', name: 'Theirs', root: '/theirs' }],
    activeSpace: { id: 'theirs', name: 'Theirs', root: '/theirs' },
    active: null,
    panes: { focusedId: 'a' },
    open: () => Promise.resolve(),
    openEntry: () => Promise.resolve(),
  },
}))

const { startHanded } = await import('./handed')

/** The share taken, and every write it led to waited for. */
async function share() {
  const stop = startHanded()
  await new Promise((done) => setTimeout(done, 20))
  stop()
}

beforeEach(() => {
  imported.length = 0
  readOnly.on = true
})

describe('a share into a space shared to be read', () => {
  test('makes no note there', async () => {
    await share()
    expect(imported).toEqual([])
  })

  test("while one shared into the reader's own space does", async () => {
    readOnly.on = false
    await share()
    await vi.waitFor(() => expect(imported).toHaveLength(1))
  })
})
