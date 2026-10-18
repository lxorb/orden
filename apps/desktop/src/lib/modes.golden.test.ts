import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What `nib:modes` holds, byte for byte, and what the store makes of what an older build
 *  or the account wrote: held still while the store's defaults and readers are moved
 *  about, so a move that changes a stored byte, a key's place in the entry, a migration
 *  or the moment one is written back is a failure here and not a reader's lost setting.
 *
 *  Snapshots rather than expectations written out, because the point is that nothing
 *  moves: every figure below is what the store did before anything was moved. */

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
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {} as Record<string, string>,
    toggleAttribute: () => true,
  },
})

/** The account, answering whatever a test hands it. */
const api = vi.hoisted(() => {
  const held: { answer: Record<string, unknown> } = { answer: {} }

  return {
    held,
    settings: async () => ({ settings: held.answer }),
    saveSettings: async () => ({ settings: {} }),
  }
})

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api,
}))

const KEY = 'nib:modes'

await import('./modes.svelte')

/** A fresh start of the app over whatever storage holds now. */
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}

/** Everything storage holds, in key order. */
function everything(): Record<string, string> {
  const out: Record<string, string> = {}
  const keys: string[] = []
  for (let at = 0; at < localStorage.length; at++) keys.push(localStorage.key(at) ?? '')
  for (const key of keys.sort()) out[key] = localStorage.getItem(key) ?? ''
  return out
}

/** What the store holds, as the entry it writes: a setting turned and turned back is a
 *  write of every field with nothing changed. */
function held(store: Awaited<ReturnType<typeof restarted>>): string | null {
  store.toggleSilent()
  store.toggleSilent()
  return localStorage.getItem(KEY)
}

/** Every field away from its default, in the order the store writes them. */
const AWAY = {
  source: true,
  readOnly: true,
  focus: true,
  quietMarks: true,
  silent: true,
  typewriter: true,
  punctuation: true,
  numbers: true,
  lineNumbers: true,
  codeTheme: 'dracula',
  rtl: true,
  strict: true,
  equationNumbers: true,
  zoom: 1.25,
  width: 60,
  lineHeight: 2,
  spellcheck: false,
  spellLanguage: 'de',
  spellWords: ['Orden', 'Tauri'],
  alwaysOnTop: true,
  closeBrackets: false,
  ligatures: 'code',
  glassesBreak: 4,
  glassesLineNumbers: false,
  glassesVoice: true,
  glassesCompaction: 'aggressive',
  glassesMarks: {
    heading: false,
    bold: false,
    italic: true,
    strike: true,
    highlight: true,
    code: false,
    fence: true,
    link: true,
  },
  glassesWords: { next: 'onwards' },
  glassesSeen: true,
  glassesModel: 'gpt-4o-mini',
  glassesEffort: 'high',
  vim: true,
  attachments: 'note',
  pagesPaper: 'letter',
  frame: 'system',
  hand: true,
  conflicts: 'theirs',
  keepVersions: 365,
  remindBefore: 15,
  undatedInToday: true,
  highlightTone: 3,
  hardBreaks: true,
  frontMatter: 'source',
  linkFormat: 'markdown',
}

beforeEach(() => {
  localStorage.clear()
  api.held.answer = {}
})

describe('what nib:modes holds', () => {
  test('a start with nothing written writes nothing', async () => {
    await restarted()
    expect(everything()).toEqual({})
  })

  test('the entry a store that was never changed writes, byte for byte', async () => {
    expect(held(await restarted())).toMatchSnapshot()
  })

  test('an entry with every field away from its default comes back as it was', async () => {
    const written = JSON.stringify(AWAY)
    localStorage.setItem(KEY, written)
    const store = await restarted()

    expect(localStorage.getItem(KEY)).toBe(written)
    expect(held(store)).toMatchSnapshot()
  })
})

