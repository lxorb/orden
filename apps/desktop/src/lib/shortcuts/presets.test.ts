import { beforeAll, describe, expect, test, vi } from 'vitest'
import { defaultKeyFor } from '@orden/editor'
import { parseCombination, type Platform, sameCombination } from '../keys'

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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

let registry: typeof import('./registry')
let presets: typeof import('./presets')
let names: typeof import('./preset-ids')

beforeAll(async () => {
  registry = await import('./registry')
  presets = await import('./presets')
  names = await import('./preset-ids')
}, 240_000)

const PLATFORMS: Platform[] = ['mac', 'win', 'linux']

function keyUnder(keys: Record<string, string | null>, id: string, platform: Platform) {
  const chosen = keys[id]
  if (chosen !== undefined) return chosen

  const entry = registry.BY_ID.get(id)
  return entry ? defaultKeyFor(entry, platform) : null
}

describe('every keyboard there is', () => {
  test('has a name of its own and one entry per name', () => {
    const ids = presets.PRESETS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('default')
    expect(ids).toContain('vim')
  })

  test('is every name the launch knows, in the same order', () => {
    expect(presets.PRESETS.map((one) => one.id)).toEqual([...names.PRESET_IDS])
  })

  test('leaves the default map alone, which is what Default means', () => {
    expect(presets.presetById('default')?.keys).toEqual({})
  })

  test('is modal editing only where it says so', () => {
    expect(presets.presetById('vim')?.vim).toBe(true)
    expect(presets.presetById('obsidian')?.vim).toBe(false)
    expect(presets.presetById('notion')?.vim).toBe(false)
    expect(presets.presetById('vscode')?.vim).toBe(false)
  })
})

describe.each(['default', 'notion', 'obsidian', 'vscode', 'vim'])('the %s keyboard', (id) => {
  const keysOf = () => presets.presetById(id)?.keys ?? {}

  test('names only shortcuts the app has', () => {
    const unknown = Object.keys(keysOf()).filter((one) => !registry.BY_ID.has(one))
    expect(unknown).toEqual([])
  })

  test('never touches a key that cannot be changed', () => {
    const fixed = Object.keys(keysOf()).filter((one) => registry.BY_ID.get(one)?.scope === 'fixed')
    expect(fixed).toEqual([])
  })

  test('writes every key the way the app writes them', () => {
    const wrong: string[] = []

    for (const [one, key] of Object.entries(keysOf())) {
      if (key === null) continue

      const combination = parseCombination(key, 'win')
      if (!combination) wrong.push(`${one}: ${key} is not a combination`)
      else if (
        !combination.ctrl &&
        !combination.meta &&
        !combination.alt &&
        combination.key.length === 1
      ) {
        wrong.push(`${one}: ${key} would fire while typing`)
      }
    }

    expect(wrong).toEqual([])
  })

  test.each(PLATFORMS)('writes no chord twice (%s)', (platform) => {
    const written = Object.entries(keysOf()).filter(
      (pair): pair is [string, string] => pair[1] !== null,
    )
    const twice: string[] = []

    written.forEach(([one, key], index) => {
      for (const [other, held] of written.slice(index + 1)) {
        if (sameCombination(key, held, platform)) twice.push(`${one} and ${other} on ${key}`)
      }
    })

    expect(twice).toEqual([])
  })

  test.each(PLATFORMS)('leaves nothing on a key something else is on (%s)', (platform) => {
    const keys = keysOf()
    const held = new Map<string, string>()
    const clashes: string[] = []

    for (const entry of registry.SHORTCUTS) {
      if (entry.contextual || entry.scope === 'fixed') continue

      const key = keyUnder(keys, entry.id, platform)
      if (!key) continue

      for (const [taken, by] of held) {
        if (sameCombination(taken, key, platform)) {
          clashes.push(`${entry.id} and ${by} are both on ${key}`)
        }
      }
      held.set(key, entry.id)
    }

    expect(clashes).toEqual([])
  })

  test.each(PLATFORMS)('leaves the plane and the file list their own keys (%s)', (platform) => {
    const keys = keysOf()
    const clashes: string[] = []

    const surfaces = registry.SHORTCUTS.filter(
      (one) =>
        one.contextual &&
        one.scope === 'panel' &&
        !one.id.startsWith('web.') &&
        !one.id.startsWith('ai.') &&
        !one.id.startsWith('tasks.') &&
        !one.id.startsWith('explorer.') &&
        !one.id.startsWith('pass.'),
    )
    const app = registry.SHORTCUTS.filter((one) => !one.contextual && one.scope === 'app')
    const shared = new Set(['canvas.duplicate app.deselect-tab'])

    for (const entry of surfaces) {
      const key = keyUnder(keys, entry.id, platform)
      if (!key) continue

      for (const other of app) {
        const held = keyUnder(keys, other.id, platform)
        if (shared.has(`${entry.id} ${other.id}`)) continue
        if (held && sameCombination(held, key, platform)) {
          clashes.push(`${entry.id} and ${other.id} are both on ${key}`)
        }
      }
    }

    expect(clashes).toEqual([])
  })
})

