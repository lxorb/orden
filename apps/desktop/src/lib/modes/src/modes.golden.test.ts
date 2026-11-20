import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {} as Record<string, string>,
    toggleAttribute: () => true,
  },
})
const api = vi.hoisted(() => {
  const held: { answer: Record<string, unknown> } = { answer: {} }
  return {
    held,
    settings: async () => ({ settings: held.answer }),
    saveSettings: async () => ({ settings: {} }),
  }
})
vi.mock('../../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/client')>()),
  api,
}))
const KEY = 'orden:modes'
await import('./modes.svelte')
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}
function everything(): Record<string, string> {
  const out: Record<string, string> = {}
  const keys: string[] = []
  for (let at = 0; at < localStorage.length; at++) keys.push(localStorage.key(at) ?? '')
  for (const key of keys.sort()) out[key] = localStorage.getItem(key) ?? ''
  return out
}
function held(store: Awaited<ReturnType<typeof restarted>>): string | null {
  store.toggleSilent()
  store.toggleSilent()
  return localStorage.getItem(KEY)
}
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
  spellLanguages: ['de-DE', 'fr-FR'],
  alwaysOnTop: true,
  closeBrackets: false,
  ligatures: 'code',
  mobileSeen: true,
  vim: true,
  attachments: 'note',
  pagesPaper: 'letter',
  frame: 'system',
  hand: true,
  fonts: { ui: 'Inter', content: 'Literata', mono: 'JetBrains Mono' },
  conflicts: 'theirs',
  keepVersions: 365,
  remindBefore: 15,
  turnsCanvas: false,
  canvasTurnSnaps: false,
  highlightTone: 3,
  hardBreaks: true,
  linkFormat: 'markdown',
}
beforeEach(() => {
  localStorage.clear()
  api.held.answer = {}
})
describe('what orden:modes holds', () => {
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
    'front matter hidden before the strip': { frontMatter: 'hidden' },
    'the translucency switch': { translucent: true },
    'translucency turned off': { translucent: false },
    'a canvas turning switch from before it was on': { canvasTurns: false },
    'every stale key at once': {
      reading: true,
      properties: 'source',
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
      attachments: 'desk',
      pagesPaper: 'a9',
      frame: 'mine',
      conflicts: 'coin',
      keepVersions: 7,
      remindBefore: 3,
      undatedInToday: 'on',
      canvasTurns: 'on',
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
      undatedInToday: false,
      canvasTurns: false,
      canvasTurnSnaps: false,
      highlightTone: 2,
      quietMarks: true,
      silent: true,
      hardBreaks: true,
      properties: 'source',
      linkFormat: 'markdown',
      spellWords: ['Orden', 'not a word!', 'Tauri'],
    },
    'values no version wrote': {
      ligatures: 'some',
      vim: 'yes',
      attachments: 'desk',
      conflicts: 'coin',
      keepVersions: 7,
      remindBefore: 3,
      undatedInToday: 'yes',
      canvasTurns: 'yes',
      canvasTurnSnaps: 'yes',
      highlightTone: 'red',
      quietMarks: 1,
      silent: 'no',
      hardBreaks: null,
      properties: 5,
      linkFormat: 'bbcode',
      spellWords: 'Orden',
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
