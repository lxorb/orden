import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@orden/editor'
import { familyName, KEEP_MONTH, KEEP_YEAR, rollbackSteps } from './modes.svelte'
import { memoryStorage } from '../../../../test/disk'

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
vi.mock('../../platform/src/tauri', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../platform/src/tauri')>()
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
  attachments?: string
  vim?: boolean
  mobileSeen?: boolean
  quietMarks?: boolean
  silent?: boolean
  undatedInToday?: boolean
  canvasTurns?: boolean
  canvasTurnSnaps?: boolean
}
vi.mock('../../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/client')>()),
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
const answers = { ...api }
function sending(): Held[] {
  const sent: Held[] = []
  api.saveSettings = async (_token, patch) => {
    sent.push(patch)
    return { settings: {} }
  }
  return sent
}
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}
beforeEach(async () => {
  localStorage.clear()
  Object.assign(api, answers)
  told.calls = []
  told.views = []
  modes = await restarted()
})
test.each([
  ['readOnly', false, () => modes.toggleReadOnly(), true],
  ['punctuation', false, () => modes.togglePunctuation(), true],
  ['vim', false, () => modes.toggleVim(), true],
  ['quietMarks', false, () => modes.toggleQuietMarks(), true],
  ['silent', false, () => modes.toggleSilent(), true],
  ['canvasTurns', true, () => modes.setCanvasTurns(false), false],
  ['canvasTurnSnaps', true, () => modes.setCanvasTurnSnaps(false), false],
  ['attachments', 'space', () => modes.setAttachments('named'), 'named'],
] as const)('%s starts as %j and keeps a change across a restart', async (key, start, change, to) => {
  expect(modes[key]).toBe(start)
  change()
  expect(modes[key]).toBe(to)
  expect((await restarted())[key]).toBe(to)
})
describe('read-only mode', () => {
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
describe('the glasses, which are gone (#2358)', () => {
  const GLASSES = [
    'glassesScroll',
    'glassesBreak',
    'glassesLineNumbers',
    'glassesVoice',
    'glassesCompaction',
    'glassesMarks',
    'glassesWords',
    'glassesSeen',
  ]
  const kept = () => Object.keys(JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>)
  test('leave nothing behind, and what older builds wrote down for them is dropped quietly with the rest kept', async () => {
    localStorage.setItem(
      'orden:modes',
      JSON.stringify({
        glassesScroll: 'native',
        glassesBreak: 3,
        glassesLineNumbers: false,
        glassesVoice: true,
        glassesCompaction: 'collapse',
        glassesMarks: { heading: false },
        glassesWords: { next: 'onwards' },
        glassesSeen: true,
        vim: true,
      }),
    )
    const back = await restarted()
    expect(back.vim).toBe(true)
    for (const key of GLASSES) expect(key in back, key).toBe(false)
    expect(kept().filter((key) => GLASSES.includes(key))).toEqual([])
  })
  test('and are not taken from an account that still holds them', async () => {
    Object.assign(api, { settings: async () => ({ settings: { glassesBreak: 5, glassesSeen: true, vim: true } }) })
    await modes.adopt('token')
    expect(modes.vim).toBe(true)
    expect(kept().filter((key) => GLASSES.includes(key))).toEqual([])
  })
})
describe('smart punctuation', () => {
  test('stays off for a reader who never chose', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ focus: true }))
    expect((await restarted()).punctuation).toBe(false)
  })
  test('and stays on for one who turned it on', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ punctuation: true }))
    expect((await restarted()).punctuation).toBe(true)
  })
})
describe('ligatures, which are gone (#2454)', () => {
  test('leave nothing behind, and what older builds wrote down is dropped quietly with the rest kept', async () => {
    for (const ligatures of [true, false, 'code', 'all', 'off', 'sometimes']) {
      localStorage.setItem('orden:modes', JSON.stringify({ ligatures, vim: true }))
      const back = await restarted()
      expect(back.vim).toBe(true)
      expect('ligatures' in back).toBe(false)
      expect(localStorage.getItem('orden:modes')).not.toContain('ligatures')
    }
  })
  test('and are not taken from an account that still holds them', async () => {
    Object.assign(api, { settings: async () => ({ settings: { ligatures: 'all', vim: true } }) })
    await modes.adopt('token')
    expect(modes.vim).toBe(true)
    expect('ligatures' in modes).toBe(false)
    expect(localStorage.getItem('orden:modes')).not.toContain('ligatures')
  })
})
describe('modal editing', () => {
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
      modes.setAttachments('named')
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
describe('turning a canvas with two fingers (#351)', () => {
  test('takes no off from an older build, which wrote it down for everybody', async () => {
    localStorage.setItem('orden:modes', JSON.stringify({ canvasTurns: false, vim: true }))
    const back = await restarted()
    expect(back.canvasTurns).toBe(true)
    expect(back.vim).toBe(true)
    expect(localStorage.getItem('orden:modes')).not.toContain('"canvasTurns"')
  })
})
describe('the tasks with no start date in Today', () => {
  test('are no setting any more: what older builds wrote down is dropped quietly (#2162)', async () => {
    for (const old of [
      { undatedInToday: false, vim: true },
      { undatedToday: true, vim: true },
      { undatedToday: 'yes', vim: true },
    ]) {
      localStorage.setItem('orden:modes', JSON.stringify(old))
      const back = await restarted()
      expect(back.vim).toBe(true)
      expect('undatedInToday' in back).toBe(false)
      expect(localStorage.getItem('orden:modes')).not.toContain('undated')
    }
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
    const { Tab, opening } = await import('../../documents/src/api')
    const note = { kind: 'note' } as unknown as ConstructorParameters<typeof Tab>[0]
    expect(new Tab(note, 'p1').source).toBe(false)
    modes.toggleOpensInSource()
    expect(opening.source).toBe(true)
    expect(new Tab(note, 'p1').source).toBe(true)
    const restored = await restarted()
    const fresh = await import('../../documents/src/api')
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
  test('a change the account was not told of before a restart is sent first, not undone', async () => {
    const sent = sending()
    api.settings = async () => ({ settings: { silent: false } })
    modes.toggleSilent()
    expect(modes.silent).toBe(true)
    modes = await restarted()
    await modes.adopt('token')
    expect(sent).toEqual([expect.objectContaining({ silent: true })])
  })
  test('keeps a change the account never heard across a restart, and sends it before reading', async () => {
    const sent: Held[] = []
    let server: Held = { attachments: 'named' }
    const accounts = await import('../../accounts/src/api')
    accounts.account.token = 'token'
    modes.setAttachments('note')
    const store = await restarted()
    ;(await import('../../accounts/src/api')).account.token = 'token'
    api.saveSettings = async (_token: string, patch: Held) => {
      sent.push(patch)
      server = { ...server, ...patch }
      return { settings: server }
    }
    api.settings = async () => ({ settings: server })
    await store.adopt('token')
    expect(sent).toEqual([{ attachments: 'note' }])
    expect(store.attachments).toBe('note')
    sent.length = 0
    await (await restarted()).adopt('token')
    expect(sent).toEqual([])
  })
  test('keeps what is owed to an account through a launch that does not know the account yet', async () => {
    const sent: Held[] = []
    let server: Held = { vim: false, attachments: 'named' }
    const signedIn = async (id: string | null) => {
      const { account } = await import('../../accounts/src/api')
      account.token = 'token'
      account.user = id === null ? null : ({ id } as typeof account.user)
    }
    await signedIn('u1')
    api.saveSettings = async () => {
      throw new Error('offline')
    }
    modes.setVimKeys(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const store = await restarted()
    await signedIn(null)
    store.setAttachments('note')
    await signedIn('u1')
    api.saveSettings = async (_token: string, patch: Held) => {
      sent.push(patch)
      server = { ...server, ...patch }
      return { settings: server }
    }
    api.settings = async () => ({ settings: server })
    await store.adopt('token')
    expect(sent).toEqual([{ vim: true, attachments: 'note' }])
    expect(store.vim).toBe(true)
    expect(store.attachments).toBe('note')
    const { account } = await import('../../accounts/src/api')
    account.token = null
    account.user = null
  })
  test('keeps a change made while signed out on this device, and takes the account’s at sign-in', async () => {
    const sent: Held[] = []
    const { account } = await import('../../accounts/src/api')
    await account.restore()
    modes.setAttachments('note')
    const store = await restarted()
    api.saveSettings = async (_token: string, patch: Held) => {
      sent.push(patch)
      return { settings: {} }
    }
    api.settings = async () => ({ settings: { attachments: 'named' } })
    await store.adopt('token')
    expect(sent).toEqual([])
    expect(store.attachments).toBe('named')
  })
  test('lets go of a change the account turned down, and hears the account again', async () => {
    const { ApiError } = await import('../../accounts/src/client')
    let server: Held = { vim: false }
    api.saveSettings = async (_token: string, patch: Held) => {
      if (patch.attachments === 'note') throw new ApiError(400, 'refused')
      server = { ...server, ...patch }
      return { settings: server }
    }
    api.settings = async () => ({ settings: server })
    const { account } = await import('../../accounts/src/api')
    account.token = 'token'
    modes.setAttachments('note')
    await modes.adopt('token')
    account.token = null
    server = { ...server, vim: true }
    const store = await restarted()
    await store.adopt('token')
    expect(store.vim).toBe(true)
  })
  test.each([
    [{ quietMarks: true }, 'quietMarks', true],
    [{ silent: true }, 'silent', true],
    [{ canvasTurns: true }, 'canvasTurns', true],
    [{ attachments: 'named' }, 'attachments', 'named'],
    [{ attachments: 'vault' }, 'attachments', 'space'],
    [{ undatedInToday: false, silent: true }, 'silent', true],
  ] as [Held, string, unknown][])('takes %j from the account as %s %j', async (settings, key, value) => {
    api.settings = async () => ({ settings })
    await modes.adopt('token')
    expect((modes as unknown as Record<string, unknown>)[key]).toBe(value)
    expect('undatedInToday' in modes).toBe(false)
  })
  test('deletes the OpenAI key the glasses kept on the account before they asked the default AI account', async () => {
    const removed: string[] = []
    api.settings = async () => ({ settings: {}, key: { set: true, tail: '4f2a' } })
    Object.assign(api, { removeAskKey: async (token: string) => void removed.push(token) })
    await modes.adopt('token')
    expect(removed).toEqual(['token'])
    api.settings = async () => ({ settings: {}, key: { set: false, tail: '' } })
    await modes.adopt('token')
    expect(removed).toEqual(['token'])
  })
  test('says nothing about modal editing unless the account does', async () => {
    for (const settings of [{}, { silent: true }, { attachments: 'note' }] as Held[]) {
      const store = await restarted()
      api.settings = async () => ({ settings })
      await store.adopt('token')
      expect(store.vim, JSON.stringify(settings)).toBe(false)
    }
  })
  test('leaves modal editing off for an account that wrote it down as off', async () => {
    api.settings = async () => ({ settings: { vim: false } })
    await modes.adopt('token')
    expect(modes.vim).toBe(false)
    expect(told.calls).not.toContainEqual({ mode: 'vim', on: true })
  })
  test('brings modal editing another machine turned on', async () => {
    api.settings = async () => ({ settings: { vim: true } })
    modes.apply(surface())
    told.calls = []
    await modes.adopt('token')
    expect(modes.vim).toBe(true)
    expect(told.calls).toContainEqual({ mode: 'vim', on: true })
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
  test('carries up what was decided before the session came back', async () => {
    const patches = sending()
    api.settings = async () => ({ settings: {} })
    modes.toggleSilent()
    expect(modes.silent).toBe(true)
    expect(patches).toEqual([])
    await modes.adopt('token')
    expect(patches).toEqual([{ silent: true }])
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
    modes.toggleSilent()
    expect(await modes.adopt('token')).toBeNull()
    expect(patches).toEqual([{ silent: true }])
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      return { settings: {} }
    }
    api.settings = async () => ({ settings: {} })
    await modes.adopt('token')
    expect(patches).toEqual([{ silent: true }, { silent: true }])
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
    modes.toggleSilent()
    expect(await modes.adopt('first')).toBeNull()
    const { account } = await import('../../accounts/src/account.svelte')
    await account.signOut()
    api.saveSettings = async (token: string, patch: Held) => {
      patches.push([token, patch])
      return { settings: {} }
    }
    api.settings = async () => ({ settings: {} })
    await modes.adopt('second')
    expect(patches).toEqual([['first', { silent: true }]])
  })
  test('takes nothing from an account whose answer comes after it signed out', async () => {
    const { release, settingsCall } = heldAnswer({ vim: true, quietMarks: true })
    api.settings = settingsCall
    const adopted = modes.adopt('first')
    const { account } = await import('../../accounts/src/account.svelte')
    await account.signOut()
    release()
    expect(await adopted).toBeNull()
    expect(modes.vim).toBe(false)
    expect(modes.quietMarks).toBe(false)
  })
  test('a setting the account refuses stays on the device, and holds back none of the rest (#1800)', async () => {
    const { ApiError } = await import('../../accounts/src/api')
    const patches: Held[] = []
    api.saveSettings = async (_token: string, patch: Held) => {
      patches.push(patch)
      if ('hardBreaks' in patch) throw new ApiError(400, 'hardBreaks is refused')
      return { settings: {} }
    }
    api.settings = async () => ({ settings: {} })
    modes.toggleHardBreaks()
    modes.toggleSilent()
    await modes.adopt('token')
    expect(patches.at(-1)).toEqual({ silent: modes.silent })
    expect(modes.hardBreaks).toBe(true)
    patches.length = 0
    modes.setVimKeys(true)
    await modes.adopt('token')
    expect(patches).toEqual([{ vim: true }])
  })
  describe('a phone or a tablet on the account', () => {
    async function adoptedOn(device: 'desktop' | 'phone', account: Held) {
      const patches = sending()
      api.settings = async () => ({ settings: account })
      const { viewport } = await import('../../ui-kit/src/viewport.svelte')
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
      const { viewport } = await import('../../ui-kit/src/viewport.svelte')
      viewport.device = 'phone'
      await modes.adopt('token')
      modes.toggleSilent()
      const patches = sending()
      await modes.adopt('token')
      expect(patches).toEqual([{ silent: modes.silent }, { mobileSeen: true }])
    })
  })
})
describe('where a pasted picture goes', () => {
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
describe('translucency, a switch older builds kept', () => {
  test('is dropped quietly whichever way it was, and the theme stays as it was (#2162)', async () => {
    for (const translucent of [true, false]) {
      localStorage.setItem('orden:modes', JSON.stringify({ translucent, vim: true }))
      const back = await restarted()
      expect(back.vim).toBe(true)
      expect('translucent' in back).toBe(false)
      expect(localStorage.getItem('orden:modes')).not.toContain('translucent')
      expect(localStorage.getItem('orden:theme')).not.toBe('glass')
    }
  })
})
describe('the front matter', () => {
  const saved = () => JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>
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
describe('another account in the same window (#2344)', () => {
  async function accounts(server: Record<string, Record<string, unknown>>) {
    const { account } = await import('../../accounts/src/account.svelte')
    const line = { offline: false }
    Object.assign(api, {
      saveSettings: async (token: string, patch: Record<string, unknown>) => {
        if (line.offline) throw new Error('offline')
        server[token] = { ...server[token], ...patch }
        return { settings: server[token] }
      },
      settings: async (token: string) => {
        if (line.offline) throw new Error('offline')
        return { settings: server[token] ?? {} }
      },
      signOut: async () => undefined,
    })
    const signedIn = async (who: string) => {
      await account.signOut()
      account.token = who
      account.user = { id: who } as typeof account.user
      return modes.adopt(who)
    }
    const done = () => {
      account.token = null
      account.user = null
    }
    return { line, signedIn, done }
  }
  test('shows its own settings or the defaults and none of the last account’s, and the same account again keeps its own', async () => {
    const server: Record<string, Record<string, unknown>> = { alice: {}, bob: { silent: true } }
    const { line, signedIn, done } = await accounts(server)
    const saved = () => JSON.parse(localStorage.getItem('orden:modes') ?? '{}') as Record<string, unknown>
    modes.apply(surface())
    await signedIn('alice')
    modes.setVimKeys(true)
    modes.setAttachments('named')
    await modes.adopt('alice')
    expect(server.alice).toMatchObject({ vim: true, attachments: 'named' })
    told.calls = []
    await signedIn('bob')
    expect(modes.vim).toBe(false)
    expect(modes.attachments).toBe('space')
    expect(modes.silent).toBe(true)
    expect(told.calls).toContainEqual({ mode: 'vim', on: false })
    expect(saved()).toMatchObject({ vim: false, attachments: 'space', silent: true })
    modes.setVimKeys(true)
    await modes.adopt('bob')
    line.offline = true
    await signedIn('bob')
    expect(modes.vim).toBe(true)
    expect(modes.silent).toBe(true)
    line.offline = false
    await signedIn('alice')
    expect(modes.vim).toBe(true)
    expect(modes.attachments).toBe('named')
    expect(modes.silent).toBe(false)
    done()
  })
  test('what an account still owes from this device comes back with it and reaches it as it was, not as the next account left it', async () => {
    const server: Record<string, Record<string, unknown>> = {}
    const { line, signedIn, done } = await accounts(server)
    await signedIn('alice')
    line.offline = true
    modes.toggleHardBreaks()
    modes.toggleSilent()
    await new Promise((resolve) => setTimeout(resolve, 0))
    line.offline = false
    await signedIn('bob')
    expect(modes.hardBreaks).toBe(false)
    expect(modes.silent).toBe(false)
    modes.setCanvasTurns(false)
    await modes.adopt('bob')
    expect(server.bob).toMatchObject({ canvasTurns: false })
    line.offline = true
    await signedIn('alice')
    expect(modes.hardBreaks).toBe(true)
    expect(modes.silent).toBe(true)
    line.offline = false
    await modes.adopt('alice')
    expect(server.alice).toEqual({ hardBreaks: true, silent: true })
    expect(modes.hardBreaks).toBe(true)
    expect(modes.silent).toBe(true)
    done()
  })
})