describe.each(['default', 'notion', 'obsidian', 'vscode', 'vim'])('the %s keyboard', (id) => {
  test('opens the commands on Ctrl+Shift+P, and leaves Paragraph no key', () => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.commands', platform), platform).toBe('Mod-Shift-p')
      expect(keyUnder(keys, 'paragraph.body', platform), platform).toBeNull()
    }
  })

  test('asks what kind a new tab is on Ctrl+T', () => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.new-kind', platform), platform).toBe('Mod-t')
    }
  })
})

describe('the Obsidian keyboard', () => {
  test('puts the digits on the notes, the way Obsidian does', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['app.note-1']).toBe('Mod-1')
    expect(keys['app.note-9']).toBe('Mod-9')
    expect(keys['paragraph.heading-1']).toBeNull()
    expect(keys['paragraph.heading-6']).toBeNull()
  })

  test('gives the split, the graph and following a link their keys', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['pane.split-right']).toBe('Mod-\\')
    expect(keys['pane.split-down']).toBe('Mod-Shift-\\')
    expect(keys['app.graph']).toBe('Mod-g')
    expect(keys['edit.follow-link']).toBe('Alt-Enter')
  })

  test('leaves what Orden and Obsidian already agree on alone', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    for (const id of ['app.reading', 'app.new', 'app.close', 'format.link']) {
      expect(keys[id], id).toBeUndefined()
    }
  })

  test('opens the palette on Ctrl+O and narrows it to the commands on Ctrl+P', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    expect(keys['app.palette']).toBeUndefined()
    expect(keys['app.palette.alt']).toBe('Mod-o')
    expect(keys['app.palette.open']).toBeNull()
    expect(keys['app.commands.alt']).toBe('Mod-p')
    expect(registry.BY_ID.get('app.commands.alt')?.alias).toBe(true)
  })

  test('goes back and forward on Ctrl+Alt and an arrow, and deletes the line on Ctrl+D', () => {
    const keys = presets.presetById('obsidian')?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.back', platform), platform).toBe('Mod-Alt-ArrowLeft')
      expect(keyUnder(keys, 'app.forward', platform), platform).toBe('Mod-Alt-ArrowRight')
      expect(keyUnder(keys, 'edit.delete-line', platform), platform).toBe('Mod-d')
      expect(keyUnder(keys, 'edit.select-word', platform), platform).toBeNull()
      expect(keyUnder(keys, 'app.deselect-tab', platform), platform).toBeNull()
    }
  })
})

describe('Ctrl+D', () => {
  test.each(['default', 'vim'])('deselects the tab under %s, and nothing else holds it', (id) => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, 'app.deselect-tab', platform), platform).toBe('Mod-d')
      expect(keyUnder(keys, 'edit.select-word', platform), platform).toBeNull()
      expect(keyUnder(keys, 'tree.duplicate', platform), platform).toBeNull()
      expect(keyUnder(keys, 'canvas.duplicate', platform), platform).toBe('Mod-d')
    }
  })

  test.each([
    ['vscode', 'edit.select-word'],
    ['obsidian', 'edit.delete-line'],
    ['notion', 'edit.duplicate-block'],
  ])('is the other app’s own under %s', (id, theirs) => {
    const keys = presets.presetById(id)?.keys ?? {}

    for (const platform of PLATFORMS) {
      expect(keyUnder(keys, theirs, platform), platform).toBe('Mod-d')
      expect(keyUnder(keys, 'app.deselect-tab', platform), platform).toBeNull()
    }
  })

  test.each(['default', 'vim', 'vscode', 'obsidian', 'notion'])(
    'puts every pane down on Ctrl+Shift+D under %s',
    (id) => {
      const keys = presets.presetById(id)?.keys ?? {}

      for (const platform of PLATFORMS) {
        expect(keyUnder(keys, 'app.deselect-all', platform), platform).toBe('Mod-Shift-d')
        const others = registry.SHORTCUTS.filter(
          (one) =>
            one.id !== 'app.deselect-all' &&
            keyUnder(keys, one.id, platform)?.toLowerCase() === 'mod-shift-d',
        )
        expect(
          others.map((one) => one.id),
          platform,
        ).toEqual([])
      }
    },
  )

  test('is a command of the app’s, which the palette and the list can press', () => {
    const entry = registry.BY_ID.get('app.deselect-tab')

    expect(entry?.scope).toBe('app')
    expect(entry?.category).toBe('view')
    expect(registry.runnable('app.deselect-tab')).toBe(true)
  })
})

describe('the brackets', () => {
  test('indent on Ctrl+[ under the default keyboard', () => {
    for (const platform of PLATFORMS) {
      expect(keyUnder({}, 'edit.indent', platform), platform).toBe('Mod-[')
      expect(keyUnder({}, 'edit.outdent', platform), platform).toBe('Mod-]')
    }
  })

  test.each(['vscode', 'obsidian'])('indent on Ctrl+] under %s', (id) => {
    const keys = presets.presetById(id)?.keys ?? {}

    expect(keys['edit.indent']).toBe('Mod-]')
    expect(keys['edit.outdent']).toBe('Mod-[')
  })
})

