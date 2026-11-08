import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@orden/editor'
import { familyName, glassesBreak, KEEP_MONTH, KEEP_YEAR, rollbackSteps } from './modes.svelte'

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
const styled = new Map<string, string>()
const root = {
  style: { setProperty: (name: string, value: string) => void styled.set(name, value) },
  dataset: {} as Record<string, string>,
  attributes: new Set<string>(),
  toggleAttribute(name: string, on?: boolean) {
    const wanted = on ?? !this.attributes.has(name)
    if (wanted) this.attributes.add(name)
    else this.attributes.delete(name)
    return wanted
  },
}

vi.stubGlobal('document', { documentElement: root })

const told = vi.hoisted(() => ({
  calls: [] as { mode: string; on: boolean }[],
  views: [] as { view: unknown; mode: string; on: boolean }[],
}))

const crate = vi.hoisted(() => ({ refuses: false, asked: [] as unknown[] }))

vi.mock('./tauri', async (importOriginal) => {
  const real = await importOriginal<typeof import('./tauri')>()
  return {
    ...real,
    invoke: (command: string, args?: Record<string, unknown>) => {
      if (command !== 'interface_zoom_choose') return real.invoke(command, args)
      crate.asked.push(args?.factor)
      return crate.refuses ? Promise.reject(new Error('disk full')) : Promise.resolve()
    },
  }
})

vi.mock('@orden/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/editor')>()),
  setReadOnlyMode: (view: unknown, on: boolean) => {
    told.calls.push({ mode: 'read-only', on })
    told.views.push({ view, mode: 'read-only', on })
  },
  setSourceMode: (view: unknown, on: boolean) => {
    told.calls.push({ mode: 'source', on })
    told.views.push({ view, mode: 'source', on })
  },
  setVim: (_view: unknown, on: boolean) => told.calls.push({ mode: 'vim', on }),
  modeEffects: (settings: { readOnly: boolean; source: boolean; vim: boolean }) => {
    told.calls.push({ mode: 'read-only', on: settings.readOnly })
    told.calls.push({ mode: 'source', on: settings.source })
    told.calls.push({ mode: 'vim', on: settings.vim })
    return []
  },
}))

const api = vi.hoisted(() => {
  const empty: Held = {}

  return {
    settings: async () => ({ settings: empty }),
    saveSettings: async (_token: string, _patch: Held) => ({ settings: empty }),
  }
})

interface Held {
  ligatures?: boolean | string
  attachments?: string
  vim?: boolean
  glassesSeen?: boolean
  mobileSeen?: boolean
  quietMarks?: boolean
  silent?: boolean
  developer?: boolean
  undatedInToday?: boolean
  canvasTurns?: boolean
  canvasTurnSnaps?: boolean
}

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api,
}))

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

await import('./modes.svelte')

async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}

