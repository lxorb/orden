import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@nib/editor'

/** The store writes to the browser's storage the moment anything is toggled,
 *  and sets the zoom on the document element. Under node there is neither, so
 *  both are stood in for before the store is imported. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined } } })

/** What the two modes under test were last told. The editor's own side of
 *  them is tested in packages/editor; what matters here is that the store
 *  says the same thing to a view as it says in the menu. */
const told = vi.hoisted(() => ({ calls: [] as { mode: string; on: boolean }[] }))

vi.mock('@nib/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nib/editor')>()),
  setReadOnlyMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'read-only', on }),
  setSourceMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'source', on }),
  setVim: (_view: unknown, on: boolean) => told.calls.push({ mode: 'vim', on }),
  // A view built later takes every mode at once rather than one at a time, so
  // this is where the store says what it holds to a fresh editor.
  modeEffects: (settings: { readOnly: boolean; source: boolean; vim: boolean }) => {
    told.calls.push({ mode: 'read-only', on: settings.readOnly })
    told.calls.push({ mode: 'source', on: settings.source })
    told.calls.push({ mode: 'vim', on: settings.vim })
    return []
  },
}))

/** The account, standing still. One object across module resets, so a test can
 *  swap a call out and the store made afterwards still sees it. */
const api = vi.hoisted(() => {
  const empty: Held = {}

  return {
    settings: async () => ({ settings: empty }),
    saveSettings: async () => ({ settings: empty }),
  }
})

/** As much of the account's settings as these tests are about. */
interface Held {
  ligatures?: boolean | string
  attachments?: string
  vim?: boolean
}

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api,
}))

/** Everything the other mode setters reach for on a view, and nothing else. */
function surface() {
  const view = {
    state: { readOnly: false },
    dispatch: () => undefined,
    focus: () => undefined,
    requestMeasure: () => undefined,
    contentDOM: { setAttribute: () => undefined },
    dom: {
      isConnected: false,
      style: { setProperty: () => undefined },
      classList: {
        toggle: () => undefined,
        remove: () => undefined,
        add: () => undefined,
      },
    },
  }

  return view as unknown as EditorView
}

let modes: typeof import('./modes.svelte').modes

/** The store as a fresh start of the app would find it. */
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}

beforeEach(async () => {
  localStorage.clear()
  told.calls = []
  modes = await restarted()
})

describe('read-only mode', () => {
  test('starts off', () => {
    expect(modes.readOnly).toBe(false)
  })

  test('is remembered across a restart', async () => {
    modes.toggleReadOnly()
    expect(modes.readOnly).toBe(true)

    expect((await restarted()).readOnly).toBe(true)
  })

  test('reaches the view it is toggled against', () => {
    modes.toggleReadOnly(surface())
    expect(told.calls).toContainEqual({ mode: 'read-only', on: true })
  })

  test('is put back on a view built later', () => {
    modes.toggleReadOnly()
    told.calls = []

    modes.apply(surface())

    expect(told.calls).toContainEqual({ mode: 'read-only', on: true })
  })

  test('and stays off on one when it is off', () => {
    modes.apply(surface())
    expect(told.calls).toContainEqual({ mode: 'read-only', on: false })
  })
})

describe('the ligature scope', () => {
  test('starts off', () => {
    expect(modes.ligatures).toBe('off')
  })

  test('is remembered across a restart', async () => {
    modes.setLigatures('code')
    expect((await restarted()).ligatures).toBe('code')
  })

  /** A switch is what an entry written before the scope existed says, and a
   *  scope this build has never heard of is what one written after it might. */
  test('reads a switch written by an older build', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: true }))
    expect((await restarted()).ligatures).toBe('all')

    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: false }))
    expect((await restarted()).ligatures).toBe('off')
  })

  test('falls back to off for a scope it does not know', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ ligatures: 'sometimes' }))
    expect((await restarted()).ligatures).toBe('off')
  })

  test('ignores a scope it does not know when one is chosen', () => {
    modes.setLigatures('code')
    modes.setLigatures('sometimes')
    expect(modes.ligatures).toBe('code')
  })
})