describe('the VS Code keyboard', () => {
  const keys = () => presets.presetById('vscode')?.keys ?? {}

  test("puts VS Code's keys on the editor's commands", () => {
    for (const platform of PLATFORMS) {
      const on = (id: string) => keyUnder(keys(), id, platform)

      expect(on('edit.goto-line'), platform).toBe('Ctrl-g')
      expect(on('edit.delete-line'), platform).toBe('Mod-Shift-k')
      expect(on('edit.select-all-occurrences'), platform).toBe('Mod-Shift-l')
      expect(on('pane.split-right'), platform).toBe('Mod-\\')
    }
  })

  test('grows and shrinks the selection on Shift+Alt and an arrow, as Orden already does', () => {
    expect(keys()['edit.expand-selection']).toBeUndefined()
    expect(keyUnder(keys(), 'edit.expand-selection', 'win')).toBe('Shift-Alt-ArrowRight')
    expect(keyUnder(keys(), 'edit.shrink-selection', 'linux')).toBe('Shift-Alt-ArrowLeft')
  })

  test('keeps Ctrl+B on bold', () => {
    expect(keys()['format.bold']).toBeUndefined()
    expect(keys()['app.sidebar']).toBeNull()
    expect(keyUnder(keys(), 'app.files', 'win')).toBe('Mod-Shift-e')
  })

  test('leaves find next on F3, and Code block and clear formatting without a key', () => {
    expect(keys()['edit.find-next']).toBeNull()
    expect(keyUnder(keys(), 'edit.find-next.alt', 'win')).toBe('F3')
    expect(keys()['paragraph.code-block']).toBeNull()
    expect(keys()['format.clear']).toBeNull()
  })
})

describe('the Notion keyboard', () => {
  test('puts the block types on the numbers, the way Notion does', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    expect(keys['paragraph.body']).toBeUndefined()
    expect(keys['paragraph.heading-1']).toBe('Mod-Shift-1')
    expect(keys['paragraph.bullet-list']).toBe('Mod-Shift-5')
    expect(keys['paragraph.ordered-list']).toBe('Mod-Shift-6')
    expect(keys['paragraph.code-block']).toBe('Mod-Shift-8')
  })

  test('gives inline code Ctrl+E and the sidebar Ctrl+backslash', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    expect(keys['format.code']).toBe('Mod-e')
    expect(keys['app.sidebar']).toBe('Mod-\\')
    expect(keys['app.reading']).toBeNull()
    expect(keys['format.clear']).toBeNull()
  })

  test('duplicates the block on Ctrl+D and moves it on Ctrl+Shift and an arrow', () => {
    const keys = presets.presetById('notion')?.keys ?? {}

    expect(keys['edit.duplicate-block']).toBe('Mod-d')
    expect(keys['edit.move-block-up']).toBe('Mod-Shift-ArrowUp')
    expect(keys['edit.move-block-down']).toBe('Mod-Shift-ArrowDown')
    expect(keys['app.deselect-tab']).toBeNull()
  })
})

describe('a name written down or carried by the account', () => {
  test('is taken when it is one this version has', () => {
    expect(names.knownPreset('obsidian')).toBe('obsidian')
    expect(names.knownPreset('vscode')).toBe('vscode')
    expect(names.knownPreset('custom')).toBe('custom')
  })

  test('is no opinion at all when there is none', () => {
    expect(names.knownPreset(undefined)).toBeNull()
    expect(names.knownPreset('')).toBeNull()
    expect(names.knownPreset(7)).toBeNull()
  })

  test('reads as Custom when it is one this version has never heard of', () => {
    expect(names.knownPreset('emacs')).toBe('custom')
    expect(presets.presetById('emacs')).toBeUndefined()
  })
})

describe('the VS Code keyboard', () => {
  test('puts the palette on Ctrl+P first and Shift twice second', () => {
    const keys = presets.presetById('vscode')?.keys ?? {}

    expect(keys['app.palette']).toBe('Mod-p')
    expect(keys['app.palette.alt']).toBe('Shift Shift')
  })
})

describe('Ctrl+P', () => {
  test.each(['default', 'vim'])('prints under %s, and the palette is not on it', (id) => {
    const keys = presets.presetById(id)?.keys ?? {}
    expect(keys['app.print']).toBeUndefined()
    expect(registry.BY_ID.get('app.print')?.key).toBe('Mod-p')
    expect(registry.BY_ID.get('app.palette.alt')?.key).toBeNull()
  })

  test.each([
    ['vscode', 'app.palette'],
    ['notion', 'app.palette.alt'],
    ['obsidian', 'app.commands.alt'],
  ])('is %s’s own palette there, and Print has none', (id, holder) => {
    const keys = presets.presetById(id)?.keys ?? {}
    expect(keys[holder]).toBe('Mod-p')
    expect(keys['app.print']).toBeNull()
  })
})