beforeEach(async () => {
  localStorage.clear()
  told.calls = []
  told.views = []
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

describe('the glasses settings', () => {
  const saved = () =>
    JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>

  test('start a page at H2 and above, with the note’s own line numbers', () => {
    expect(modes.glassesBreak).toBe(2)
    expect(modes.glassesLineNumbers).toBe(true)
  })

  test('carry no scroll mode, and drop one an older version wrote down', async () => {
    localStorage.setItem(
      'orden:modes',
      JSON.stringify({ glassesScroll: 'native', glassesLineNumbers: false }),
    )

    const back = await restarted()
    expect(back.glassesLineNumbers).toBe(false)
    expect(saved()).not.toHaveProperty('glassesScroll')
    expect(Object.keys(back as unknown as Record<string, unknown>)).not.toContain('glassesScroll')
  })

  test('start with the microphone off, which is the only defensible default', () => {
    expect(modes.glassesVoice).toBe(false)
  })

  test('start with no model, because there is nothing to guess', () => {
    expect(modes.glassesModel).toBe('')
    expect(modes.glassesEffort).toBe('low')
  })

  test('take a heading level and write it down', () => {
    modes.setGlassesBreak('3')
    expect(modes.glassesBreak).toBe(3)
    expect(saved().glassesBreak).toBe(3)

    modes.setGlassesBreak('0')
    expect(modes.glassesBreak).toBe(0)
  })

  test('ignore a heading level there is no such thing as', () => {
    modes.setGlassesBreak('2')
    modes.setGlassesBreak('9')
    modes.setGlassesBreak('nowhere')
    expect(modes.glassesBreak).toBe(2)
  })

  test('read a level whether it arrives as a number or as a word', () => {
    expect(glassesBreak(2)).toBe(2)
    expect(glassesBreak('2')).toBe(2)
    expect(glassesBreak(0)).toBe(0)
    expect(glassesBreak(7)).toBeNull()
    expect(glassesBreak(true)).toBeNull()
    expect(glassesBreak(undefined)).toBeNull()
  })

  test('take the two switches and write them down', () => {
    modes.setGlassesLineNumbers(false)
    modes.setGlassesVoice(true)

    expect(saved().glassesLineNumbers).toBe(false)
    expect(saved().glassesVoice).toBe(true)
  })

  test('take a model and an effort the API knows', () => {
    modes.setGlassesModel('gpt-6-astra')
    modes.setGlassesEffort('high')

    expect(saved().glassesModel).toBe('gpt-6-astra')
    expect(saved().glassesEffort).toBe('high')
  })

  test('ignore an effort the API does not take', () => {
    modes.setGlassesEffort('medium')
    modes.setGlassesEffort('banana')
    expect(modes.glassesEffort).toBe('medium')
  })
})

describe('smart punctuation', () => {
  test('starts off', () => {
    expect(modes.punctuation).toBe(false)
  })

  test('stays off for a reader who never chose', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ focus: true }))
    expect((await restarted()).punctuation).toBe(false)
  })

  test('and stays on for one who turned it on', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ punctuation: true }))
    expect((await restarted()).punctuation).toBe(true)
  })

  test('is remembered across a restart', async () => {
    modes.togglePunctuation()
    expect(modes.punctuation).toBe(true)
    expect((await restarted()).punctuation).toBe(true)
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

  test('reads a switch written by an older build', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ ligatures: true }))
    expect((await restarted()).ligatures).toBe('all')

    localStorage.setItem('orden:modes', JSON.stringify({ ligatures: false }))
    expect((await restarted()).ligatures).toBe('off')
  })

  test('falls back to off for a scope it does not know', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ ligatures: 'sometimes' }))
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

  describe('only ever turns on by hand', () => {
    test('on a machine with nothing written down', () => {
      expect(modes.vim).toBe(false)
    })

    test('on a machine whose entry was written before there was such a setting', async () => {
      localStorage.setItem('orden:modes', JSON.stringify({ zoom: 1.1, focus: true }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('on a machine that wrote it down as off', async () => {
      localStorage.setItem('orden:modes', JSON.stringify({ vim: false }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('with an entry that says null, which is not a choice either', async () => {
      localStorage.setItem('orden:modes', JSON.stringify({ vim: null }))

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('through a restart after every other mode was turned on', async () => {
      modes.toggleFocus()
      modes.toggleTypewriter()
      modes.toggleOpensInSource()
      modes.setLigatures('all')

      const store = await restarted()
      expect(store.vim).toBe(false)
    })

    test('when a pane builds a fresh editor', () => {
      modes.apply(surface())

      expect(modes.vim).toBe(false)
      expect(told.calls).toContainEqual({ mode: 'vim', on: false })
      expect(told.calls).not.toContainEqual({ mode: 'vim', on: true })
    })
  })

  test('has a word for every mode it has', async () => {
    const { VIM_WORDS } = await import('./modes.svelte')
    expect(Object.values(VIM_WORDS)).toEqual(['NORMAL', 'INSERT', 'VISUAL', 'REPLACE'])
  })
})

describe('the formatting marks kept quiet', () => {
  test('start shown, and are remembered across a restart', async () => {
    expect(modes.quietMarks).toBe(false)
    modes.toggleQuietMarks()
    expect((await restarted()).quietMarks).toBe(true)
  })
})

describe('Silent mode', () => {
  test('starts off, so hints show, and is remembered across a restart', async () => {
    expect(modes.silent).toBe(false)
    modes.toggleSilent()
    expect((await restarted()).silent).toBe(true)
  })
})

describe('turning a canvas with two fingers (#351)', () => {
  test('starts on, and is remembered off across a restart (#487)', async () => {
    expect(modes.canvasTurns).toBe(true)
    modes.setCanvasTurns(false)
    expect((await restarted()).canvasTurns).toBe(false)
  })

  test('takes no off from an older build, which wrote it down for everybody', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ canvasTurns: false, vim: true }))
    const back = await restarted()
    expect(back.canvasTurns).toBe(true)
    expect(back.vim).toBe(true)
    expect(localStorage.getItem('orden:modes')).not.toContain('"canvasTurns"')
  })

  test('snaps to its right angles unless that is turned off (#487)', async () => {
    expect(modes.canvasTurnSnaps).toBe(true)
    modes.setCanvasTurnSnaps(false)
    expect((await restarted()).canvasTurnSnaps).toBe(false)
  })
})

describe('the tasks with no start date in Today', () => {
  test('start in it, and leaving them out is remembered across a restart (#2017)', async () => {
    expect(modes.undatedInToday).toBe(true)
    modes.setUndatedInToday(false)
    expect((await restarted()).undatedInToday).toBe(false)
    modes.setUndatedInToday(true)
    expect((await restarted()).undatedInToday).toBe(true)
  })

  test('come in for a machine an older build wrote the old off down for (#2017)', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ undatedInToday: false, vim: true }))
    const back = await restarted()
    expect(back.undatedInToday).toBe(true)
    expect(back.vim).toBe(true)
    expect(localStorage.getItem('orden:modes')).not.toContain('"undatedInToday"')
  })
})