describe('what an older build wrote', () => {
  const OLD: Record<string, Record<string, unknown>> = {
    'the reading switch, read as the lock': { reading: true },
    'the properties row shown': { properties: 'source' },
    'the properties row said as anything else': { properties: 'rows' },
    'front matter beside properties': { frontMatter: 'source', properties: 'hidden' },
    'a scroll mode for the glasses': { glassesScroll: 'native', glassesBreak: 3 },
    'the translucency switch': { translucent: true },
    'translucency turned off': { translucent: false },
    'every stale key at once': {
      reading: true,
      properties: 'source',
      glassesScroll: 'paged',
      translucent: true,
    },
    'values no version wrote': {
      source: 'yes',
      width: 0,
      zoom: 'big',
      lineHeight: null,
      codeTheme: 5,
      spellcheck: 'no',
      spellLanguage: 7,
      spellWords: ['Orden', 3],
      closeBrackets: 0,
      ligatures: 'some',
      glassesBreak: 9,
      glassesLineNumbers: 'off',
      glassesCompaction: 'tight',
      glassesMarks: { bold: true, italic: 'yes', unheard: true },
      glassesWords: { next: '   ', back: 'x'.repeat(61), close: ' shut ' },
      glassesEffort: 'max',
      attachments: 'desk',
      pagesPaper: 'a9',
      frame: 'mine',
      conflicts: 'coin',
      keepVersions: 7,
      remindBefore: 3,
      undatedInToday: 'on',
      highlightTone: 'red',
      linkFormat: 'bbcode',
    },
    'an older ligature switch, on': { ligatures: true },
    'an older ligature switch, off': { ligatures: false },
    'spelling words past what is kept': {
      spellWords: [...Array.from({ length: 1200 }, (_, at) => `word${at}`), 'not a word!'],
    },
    'a tone that is no colour': { highlightTone: null },
    'a lone frame': { frame: 'system' },
    'not an object at all': [1, 2] as unknown as Record<string, unknown>,
  }

  for (const [name, entry] of Object.entries(OLD)) {
    test(name, async () => {
      localStorage.setItem(KEY, JSON.stringify(entry))
      const store = await restarted()

      // What the start itself wrote back, and only then what the store holds.
      expect({ written: everything(), holds: held(store) }).toMatchSnapshot()
    })
  }

  test('nonsense under the key', async () => {
    localStorage.setItem(KEY, '{"source": tr')
    const store = await restarted()
    expect({ written: everything(), holds: held(store) }).toMatchSnapshot()
  })
})

describe('what the account holds', () => {
  const ANSWERS: Record<string, Record<string, unknown>> = {
    'every setting the account carries, away from its default': {
      ligatures: 'all',
      vim: true,
      attachments: 'named',
      conflicts: 'theirs',
      keepVersions: 365,
      remindBefore: 60,
      undatedInToday: true,
      highlightTone: 2,
      quietMarks: true,
      silent: true,
      hardBreaks: true,
      properties: 'source',
      linkFormat: 'markdown',
      spellWords: ['Orden', 'not a word!', 'Tauri'],
      glassesBreak: 5,
      glassesLineNumbers: false,
      glassesVoice: true,
      glassesCompaction: 'collapse',
      glassesMarks: { heading: false, link: true },
      glassesWords: { next: 'onwards' },
      glassesSeen: true,
      glassesModel: 'gpt-4o',
      glassesEffort: 'medium',
    },
    'values no version wrote': {
      ligatures: 'some',
      vim: 'yes',
      attachments: 'desk',
      conflicts: 'coin',
      keepVersions: 7,
      remindBefore: 3,
      undatedInToday: 'yes',
      highlightTone: 'red',
      quietMarks: 1,
      silent: 'no',
      hardBreaks: null,
      properties: 5,
      linkFormat: 'bbcode',
      spellWords: 'Orden',
      glassesBreak: 'deep',
      glassesLineNumbers: 'off',
      glassesVoice: 0,
      glassesCompaction: 'tight',
      glassesMarks: 'all',
      glassesWords: ['next'],
      glassesSeen: false,
      glassesModel: 4,
      glassesEffort: 'max',
    },
    'an older ligature switch': { ligatures: true },
    'a properties mode said as anything else': { properties: 'rows' },
    'a tone that is no colour': { highlightTone: null },
    'nothing at all': {},
  }

  for (const [name, answer] of Object.entries(ANSWERS)) {
    test(name, async () => {
      localStorage.setItem(KEY, JSON.stringify(AWAY))
      const store = await restarted()
      api.held.answer = answer

      await store.adopt('token')
      expect({ written: everything(), holds: held(store) }).toMatchSnapshot()
    })

    test(`${name}, over a machine that never chose`, async () => {
      const store = await restarted()
      api.held.answer = answer

      await store.adopt('token')
      expect({ written: everything(), holds: held(store) }).toMatchSnapshot()
    })
  }
})
