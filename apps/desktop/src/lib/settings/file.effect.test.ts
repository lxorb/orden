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
vi.mock('../notify', () => ({
  notify: (title: string, body: string) => notices.push({ title, body }),
}))

const { declaredPanes, preferences } = await import('../preferences')
const { declared } = await import('./file.svelte')
const { modes } = await import('../modes.svelte')
const { dns } = await import('./dns.svelte')

const PATH = '/home/emil/.config/ch.emilvinu.nib/settings.json'

async function launch(text: string | null) {
  file = text === null ? null : { path: PATH, text }
  notices.length = 0
  await declared.load(async () => {
    await dns.ask()
    return declaredPanes()
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
    await declared.load(() => Promise.resolve(declaredPanes()))
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
    expect(declared.problems).toEqual(['general.terminalTextSize is not a setting Orden knows'])
    await launch(JSON.stringify({ general: { terminalTextSize: 15, developerMode: true } }))
    expect(declared.problems).toEqual([])
    expect(declared.held.has('general.terminalTextSize')).toBe(true)
  })
})