describe('Developer mode', () => {
  test('is unasked at first, which keeps the terminals', () => {
    expect(modes.developer).toBeNull()
    expect(modes.coder).toBe(true)
  })

  test('a first no writes the way Notion does, and is remembered', async () => {
    modes.setDeveloper(false)
    expect(modes.coder).toBe(false)
    expect(modes.quietMarks).toBe(true)

    const again = await restarted()
    expect(again.developer).toBe(false)
    expect(again.quietMarks).toBe(true)
  })

  test('a first yes keeps the marks under the caret, as Obsidian does', () => {
    modes.setDeveloper(true)
    expect(modes.coder).toBe(true)
    expect(modes.quietMarks).toBe(false)
  })

  test('after the first answer, leaves the marks to their own switch', () => {
    modes.setDeveloper(false)
    modes.toggleQuietMarks()
    modes.setDeveloper(true)
    modes.setDeveloper(false)
    expect(modes.quietMarks).toBe(false)
  })
})

describe('the pointing hand', () => {
  test('starts off and is said on the root for the stylesheet', async () => {
    expect(modes.hand).toBe(false)
    expect(root.dataset.pointer).toBeUndefined()

    modes.toggleHand()
    expect(root.dataset.pointer).toBe('hand')
    expect((await restarted()).hand).toBe(true)

    modes = await restarted()
    modes.toggleHand()
    expect(root.dataset.pointer).toBeUndefined()
  })
})

describe('source mode, per tab', () => {
  function tab(source = false) {
    return { source, written: 0 }
  }

  function showing(one: ReturnType<typeof tab>) {
    const view = surface()
    modes.apply(view)
    modes.shows(view, one, () => (one.written += 1))
    return view
  }

  function lastSource(view: EditorView): boolean | undefined {
    return told.views.filter((one) => one.view === view && one.mode === 'source').at(-1)?.on
  }

  test('turns in the one view it is asked of, even with the same note beside it', () => {
    const left = tab()
    const right = tab()
    const leftView = showing(left)
    const rightView = showing(right)

    modes.toggleSource(rightView)

    expect(right.source).toBe(true)
    expect(left.source).toBe(false)
    expect(modes.sourceIn(rightView)).toBe(true)
    expect(modes.sourceIn(leftView)).toBe(false)
    expect(lastSource(rightView)).toBe(true)
    expect(lastSource(leftView)).not.toBe(true)
  })

  test('writes the tab down and leaves where new tabs open alone', async () => {
    const one = tab()
    modes.toggleSource(showing(one))

    expect(one.written).toBe(1)
    expect(modes.opensInSource).toBe(false)
    expect((await restarted()).opensInSource).toBe(false)
  })

  test('does nothing where there is no editor to turn', () => {
    modes.toggleSource()
    modes.toggleSource(surface())

    expect(told.views.filter((one) => one.mode === 'source')).toEqual([])
  })

  test('dresses a view in the face of the tab it shows', () => {
    const raw = tab(true)
    const view = surface()
    modes.shows(view, raw, () => undefined)
    modes.apply(view)

    expect(modes.settingsFor(raw).source).toBe(true)
    expect(modes.settingsFor(tab()).source).toBe(false)
    expect(told.calls.at(-2)).toEqual({ mode: 'source', on: true })
  })

  test('starts a new tab where Settings says, and remembers that across a restart', async () => {
    const { Tab, opening } = await import('./workspace/documents.svelte')
    const note = { kind: 'note' } as unknown as ConstructorParameters<typeof Tab>[0]
    expect(new Tab(note, 'p1').source).toBe(false)

    modes.toggleOpensInSource()

    expect(opening.source).toBe(true)
    expect(new Tab(note, 'p1').source).toBe(true)

    const restored = await restarted()
    const fresh = await import('./workspace/documents.svelte')
    expect(restored.opensInSource).toBe(true)
    expect(new fresh.Tab(note, 'p1').source).toBe(true)
  })

  test('opens where the one switch for the window was left by an older build', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ source: true }))

    expect((await restarted()).opensInSource).toBe(true)
  })
})

