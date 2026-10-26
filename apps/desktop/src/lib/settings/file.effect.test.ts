import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The settings file (#673): what it names is put in force at launch and held there,
 *  and a file that is wrong says so without taking anything else down. In the jsdom
 *  project because what it sets reaches the page: the text size is a style on it. */

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', language: 'en' })

/** What the settings folder holds: a file, none, or one that cannot be read. */
let file: { path: string; text: string } | null | Error = null
const notices: { title: string; body: string }[] = []

vi.mock('../tauri', async (actual) => ({
  ...(await actual<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string) => {
    if (command === 'read_settings_file')
      return file instanceof Error ? Promise.reject(file) : Promise.resolve(file)
    if (command === 'dns_chosen') return Promise.resolve({ choice: 'automatic', custom: '' })
    return new Promise(() => undefined)
  },
}))
/** What the account says its settings are, when asked. */
let account: Record<string, unknown> = {}
vi.mock('../api', async (actual) => ({
  ...(await actual<typeof import('../api')>()),
  api: new Proxy(
    {},
    {
      get: (_api, route) =>
        route === 'settings'
          ? () => Promise.resolve({ settings: account, key: null })
          : () => Promise.resolve({}),
    },
  ),
}))
vi.mock('../notify', () => ({
  notify: (title: string, body: string) => notices.push({ title, body }),
}))

const { preferences } = await import('../preferences')
const { declarations } = await import('./declarations')
const { declared } = await import('./declared.svelte')
const { load } = await import('./file')
const { modes } = await import('../modes.svelte')
const { dns } = await import('./dns.svelte')
const { theme } = await import('../theme.svelte')
const { shortcuts } = await import('../shortcuts.svelte')
const { BY_ID } = await import('../shortcuts/registry')

const PATH = '/home/emil/.config/ch.emilvinu.nib/settings.json'

async function launch(text: string | null) {
  file = text === null ? null : { path: PATH, text }
  notices.length = 0
  await load(async () => {
    await dns.ask()
    return declarations()
  })
  declared.tell(() => undefined)
}

function row(key: string) {
  const found = preferences()
    .flatMap((pane) => pane.groups.flatMap((group) => group.fields))
    .find((one) => one.key === key)
  if (!found) throw new Error(`no ${key}`)
  return found
}

beforeEach(() => {
  held.clear()
})

describe('a settings file', () => {
  test('puts what it names in force, nested by pane or written out', async () => {
    await launch(
      JSON.stringify({
        editor: { textSize: 1.25, focusMode: !modes.focus },
        'markdown.strictCommonMark': true,
        general: { dns: 'quad9' },
      }),
    )
    expect(declared.problems).toEqual([])
    expect(modes.zoom).toBe(1.25)
    expect(modes.strict).toBe(true)
    expect(dns.choice).toBe('quad9')
    expect([...declared.held].sort()).toEqual([
      'editor.focusMode',
      'editor.textSize',
      'general.dns',
      'markdown.strictCommonMark',
    ])
    expect(notices).toEqual([])
  })

  test('holds each row it sets: it says so, and a press does nothing', async () => {
    await launch(JSON.stringify({ editor: { textSize: 1.1, typewriterMode: true } }))
    const size = row('editor.textSize')
    expect(size.declared).toBe(PATH)
    if (size.kind !== 'slider') throw new Error('not a slider')
    size.set(1.5)
    expect(modes.zoom).toBe(1.1)

    const typewriter = row('editor.typewriterMode')
    if (typewriter.kind !== 'switch') throw new Error('not a switch')
    expect(typewriter.locked?.()).toBe(true)
    typewriter.set(false)
    expect(modes.typewriter).toBe(true)

    // A row it does not name is the reader's, as ever.
    const spacing = row('editor.lineSpacing')
    expect(spacing.declared).toBeUndefined()
  })

  test('changed and started again, the app follows it', async () => {
    await launch(JSON.stringify({ editor: { textSize: 1.1 } }))
    expect(modes.zoom).toBe(1.1)
    await launch(JSON.stringify({ editor: { textSize: 0.9 } }))
    expect(modes.zoom).toBe(0.9)
    // And a setting taken out of it is the reader's again.
    await launch(JSON.stringify({}))
    expect(row('editor.textSize').declared).toBeUndefined()
  })

  test('that is not JSON says so, with where it is, and holds nothing', async () => {
    await launch('{ "editor": { "textSize": 1.1, }')
    expect(declared.problems).toHaveLength(1)
    expect(declared.problems[0]).toContain(`${PATH} is not valid JSON`)
    expect(declared.held.size).toBe(0)
    expect(notices).toEqual([
      { title: 'The settings file has a problem', body: declared.problems[0] },
    ])
  })

  test('says each setting it names wrongly, and still applies the rest', async () => {
    await launch(
      JSON.stringify({
        editor: { textSize: 9, ligatures: 'sometimes', focusMode: 'yes', lineWidth: 50 },
        nonsense: { here: 1 },
      }),
    )
    expect(declared.problems).toEqual([
      'editor.textSize should be at most 1.6',
      'editor.ligatures should be one of "off", "code", "all"',
      'editor.focusMode should be a boolean',
      'nonsense.here is not a setting Orden knows',
    ])
    expect(modes.width).toBe(50)
    expect([...declared.held]).toEqual(['editor.lineWidth'])
    expect(notices).toHaveLength(1)
  })

  test('that is a list rather than settings says so', async () => {
    await launch('[1, 2]')
    expect(declared.problems).toEqual([
      `${PATH} is not valid JSON: it should be a JSON object of settings`,
    ])
  })

  test('that cannot be read says why, and none at all is nothing to say', async () => {
    file = new Error(`could not read ${PATH}: Permission denied`)
    notices.length = 0
    await load(() => declarations())
    expect(declared.problems).toEqual([`could not read ${PATH}: Permission denied`])

    await launch(null)
    expect(declared.problems).toEqual([])
    expect(declared.path).toBeNull()
    expect(notices).toEqual([])
  })

  test('finds a row that is there only once another is', async () => {
    // The terminal's rows are Developer mode's.
    modes.setDeveloper(false)
    await launch(JSON.stringify({ general: { terminalTextSize: 15 } }))
    expect(declared.problems).toEqual([
      'general.terminalTextSize is not a setting here now: what it depends on is off',
    ])
    await launch(JSON.stringify({ general: { terminalTextSize: 15, developerMode: true } }))
    expect(declared.problems).toEqual([])
    expect(declared.held.has('general.terminalTextSize')).toBe(true)
  })
})

describe('what the settings file holds', () => {
  test('stays as it says when its key is pressed, as when its row is', async () => {
    await launch(JSON.stringify({ editor: { focusMode: true } }))
    expect(modes.focus).toBe(true)
    // F8: the command the keyboard, the palette and the View menu all run.
    BY_ID.get('app.focus')?.run?.({ view: undefined } as never)
    expect(modes.focus).toBe(true)
    modes.toggleFocus()
    expect(modes.focus).toBe(true)
    // And a setting the file does not name is the keyboard's as ever.
    const typewriter = modes.typewriter
    BY_ID.get('app.typewriter')?.run?.({ view: undefined } as never)
    expect(modes.typewriter).toBe(!typewriter)
  })

  test('stays as it says when another device says otherwise', async () => {
    await launch(JSON.stringify({ markdown: { newlineBreaks: false, frontMatter: 'source' } }))
    account = { hardBreaks: true, properties: 'table', canvasTurns: !modes.canvasTurns }
    const turns = modes.canvasTurns
    await modes.adopt('token')
    expect(modes.hardBreaks).toBe(false)
    expect(modes.properties).toBe('source')
    // What the file does not name is the account's.
    expect(modes.canvasTurns).toBe(!turns)
  })

  test('holds a part of what a store keeps, and leaves the rest to it', async () => {
    await launch(JSON.stringify({ appearance: { monoFont: 'JetBrains Mono' } }))
    expect(modes.fonts.mono).toBe('JetBrains Mono')
    modes.setFont('mono', 'Fira Code')
    modes.setFont('ui', 'Inter')
    expect(modes.fonts.mono).toBe('JetBrains Mono')
    expect(modes.fonts.ui).toBe('Inter')
  })

  test('sets a list whole: the languages spelling is checked in', async () => {
    await launch(JSON.stringify({ spelling: { languages: ['de-DE', 'fr-FR'] } }))
    expect(declared.problems).toEqual([])
    expect([...modes.spellLanguages].sort()).toEqual(['de-DE', 'fr-FR'])
    modes.setSpellLanguages(['en-US'])
    expect([...modes.spellLanguages].sort()).toEqual(['de-DE', 'fr-FR'])
    await launch(JSON.stringify({ spelling: { languages: ['xx-XX'] } }))
    expect(declared.problems[0]).toContain('spelling.languages has "xx-XX"')
  })

  test('sets a theme it does not wear, and a command’s key', async () => {
    await launch(
      JSON.stringify({
        themes: { wallpaper: { blur: 12 } },
        shortcuts: { 'app-focus': 'Mod-Alt-f', vim: true },
      }),
    )
    expect(declared.problems).toEqual([])
    expect(theme.keptFor('wallpaper', 'blur')).toBe(12)
    expect(shortcuts.keyFor('app.focus')).toBe('Mod-Alt-f')
    shortcuts.set('app.focus', 'F9')
    expect(shortcuts.keyFor('app.focus')).toBe('Mod-Alt-f')
    expect(modes.vim).toBe(true)
  })

  test('passes over another platform’s setting without a word, and refuses a key that is none', async () => {
    await launch(
      JSON.stringify({ themes: { glass: { material: 'mica' } }, shortcuts: { 'app-focus': 'k' } }),
    )
    expect(declared.problems).toHaveLength(1)
    expect(declared.problems[0]).toMatch(/^shortcuts\.app-focus /)
  })
})