describe('modal editing', () => {
  test('starts off', () => {
    expect(modes.vim).toBe(false)
  })

  test('is remembered across a restart', async () => {
    modes.toggleVim()
    expect(modes.vim).toBe(true)

    expect((await restarted()).vim).toBe(true)
  })

  test('reaches every editor on the page, not only the one it was toggled at', () => {
    modes.apply(surface())
    told.calls = []

    modes.toggleVim(surface())

    expect(told.calls.filter((one) => one.mode === 'vim')).toEqual([
      { mode: 'vim', on: true },
      { mode: 'vim', on: true },
    ])
  })

  test('is put back on a view built later', () => {
    modes.toggleVim()
    told.calls = []

    modes.apply(surface())

    expect(told.calls).toContainEqual({ mode: 'vim', on: true })
  })

  /** A preset says which it wants rather than that it wants the other one, so
   *  choosing the same preset twice does not turn modal editing off again. */
  test('is said outright rather than flipped', () => {
    modes.setVimKeys(true)
    modes.setVimKeys(true)
    expect(modes.vim).toBe(true)

    told.calls = []
    modes.setVimKeys(true)
    expect(told.calls).toEqual([])
  })

  test('has no mode to show while it is off', () => {
    expect(modes.vimModeOf(surface())).toBeNull()
    expect(modes.vimModeOf(undefined)).toBeNull()
  })

  /** The words the status bar shows, which the editor package reports the
   *  modes for; every one of them is translated in all four dictionaries. */
  test('has a word for every mode it has', async () => {
    const { VIM_WORDS } = await import('./modes.svelte')
    expect(Object.values(VIM_WORDS)).toEqual(['NORMAL', 'INSERT', 'VISUAL', 'REPLACE'])
  })
})

describe('read-only mode and source mode', () => {
  test('are never both on', () => {
    modes.toggleSource()
    modes.toggleReadOnly()

    expect(modes.readOnly).toBe(true)
    expect(modes.source).toBe(false)

    modes.toggleSource()

    expect(modes.source).toBe(true)
    expect(modes.readOnly).toBe(false)
  })

  test('cannot both come back from a hand-edited entry', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ source: true, readOnly: true }))

    const restored = await restarted()
    expect(restored.source).toBe(true)
    expect(restored.readOnly).toBe(false)
  })

  test('the one that was on is the one that comes back', async () => {
    modes.toggleReadOnly()

    const restored = await restarted()
    expect(restored.readOnly).toBe(true)
    expect(restored.source).toBe(false)
  })
})

describe('taking over what the account holds', () => {
  /** Answers the account's settings, but only once released - so a choice can
   *  be made on this machine while the answer is still in the air. */
  function heldAnswer(settings: Held) {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const settingsCall = async () => {
      await held
      return { settings }
    }

    return { release, settingsCall }
  }

  test('brings a setting this machine has never chosen', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'code' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('code')
  })

  /** The ligature setting was a switch before it was a scope, and an account
   *  written by that build still says so. */
  test('reads a switch from an older build as a scope', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('all')
  })

  test('and reads false as off', async () => {
    modes.setLigatures('all')
    const { release, settingsCall } = heldAnswer({ ligatures: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('ignores a scope it has never heard of', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'sometimes' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('leaves alone a choice made while the answer was in the air', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'all' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    // The reader picks a scope and goes back to off before the account answers.
    // The answer is older than that, and `setLigatures` has already sent this
    // machine's choice up.
    modes.setLigatures('code')
    modes.setLigatures('off')

    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('brings modal editing another machine turned on', async () => {
    const { release, settingsCall } = heldAnswer({ vim: true })
    api.settings = settingsCall
    modes.apply(surface())
    told.calls = []

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.vim).toBe(true)
    expect(told.calls).toContainEqual({ mode: 'vim', on: true })
  })

  test('brings the attachment folder another machine chose', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'named' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.attachments).toBe('named')
  })

  test('leaves a folder chosen while the answer was in the air', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'named' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    modes.setAttachments('note')

    release()
    await adopted

    expect(modes.attachments).toBe('note')
  })

  test('ignores a folder no version of the app knows', async () => {
    const { release, settingsCall } = heldAnswer({ attachments: 'vault' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.attachments).toBe('space')
  })
})

describe('where a pasted picture goes', () => {
  test("starts in the space's assets folder, which is where it always went", () => {
    expect(modes.attachments).toBe('space')
  })

  test('is remembered across a restart', async () => {
    modes.setAttachments('named')
    expect((await restarted()).attachments).toBe('named')
  })

  test('takes only one of the three names', async () => {
    modes.setAttachments('sideways')
    expect(modes.attachments).toBe('space')

    localStorage.setItem('nib:modes', JSON.stringify({ attachments: 'sideways' }))
    expect((await restarted()).attachments).toBe('space')
  })
})