describe('read-only mode and source mode', () => {
  function tab(source = false) {
    return { source }
  }

  function showing(one: { source: boolean }) {
    const view = surface()
    modes.apply(view)
    modes.shows(view, one, () => undefined)
    return view
  }

  test('are never both on in a view', () => {
    const raw = tab(true)
    const view = showing(raw)

    modes.toggleReadOnly(view)

    expect(modes.readOnly).toBe(true)
    expect(modes.sourceIn(view)).toBe(false)

    modes.toggleSource(view)

    expect(modes.sourceIn(view)).toBe(true)
    expect(modes.readOnly).toBe(false)
  })

  test('source mode turned on under the lock takes it off every pane', () => {
    const raw = tab(true)
    const written = tab()
    const rawView = showing(raw)
    const writtenView = showing(written)
    modes.toggleReadOnly(writtenView)

    modes.toggleSource(writtenView)

    expect(modes.readOnly).toBe(false)
    expect(modes.sourceIn(writtenView)).toBe(true)
    expect(modes.sourceIn(rawView)).toBe(true)
  })

  test('each tab goes back to its own face when the lock comes off', () => {
    const raw = tab(true)
    const written = tab()
    const rawView = showing(raw)
    const writtenView = showing(written)

    modes.toggleReadOnly(rawView)
    expect(modes.sourceIn(rawView)).toBe(false)
    expect(modes.settingsFor(raw).source).toBe(false)

    modes.toggleReadOnly(rawView)
    expect(modes.sourceIn(rawView)).toBe(true)
    expect(modes.sourceIn(writtenView)).toBe(false)
  })

  test('the lock comes back as it was left, beside a default of source mode', async () => {
    modes.toggleOpensInSource()
    modes.toggleReadOnly()

    const restored = await restarted()
    expect(restored.readOnly).toBe(true)
    expect(restored.opensInSource).toBe(true)
    expect(restored.settings.source).toBe(false)
  })
})

describe('taking over what the account holds', () => {
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

  test('brings the formatting marks kept quiet', async () => {
    const { release, settingsCall } = heldAnswer({ quietMarks: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.quietMarks).toBe(true)
  })

  test('brings Silent mode', async () => {
    const { release, settingsCall } = heldAnswer({ silent: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.silent).toBe(true)
  })

  test('turns a canvas with two fingers where the account says so', async () => {
    const { release, settingsCall } = heldAnswer({ canvasTurns: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.canvasTurns).toBe(true)
  })

  test('keeps the tasks with no start date out of Today where the account says so', async () => {
    const { release, settingsCall } = heldAnswer({ undatedInToday: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.undatedInToday).toBe(false)
  })

  test('leaves them where this machine put them while the answer was in the air', async () => {
    const { release, settingsCall } = heldAnswer({ undatedInToday: true })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    modes.setUndatedInToday(false)
    release()
    await adopted

    expect(modes.undatedInToday).toBe(false)
  })

  test('keeps the new default for an account that never chose (#2017)', async () => {
    const { release, settingsCall } = heldAnswer({})
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.undatedInToday).toBe(true)
  })

  test('brings Developer mode', async () => {
    const { release, settingsCall } = heldAnswer({ developer: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.coder).toBe(false)
  })

  test('brings a setting this machine has never chosen', async () => {
    const { release, settingsCall } = heldAnswer({ ligatures: 'code' })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.ligatures).toBe('code')
  })

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
    modes.setLigatures('code')
    modes.setLigatures('off')

    release()
    await adopted

    expect(modes.ligatures).toBe('off')
  })

  test('says nothing about modal editing unless the account does', async () => {
    for (const settings of [{}, { ligatures: 'all' }, { attachments: 'note' }] as Held[]) {
      const store = await restarted()
      const { release, settingsCall } = heldAnswer(settings)
      api.settings = settingsCall

      const adopted = store.adopt('token')
      release()
      await adopted

      expect(store.vim, JSON.stringify(settings)).toBe(false)
    }
  })

  test('leaves modal editing off for an account that wrote it down as off', async () => {
    const { release, settingsCall } = heldAnswer({ vim: false })
    api.settings = settingsCall

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.vim).toBe(false)
    expect(told.calls).not.toContainEqual({ mode: 'vim', on: true })
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

  test('carries up what was decided before the session came back', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({})
    api.settings = settingsCall

    modes.sawGlasses()
    expect(modes.glassesSeen).toBe(true)
    expect(patches).toEqual([])

    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(patches).toEqual([{ glassesSeen: true }])
  })

  test('and keeps owing it where the account could not be reached', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      throw new Error('offline')
    }
    api.settings = async () => {
      throw new Error('offline')
    }

    modes.sawGlasses()
    expect(await modes.adopt('token')).toBeNull()
    expect(patches).toEqual([{ glassesSeen: true }])

    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({})
    api.settings = settingsCall
    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(patches).toEqual([{ glassesSeen: true }, { glassesSeen: true }])
  })

  test('owes nothing to the next account once the session that could not be reached signs out', async () => {
    const patches: [string, Held][] = []
    api.saveSettings = async (token: string, patch: Held) => {
      patches.push([token, patch])
      throw new Error('offline')
    }
    api.settings = async () => {
      throw new Error('offline')
    }

    modes.sawGlasses()
    expect(await modes.adopt('first')).toBeNull()

    const { account } = await import('./account.svelte')
    await account.signOut()

    api.saveSettings = async (token: string, patch: Held) => {
      patches.push([token, patch])
      return { settings: {} }
    }
    api.settings = async () => ({ settings: {} })
    await modes.adopt('second')

    expect(patches).toEqual([['first', { glassesSeen: true }]])
  })

  test('takes nothing from an account whose answer comes after it signed out', async () => {
    const { release, settingsCall } = heldAnswer({ vim: true, quietMarks: true })
    api.settings = settingsCall

    const adopted = modes.adopt('first')
    const { account } = await import('./account.svelte')
    await account.signOut()
    release()

    expect(await adopted).toBeNull()
    expect(modes.vim).toBe(false)
    expect(modes.quietMarks).toBe(false)
  })

  test('takes it from the account, and then has nothing left to say', async () => {
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    const { release, settingsCall } = heldAnswer({ glassesSeen: true })
    api.settings = settingsCall

    expect(modes.glassesSeen).toBe(false)
    const adopted = modes.adopt('token')
    release()
    await adopted

    expect(modes.glassesSeen).toBe(true)
    modes.sawGlasses()
    expect(patches).toEqual([])
  })

  describe('a phone or a tablet on the account', () => {
    async function adoptedOn(device: 'desktop' | 'phone', account: Held) {
      const patches: Held[] = []
      api.saveSettings = async (_token: string, patch: Held) => {
        patches.push(patch)
        return { settings: {} }
      }
      api.settings = async () => ({ settings: account })
      const { viewport } = await import('./viewport.svelte')
      viewport.device = device
      await modes.adopt('token')
      return patches
    }

    test('is never said by a laptop', async () => {
      expect(await adoptedOn('desktop', {})).toEqual([])
      expect(modes.mobileSeen).toBe(false)
    })

    test('is said by a phone, in a request of its own', async () => {
      expect(await adoptedOn('phone', {})).toEqual([{ mobileSeen: true }])
      expect(modes.mobileSeen).toBe(true)
    })

    test('is taken from the account on a laptop, and kept across a restart', async () => {
      expect(await adoptedOn('desktop', { mobileSeen: true })).toEqual([])
      expect(modes.mobileSeen).toBe(true)
      expect((await restarted()).mobileSeen).toBe(true)
    })

    test('is not said again by a phone the account has already heard from', async () => {
      expect(await adoptedOn('phone', { mobileSeen: true })).toEqual([])
    })

    test('is never owed with the other settings when the account refuses it', async () => {
      api.saveSettings = async () => {
        throw new Error('unknown setting mobileSeen')
      }
      api.settings = async () => ({ settings: {} })
      const { viewport } = await import('./viewport.svelte')
      viewport.device = 'phone'
      await modes.adopt('token')

      modes.toggleSilent()
      const patches: Held[] = []
      api.saveSettings = async (_token: string, patch: Held) => {
        patches.push(patch)
        return { settings: {} }
      }
      await modes.adopt('token')
      expect(patches).toEqual([{ silent: modes.silent }, { mobileSeen: true }])
    })
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

    localStorage.setItem('orden:modes', JSON.stringify({ attachments: 'sideways' }))
    expect((await restarted()).attachments).toBe('space')
  })
})

describe('how far back a bulk restore offers to go', () => {
  test('is three steps while the account keeps a month', () => {
    expect(rollbackSteps(KEEP_MONTH)).toEqual([1, 7, 30])
  })

  test('and reaches the year when the account keeps one', () => {
    expect(rollbackSteps(KEEP_YEAR)).toEqual([1, 7, 30, 90, 180, 365])
    expect(rollbackSteps(KEEP_YEAR).at(-1)).toBe(KEEP_YEAR)
  })

  test('and never past the horizon, whatever the horizon is', () => {
    for (const keep of [1, 7, 29, 30, 100, 365, 4000]) {
      for (const step of rollbackSteps(keep)) expect(step).toBeLessThanOrEqual(keep)
    }

    expect(rollbackSteps(0)).toEqual([])
  })

  test('and follows the setting, which is what puts the year in the row', () => {
    modes.setKeepVersions(KEEP_YEAR)
    expect(rollbackSteps(modes.keepVersions)).toContain(365)

    modes.setKeepVersions(KEEP_MONTH)
    expect(rollbackSteps(modes.keepVersions)).not.toContain(365)
  })
})

describe('the paper new page notes start on', () => {
  test('is A4 until somebody says otherwise', () => {
    expect(modes.pagesPaper).toBe('a4')
  })

  test('is whichever of the three they chose, and is remembered', async () => {
    modes.setPagesPaper('letter')
    expect(modes.pagesPaper).toBe('letter')
    expect((await restarted()).pagesPaper).toBe('letter')

    modes.setPagesPaper('long')
    expect((await restarted()).pagesPaper).toBe('long')
  })

  test('and a word nobody wrote is A4 again', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ pagesPaper: 'foolscap' }))
    expect((await restarted()).pagesPaper).toBe('a4')
  })
})

describe('the window’s own frame', () => {
  test('is Orden’s own until somebody says otherwise', () => {
    expect(modes.frame).toBe('orden')
    expect(root.dataset.frame).toBe('orden')
  })

  test('is remembered, and said on the root for the shell to read', async () => {
    modes.setFrame('system')
    expect(modes.frame).toBe('system')
    expect(root.dataset.frame).toBe('system')

    const again = await restarted()
    expect(again.frame).toBe('system')
    expect(root.dataset.frame).toBe('system')
  })

  test('and a word nobody wrote leaves it alone', async () => {
    modes.setFrame('nonsense')
    expect(modes.frame).toBe('orden')

    localStorage.setItem('orden:modes', JSON.stringify({ frame: 'nonsense' }))
    expect((await restarted()).frame).toBe('orden')
  })

  test('kept under the old name is Orden’s own still', async () => {
    modes.setFrame('system')
    localStorage.setItem('orden:modes', JSON.stringify({ frame: 'nib' }))
    expect((await restarted()).frame).toBe('orden')
  })
})

describe('translucency, which the glass theme is now', () => {
  const saved = () =>
    JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>

  async function restartedAsking() {
    vi.resetModules()
    const { theme } = await import('./theme.svelte')
    const adopt = vi.spyOn(theme, 'adoptTranslucency').mockImplementation(() => undefined)
    ;(await import('./modes.svelte')).modes.restore()
    return adopt
  }

  test('is not a mode any more', () => {
    expect('translucent' in modes).toBe(false)
  })

  test('a reader who had it on is handed to the theme, and the switch is written away', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ translucent: true }))
    const adopt = await restartedAsking()

    expect(adopt).toHaveBeenCalledOnce()
    expect(saved()).not.toHaveProperty('translucent')
    expect(await restartedAsking()).not.toHaveBeenCalled()
  })

  test('and one who had it off is left alone', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ translucent: false }))

    expect(await restartedAsking()).not.toHaveBeenCalled()
    expect(saved()).not.toHaveProperty('translucent')
  })
})

describe('the front matter', () => {
  const saved = () =>
    JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>

  test('is no setting at all: what older builds wrote down about it is dropped', async () => {
    for (const old of [
      { frontMatterDrawn: 'hidden', vim: true },
      { frontMatter: 'source', vim: true },
      { properties: 'properties', vim: true },
    ]) {
      localStorage.setItem('orden:modes', JSON.stringify(old))
      const back = await restarted()
      expect(back.vim).toBe(true)
      expect('properties' in back).toBe(false)
      for (const key of ['frontMatterDrawn', 'frontMatter', 'properties']) {
        expect(saved()).not.toHaveProperty(key)
      }
    }
  })
})

describe('the faces to read in', () => {
  test('are the app’s own until one is chosen', () => {
    expect(modes.fonts).toEqual({ ui: '', content: '', mono: '' })
  })

  test('go in front of the stack each is for, and come away with nothing', () => {
    modes.setFont('content', 'Literata')
    expect(styled.get('--font-content-chosen')).toBe('"Literata",')
    modes.setFont('content', '')
    expect(styled.get('--font-content-chosen')).toBe('')
  })

  test('are remembered across a restart, each in its own place', async () => {
    modes.setFont('mono', 'JetBrains Mono')
    modes.setFont('ui', 'Inter')
    const again = await restarted()
    expect(again.fonts).toEqual({ ui: 'Inter', content: '', mono: 'JetBrains Mono' })
    expect(styled.get('--font-mono-chosen')).toBe('"JetBrains Mono",')
  })

  test('are names and nothing a stylesheet would read as its own', () => {
    expect(familyName('  Noto   Sans  ')).toBe('Noto Sans')
    expect(familyName('Source Code Pro')).toBe('Source Code Pro')
    expect(familyName('思源黑体')).toBe('思源黑体')
    for (const bad of ['', 'a"; } body { color: red', "Fira'", 'x;y', '\\66 oo', 4, null]) {
      expect(familyName(bad)).toBe('')
    }
  })
})

describe('the interface zoom', () => {
  test('is worn once the crate has kept it', async () => {
    crate.refuses = false
    await modes.setInterfaceZoom(1.25)
    expect(crate.asked.at(-1)).toBe(1.25)
    expect(modes.interfaceZoom).toBe(1.25)
  })

  test('a write the crate refused changes nothing, and is no unhandled rejection', async () => {
    crate.refuses = false
    await modes.setInterfaceZoom(1.1)
    crate.refuses = true
    await expect(modes.setInterfaceZoom(1.5)).resolves.toBeUndefined()
    expect(modes.interfaceZoom).toBe(1.1)
    crate.refuses = false
  })
})

describe('a step from wherever a slider left it', () => {
  test('goes the way it was asked, to the next step that way', () => {
    modes.setWidth(55)
    modes.stepWidth(1)
    expect(modes.width).toBe(60)
    modes.setWidth(55)
    modes.stepWidth(-1)
    expect(modes.width).toBe(50)

    modes.setLineSpacing(1.9)
    modes.stepLineHeight(1)
    expect(modes.lineHeight).toBe(2)
    modes.setLineSpacing(1.9)
    modes.stepLineHeight(-1)
    expect(modes.lineHeight).toBe(1.85)
  })

  test('and stays put past the last step rather than coming back', () => {
    modes.setWidth(30)
    modes.stepWidth(-1)
    expect(modes.width).toBe(30)
    modes.setLineSpacing(2.2)
    modes.stepLineHeight(1)
    expect(modes.lineHeight).toBe(2.2)
  })

  test('and from a step itself, is the next one as before', () => {
    modes.setWidth(42)
    modes.stepWidth(1)
    expect(modes.width).toBe(50)
    modes.stepWidth(1)
    modes.stepWidth(1)
    modes.stepWidth(1)
    expect(modes.width).toBe(80)
    modes.resetZoom()
    modes.stepZoom(1)
    expect(modes.zoom).toBe(1.1)
    modes.stepZoom(-1)
    modes.stepZoom(-1)
    expect(modes.zoom).toBe(0.9)
    modes.resetZoom()
  })
})
