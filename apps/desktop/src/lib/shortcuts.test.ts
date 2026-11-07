import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  type BindingSpec,
  defaultKeyFor,
  imageBindings,
  nibBindings,
  nibKeymap,
  standardBindings,
  tableBindings,
} from '@orden/editor'
import { parseCombination, sameCombination } from './keys'
import { BROWSER_KEYS, SYSTEM_KEYS } from './shortcuts/registry'

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

let registry: typeof import('./shortcuts.svelte')

await Promise.all([
  import('./shortcuts.svelte'),
  import('./modes.svelte'),
  import('./commands'),
  import('./app-menu'),
])

const { PRESETS, presetById } = await import('./shortcuts/presets')
const keyboard = (id: string) => {
  const found = presetById(id)
  if (!found) throw new Error(`no keyboard called ${id}`)
  return found
}

async function restarted() {
  vi.resetModules()
  const module = await import('./shortcuts.svelte')
  module.shortcuts.restore()
  return module
}

beforeEach(async () => {
  localStorage.clear()
  registry = await restarted()
})

async function currentModes() {
  return (await import('./modes.svelte')).modes
}

function press(
  key: string,
  held: {
    code?: string
    ctrl?: boolean
    meta?: boolean
    alt?: boolean
    shift?: boolean
    answered?: boolean
  } = {},
) {
  return {
    key,
    code: held.code,
    ctrlKey: !!held.ctrl,
    metaKey: !!held.meta,
    altKey: !!held.alt,
    shiftKey: !!held.shift,
    defaultPrevented: !!held.answered,
    preventDefault: () => undefined,
  } as unknown as KeyboardEvent
}

const PLATFORMS = ['mac', 'win', 'linux'] as const

describe('every shortcut there is', () => {
  test('has an id nothing else has', () => {
    const ids = registry.SHORTCUTS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test.each([
    ['the markdown bindings', nibBindings],
    ['the ones taken over from CodeMirror', standardBindings],
    ['the table bindings', tableBindings],
    ['the picture bindings', imageBindings],
  ])('covers %s', (_name, specs: BindingSpec[]) => {
    const missing = specs.filter((spec) => !registry.SHORTCUTS.some((one) => one.id === spec.id))
    expect(missing.map((spec) => spec.id)).toEqual([])
  })

  test('gives every one of them a name of its own rather than its id', () => {
    const unnamed = registry.SHORTCUTS.filter((one) => one.label() === one.id)
    expect(unnamed.map((one) => one.id)).toEqual([])
  })

  test('gives every app-level one something to run', () => {
    const idle = registry.SHORTCUTS.filter((one) => one.scope === 'app' && !one.run)
    expect(idle.map((one) => one.id)).toEqual([])
  })

  test('holds no Windows or Super key on Windows and Linux, by default or in a keyboard', () => {
    const windowsKey = (key: string | null, platform: 'win' | 'linux') =>
      key !== null && parseCombination(key, platform)?.meta === true
    for (const platform of ['win', 'linux'] as const) {
      const defaults = registry.SHORTCUTS.filter((one) =>
        windowsKey(defaultKeyFor(one, platform), platform),
      )
      expect(
        defaults.map((one) => one.id),
        platform,
      ).toEqual([])
      const editor = [
        ...nibBindings,
        ...standardBindings,
        ...tableBindings,
        ...imageBindings,
      ].filter((one) => windowsKey(defaultKeyFor(one, platform), platform))
      expect(
        editor.map((one) => one.id),
        platform,
      ).toEqual([])
      for (const preset of PRESETS) {
        const held = Object.entries(preset.keys).filter(([, key]) => windowsKey(key, platform))
        expect(held, `${preset.id} on ${platform}`).toEqual([])
      }
    }
  })

  test('on a Mac, holds Cmd rather than Control unless the entry says what a Mac presses', () => {
    const everywhere = new Set(['app.quick-add'])
    const control = registry.SHORTCUTS.filter((one) => {
      const key = defaultKeyFor(one, 'mac')
      return key !== null && /(^|-)Ctrl-/.test(key) && one.mac === undefined
    })
    expect(control.map((one) => one.id).filter((id) => !everywhere.has(id))).toEqual([])

    const typed = registry.SHORTCUTS.filter((one) => {
      const key = defaultKeyFor(one, 'mac')
      return one.scope !== 'panel' && key !== null && /^(Alt-)+(Shift-)?[a-z0-9]$/.test(key)
    })
    expect(typed.map((one) => `${one.id} ${String(defaultKeyFor(one, 'mac'))}`)).toEqual([])
  })

  test('offers nothing only a desktop has where there is no desktop', async () => {
    const { runnable } = await import('./shortcuts/registry')
    expect(runnable('app.new-window')).toBe(false)
    expect(runnable('app.palette')).toBe(true)
  })

  test('puts every one of them in a group the settings show', () => {
    const groups = new Set(registry.CATEGORIES.map((one) => one.id))
    const homeless = registry.SHORTCUTS.filter((one) => !groups.has(one.category))
    expect(homeless.map((one) => `${one.id}: ${one.category}`)).toEqual([])
  })

  test('says why each fixed key cannot be changed', () => {
    const fixed = registry.SHORTCUTS.filter((one) => one.scope === 'fixed')
    expect(fixed.length).toBeGreaterThan(0)

    for (const one of fixed) expect(one.why?.(), one.id).toBeTruthy()
  })

  test('starts each on the key the editor installs it with', () => {
    for (const spec of [...nibBindings, ...standardBindings, ...tableBindings, ...imageBindings]) {
      const entry = registry.SHORTCUTS.find((one) => one.id === spec.id)!
      for (const platform of PLATFORMS) {
        expect(defaultKeyFor(entry, platform), spec.id).toBe(defaultKeyFor(spec, platform))
      }
    }
  })

  test.each(PLATFORMS)('holds a key for everything nibKeymap binds (%s)', (platform) => {
    const listed = registry.SHORTCUTS.map((one) => defaultKeyFor(one, platform))
    for (const binding of nibKeymap) {
      const key = binding[platform] ?? binding.key
      if (key) expect(listed, key).toContain(key)
    }
  })

  test('answers Redo on Ctrl+Shift+Z on Windows and Linux, and on Cmd+Shift+Z on a Mac', () => {
    const found = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)!
    const alt = found('edit.redo.alt')
    expect(defaultKeyFor(alt, 'win')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'linux')).toBe('Ctrl-Shift-z')
    expect(defaultKeyFor(alt, 'mac')).toBeNull()
    expect(defaultKeyFor(found('edit.redo'), 'mac')).toBe('Mod-Shift-z')

    expect(alt.alias).toBe(true)
    expect(alt.label()).toBe(found('edit.redo').label())
  })

  test.each(PLATFORMS)('starts nothing on a key something else starts on (%s)', (platform) => {
    const held = new Map<string, string>()
    const clashes: string[] = []

    for (const entry of registry.SHORTCUTS) {
      if (entry.contextual) continue

      const key = defaultKeyFor(entry, platform)
      if (!key) continue

      for (const [taken, by] of held) {
        if (sameCombination(taken, key, platform))
          clashes.push(`${entry.id} and ${by} both start on ${key}`)
      }
      held.set(key, entry.id)
    }

    expect(clashes).toEqual([])
  })
})

describe('choosing a key', () => {
  test('wins over the default', () => {
    const { shortcuts } = registry
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')

    shortcuts.set('format.bold', 'Mod-Alt-b')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })

  test('can be no key at all', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', null)
    expect(shortcuts.keyFor('format.bold')).toBeNull()
    expect(shortcuts.hint('format.bold')).toBeUndefined()
  })

  test('is put back by resetting it', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.reset('format.bold')

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.changed('format.bold')).toBe(false)
  })

  test('and by resetting all of them', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.set('app.new', null)
    shortcuts.resetAll()

    expect(shortcuts.overrides).toEqual({})
    expect(shortcuts.keyFor('app.new')).toBe('Mod-Alt-n')
  })

  test('is refused where it holds the Windows key, outside a Mac', () => {
    const { shortcuts } = registry
    const on = (platform: string, key: string) => {
      const one = Object.create(shortcuts) as typeof shortcuts
      Object.defineProperty(one, 'platform', { value: platform })
      return one.refuse(key)
    }
    for (const platform of ['win', 'linux']) {
      expect(on(platform, 'Meta-Space'), platform).not.toBeNull()
      expect(on(platform, 'Ctrl-Meta-k'), platform).not.toBeNull()
    }
    expect(on('mac', 'Meta-k')).toBeNull()
  })

  test('is refused where it would fire while typing', () => {
    const { shortcuts } = registry
    expect(shortcuts.refuse('k')).not.toBeNull()
    expect(shortcuts.refuse('Shift-k')).not.toBeNull()
    expect(shortcuts.refuse('F7')).toBeNull()
    expect(shortcuts.refuse('Mod-k')).toBeNull()
  })

  test('is refused for an app key where the key is one typing needs', () => {
    const { shortcuts } = registry
    for (const key of ['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'Home', 'Shift-Enter']) {
      expect(shortcuts.refuse(key, 'app.scratchpad'), key).not.toBeNull()
    }
    expect(shortcuts.refuse('Mod-Enter', 'app.scratchpad')).toBeNull()
  })

  test('but a list’s own row may have it, where nobody is typing', () => {
    const { shortcuts } = registry
    expect(shortcuts.refuse('Enter', 'tree.rename')).toBeNull()
  })

  test('and so may a row whose own key it is', () => {
    const { shortcuts } = registry
    expect(shortcuts.refuse('Delete', 'table.delete')).toBeNull()
    expect(shortcuts.refuse('Enter', 'image.edit')).toBeNull()
    expect(shortcuts.refuse('Enter', 'table.delete')).not.toBeNull()
  })

  test('and the refusal names the keys the way the platform does', () => {
    const { shortcuts } = registry
    const on = (platform: string) => {
      const one = Object.create(shortcuts) as typeof shortcuts
      Object.defineProperty(one, 'platform', { value: platform })
      return one.refuse('k')
    }

    expect(on('mac')).toBe('Hold ⌃, ⌥ or ⌘ as well.')
    expect(on('win')).toBe('Hold Ctrl or Alt as well.')
    expect(on('linux')).toBe('Hold Ctrl or Alt as well.')
  })

  test('is warned about when the machine underneath usually keeps it', () => {
    const { shortcuts } = registry
    expect(shortcuts.warning('Alt-F4')).not.toBeNull()
    expect(shortcuts.warning('Mod-Alt-b')).toBeNull()
    expect(shortcuts.warning(null)).toBeNull()
  })

  test('Control pressed twice on a Mac is warned about, since macOS dictates with it too', () => {
    const { shortcuts } = registry
    const on = (platform: string, key: string) => {
      const one = Object.create(shortcuts) as typeof shortcuts
      Object.defineProperty(one, 'platform', { value: platform })
      return one.warning(key)
    }

    expect(on('mac', 'Ctrl Ctrl')).toBe('macOS can start dictation with this key too.')
    expect(on('mac', 'Alt Alt')).toBeNull()
    expect(on('mac', 'Mod Mod')).toBeNull()
    expect(on('win', 'Ctrl Ctrl')).toBeNull()
    expect(on('win', 'Mod Mod')).toBeNull()
  })
})

describe('what is written down', () => {
  test('is only what differs from the defaults', async () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')

    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'format.bold': 'Mod-Alt-b',
    })
  })

  test('lets a default that changed later reach the reader', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 'Mod-Alt-b' }))
    const { shortcuts } = await restarted()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    const italic = nibBindings.find((one) => one.id === 'format.italic')
    if (!italic) throw new Error('the editor no longer binds format.italic')
    expect(shortcuts.keyFor('format.italic')).toBe(defaultKeyFor(italic, 'win'))
  })

  test('keeps an id this version has never heard of', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'from.the.future': 'Mod-9' }))
    const { shortcuts } = await restarted()

    shortcuts.set('format.bold', 'Mod-Alt-b')
    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'from.the.future': 'Mod-9',
      'format.bold': 'Mod-Alt-b',
    })
  })

  test('survives a file that is nonsense', async () => {
    localStorage.setItem('nib:shortcuts', '{{{')
    expect((await restarted()).shortcuts.keyFor('format.bold')).toBe('Mod-b')

    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 42, 'app.new': null }))
    const { shortcuts } = await restarted()
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.new')).toBeNull()
  })

  test('comes back from the account', () => {
    const { shortcuts } = registry
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    expect(JSON.parse(localStorage.getItem('nib:shortcuts')!)).toEqual({
      'format.bold': 'Mod-Alt-b',
    })
  })

  test('is left alone by an account that carries none', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.receive({ ligatures: true })

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })
})

describe('choosing a keyboard', () => {
  test('starts on the default one', () => {
    expect(registry.shortcuts.preset).toBe('default')
    expect(registry.shortcuts.overrides).toEqual({})
  })

  test('rewrites the whole map rather than adding to it', () => {
    const { shortcuts } = registry
    shortcuts.set('format.bold', 'Mod-Alt-b')
    shortcuts.choose(keyboard('obsidian'))

    expect(shortcuts.preset).toBe('obsidian')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.note-1')).toBe('Mod-1')
    expect(shortcuts.keyFor('paragraph.heading-1')).toBeNull()
  })

  test('and Notion puts inline code where the reading view was', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('notion'))

    expect(shortcuts.keyFor('format.code')).toBe('Mod-e')
    expect(shortcuts.keyFor('app.reading')).toBeNull()
    expect(shortcuts.keyFor('paragraph.heading-1')).toBe('Mod-Shift-1')
  })

  test('goes back to the defaults by choosing the default one', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('obsidian'))
    shortcuts.choose(keyboard('default'))

    expect(shortcuts.overrides).toEqual({})
    expect(shortcuts.keyFor('paragraph.heading-1')).toBe('Mod-1')
  })

  test('is what resetting every key does', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('notion'))
    shortcuts.resetAll()

    expect(shortcuts.preset).toBe('default')
    expect(shortcuts.overrides).toEqual({})
  })

  test('turns modal editing on for Vim and off for the others', async () => {
    const { shortcuts } = registry
    const modes = await currentModes()

    shortcuts.choose(keyboard('vim'))
    expect(modes.vim).toBe(true)

    shortcuts.choose(keyboard('obsidian'))
    expect(modes.vim).toBe(false)
  })

  test('can be turned on over another keyboard without replacing it', async () => {
    const { shortcuts } = registry
    const modes = await currentModes()

    shortcuts.choose(keyboard('notion'))
    modes.setVimKeys(true)

    expect(modes.vim).toBe(true)
    expect(shortcuts.preset).toBe('notion')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
  })

  describe('and modal editing', () => {
    test('stays off for every keyboard but Vim', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      for (const id of ['default', 'notion', 'obsidian', 'vscode']) {
        shortcuts.choose(keyboard(id))
        expect(modes.vim, id).toBe(false)
      }
    })

    test('stays off when a name written down before is read back', async () => {
      for (const id of ['default', 'notion', 'obsidian', 'vscode', 'vim', 'custom']) {
        localStorage.clear()
        localStorage.setItem('nib:preset', id)

        const fresh = await restarted()
        const modes = await currentModes()

        expect(fresh.shortcuts.preset, id).toBe(id)
        expect(modes.vim, id).toBe(false)
      }
    })

    test('stays off when the account names a keyboard, Vim included', async () => {
      for (const preset of ['notion', 'vim']) {
        const fresh = await restarted()
        const modes = await currentModes()

        fresh.shortcuts.receive({ shortcuts: {}, preset })

        expect(fresh.shortcuts.preset, preset).toBe(preset)
        expect(modes.vim, preset).toBe(false)
      }
    })

    test('goes off again when every key is put back', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      shortcuts.choose(keyboard('vim'))
      expect(modes.vim).toBe(true)

      shortcuts.resetAll()
      expect(modes.vim).toBe(false)
    })

    test('survives rebinding a key by hand, which makes the map custom', async () => {
      const { shortcuts } = registry
      const modes = await currentModes()

      shortcuts.set('format.bold', 'Alt-b')

      expect(shortcuts.preset).toBe('custom')
      expect(modes.vim).toBe(false)
    })
  })

  test('is remembered across a restart', async () => {
    registry.shortcuts.choose(keyboard('obsidian'))
    const { shortcuts } = await restarted()

    expect(shortcuts.preset).toBe('obsidian')
    expect(shortcuts.keyFor('app.note-1')).toBe('Mod-1')
  })
})

describe('a map made by hand', () => {
  test('is Custom as soon as one key is rebound', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('obsidian'))
    shortcuts.set('format.bold', 'Mod-Alt-b')

    expect(shortcuts.preset).toBe('custom')
  })

  test('is Custom when one key is put back on its own, too', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('obsidian'))
    shortcuts.reset('app.note-1')

    expect(shortcuts.preset).toBe('custom')
  })

  test('is what a map written by an older build reads as', async () => {
    localStorage.setItem('nib:shortcuts', JSON.stringify({ 'format.bold': 'Mod-Alt-b' }))
    expect((await restarted()).shortcuts.preset).toBe('custom')

    localStorage.setItem('nib:shortcuts', '{}')
    expect((await restarted()).shortcuts.preset).toBe('default')
  })
})

describe('the keyboard the account carries', () => {
  test('brings the name along with the map', () => {
    const { shortcuts } = registry
    shortcuts.receive({ preset: 'notion', shortcuts: { 'format.code': 'Mod-e' } })

    expect(shortcuts.preset).toBe('notion')
    expect(shortcuts.keyFor('format.code')).toBe('Mod-e')
    expect(localStorage.getItem('nib:preset')).toBe('notion')
  })

  test('reads a name this version has never heard of as Custom', () => {
    const { shortcuts } = registry
    shortcuts.receive({ preset: 'emacs', shortcuts: { 'format.bold': 'Mod-Alt-b' } })

    expect(shortcuts.preset).toBe('custom')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })

  test('keeps the one this machine has when the account carries none', () => {
    const { shortcuts } = registry
    shortcuts.choose(keyboard('obsidian'))
    shortcuts.receive({ ligatures: true })

    expect(shortcuts.preset).toBe('obsidian')
  })
})

describe('two shortcuts on one key', () => {
  test('is a conflict, and says whose key it is', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.new', 'Mod-o').map((one) => one.id)).toEqual([
      'app.palette.open',
    ])
  })

  test('counts across the app and the editor, which cannot share one', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.new', 'Mod-b').map((one) => one.id)).toEqual(['format.bold'])
  })

  test('is not a conflict when nothing else is on the key', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('app.new', 'Mod-Alt-j')).toEqual([])
  })

  test('follows the keys as they are now, not as they started', () => {
    const { shortcuts } = registry
    shortcuts.set('app.palette.open', 'Mod-Alt-j')

    expect(shortcuts.conflicts('app.new', 'Mod-o')).toEqual([])
    expect(shortcuts.conflicts('app.new', 'Mod-Alt-j').map((one) => one.id)).toEqual([
      'app.palette.open',
    ])
  })

  test('leaves the contextual ones out, which is how they share the arrows', () => {
    const { shortcuts } = registry
    expect(shortcuts.conflicts('table.below', 'ArrowUp')).toEqual([])
    expect(shortcuts.conflicts('app.new', 'ArrowDown')).toEqual([])
  })

  test('is resolved by taking the key, which leaves the other with none', () => {
    const { shortcuts } = registry
    shortcuts.set('app.palette.open', null)
    shortcuts.set('app.new', 'Mod-o')

    expect(shortcuts.keyFor('app.palette.open')).toBeNull()
    expect(shortcuts.keyFor('app.new')).toBe('Mod-o')
    expect(shortcuts.conflicts('app.new', 'Mod-o')).toEqual([])
  })

  test('names the fixed key a combination would land on', () => {
    const { shortcuts } = registry
    expect(shortcuts.fixedHolder('Mod-x')?.id).toBe('fixed.cut')
    expect(shortcuts.fixedHolder('Mod-Alt-9')).toBeUndefined()
  })
})

describe('the keyboard', () => {
  test('runs what the key is bound to', () => {
    const { shortcuts } = registry
    let opened = 0

    const ran = shortcuts.handle(press('o', { ctrl: true, code: 'KeyO' }), {
      palette: () => opened++,
      fullscreen: () => undefined,
    })

    expect(ran).toBe(true)
    expect(opened).toBe(1)
  })

  test('prints on Ctrl+P and never opens the palette there', () => {
    const { shortcuts } = registry
    const ctrlP = press('p', { ctrl: true, code: 'KeyP' })

    expect(shortcuts.keyFor('app.print')).toBe('Mod-p')
    expect(shortcuts.pressed('app.print', ctrlP)).toBe(true)
    for (const id of ['app.palette', 'app.palette.alt', 'app.palette.open']) {
      expect(shortcuts.pressed(id, ctrlP), id).toBe(false)
    }
  })

  test('a key a surface has answered is not the app’s as well', () => {
    const { shortcuts } = registry
    let opened = 0
    const context = { palette: () => opened++, fullscreen: () => undefined }

    const answered = press('o', { ctrl: true, code: 'KeyO', answered: true })

    expect(shortcuts.handle(answered, context)).toBe(false)
    expect(opened).toBe(0)
    expect(shortcuts.handle(press('o', { ctrl: true, code: 'KeyO' }), context)).toBe(true)
    expect(opened).toBe(1)
  })

  test('follows a rebind straight away', () => {
    const { shortcuts } = registry
    let opened = 0
    const context = { palette: () => opened++, fullscreen: () => undefined }

    shortcuts.set('app.palette.open', 'Mod-Alt-9')

    expect(shortcuts.handle(press('o', { ctrl: true, code: 'KeyO' }), context)).toBe(false)
    expect(shortcuts.handle(press('9', { ctrl: true, alt: true, code: 'Digit9' }), context)).toBe(
      true,
    )
    expect(opened).toBe(1)
  })

  test('opens the palette on the commands from a chord of its own', () => {
    const { shortcuts } = registry
    const asked: (string | undefined)[] = []
    const context = {
      palette: (mode?: 'commands') => asked.push(mode),
      fullscreen: () => undefined,
    }

    expect(shortcuts.handle(press('o', { ctrl: true, code: 'KeyO' }), context)).toBe(true)
    expect(shortcuts.handle(press('P', { ctrl: true, shift: true, code: 'KeyP' }), context)).toBe(
      true,
    )

    expect(asked).toEqual([undefined, 'commands'])
  })

  test('and follows a rebind of that one too', () => {
    const { shortcuts } = registry
    const asked: (string | undefined)[] = []
    const context = {
      palette: (mode?: 'commands') => asked.push(mode),
      fullscreen: () => undefined,
    }

    shortcuts.set('app.commands', 'Mod-Alt-9')

    expect(shortcuts.handle(press('P', { ctrl: true, shift: true, code: 'KeyP' }), context)).toBe(
      false,
    )
    expect(shortcuts.handle(press('9', { ctrl: true, alt: true, code: 'Digit9' }), context)).toBe(
      true,
    )
    expect(asked).toEqual(['commands'])
  })

  test('leaves a key nothing is bound to alone', () => {
    const { shortcuts } = registry
    shortcuts.set('app.palette.open', null)

    const ran = shortcuts.handle(press('o', { ctrl: true, code: 'KeyO' }), {
      palette: () => undefined,
      fullscreen: () => undefined,
    })

    expect(ran).toBe(false)
  })
})

describe('Alt and a digit', () => {
  const ALT = { alt: true }
  const digit = (one: number) => press(String(one), { ...ALT, code: `Digit${one}` })

  test('is every place along the strip, the ninth included, and the nought the last', () => {
    const { shortcuts } = registry
    for (let place = 1; place <= 8; place++) {
      expect(shortcuts.keyFor(`app.note-${place}.alt`)).toBe(`Alt-${place}`)
    }
    expect(shortcuts.keyFor('app.note-ninth')).toBe('Alt-9')
    expect(shortcuts.keyFor('app.note-9.alt')).toBe('Alt-0')
  })

  test('is a second key for the commands that had one, and the ninth place its own', () => {
    const found = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)!

    for (const [second, first] of [
      ['app.note-1.alt', 'app.note-1'],
      ['app.note-8.alt', 'app.note-8'],
      ['app.note-9.alt', 'app.note-9'],
    ] as const) {
      expect(found(second).alias, second).toBe(true)
      expect(found(second).label()).toBe(found(first).label())
      expect(defaultKeyFor(found(first), 'win'), first).toMatch(/^Mod-Alt-\d$/)
    }

    const ninth = found('app.note-ninth')
    expect(ninth.alias).toBeUndefined()
    expect(ninth.label()).toBe('Note 9')
    expect(ninth.label()).not.toBe(found('app.note-9').label())
  })

  test('runs from the window, and says so', () => {
    const { shortcuts } = registry
    const context = { palette: () => undefined, fullscreen: () => undefined }

    for (const one of [1, 3, 9, 0])
      expect(shortcuts.handle(digit(one), context), `Alt+${one}`).toBe(true)
  })

  test('is never AltGr typing a character', () => {
    const { shortcuts } = registry
    const context = { palette: () => undefined, fullscreen: () => undefined }

    const swissAt = press('@', { ctrl: true, alt: true, code: 'Digit2' })
    expect(shortcuts.handle(swissAt, context)).toBe(false)
    expect(shortcuts.handle(press('2', { ctrl: true, alt: true, code: 'Digit2' }), context)).toBe(
      true,
    )
  })

  test('is not a chord while an input method is composing', () => {
    const { shortcuts } = registry
    const context = { palette: () => undefined, fullscreen: () => undefined }

    const composing = Object.assign(digit(3), { isComposing: true })
    expect(shortcuts.handle(composing, context)).toBe(false)
  })

  test.each(PLATFORMS)('displaces no other key (%s)', (platform) => {
    const taken = registry.SHORTCUTS.filter((one) => !one.id.startsWith('app.note-')).flatMap(
      (one) => {
        const key = defaultKeyFor(one, platform)
        return key && /^Alt-\d$/.test(key) ? [`${one.id} on ${key}`] : []
      },
    )
    expect(taken).toEqual([])
  })

  test('is none of the keyboards’ to take', async () => {
    const { PRESETS } = await import('./shortcuts/presets')
    const written = PRESETS.flatMap((preset) =>
      Object.entries(preset.keys).flatMap(([id, key]) =>
        key && /^Alt-\d$/.test(key) ? [`${preset.id}: ${id} on ${key}`] : [],
      ),
    )
    expect(written).toEqual([])
  })
})

describe('the file list', () => {
  test('reads its own keys from the registry', () => {
    const { shortcuts } = registry
    expect(shortcuts.pressed('tree.select-all', press('a', { ctrl: true, code: 'KeyA' }))).toBe(
      true,
    )
    expect(shortcuts.pressed('tree.deselect', press('Escape'))).toBe(true)
    expect(shortcuts.pressed('tree.delete', press('Delete'))).toBe(true)
    expect(shortcuts.pressed('tree.delete.alt', press('Backspace'))).toBe(true)
  })

  test('follows a rebind like everything else', () => {
    const { shortcuts } = registry
    shortcuts.set('tree.select-all', 'Mod-Alt-a')

    expect(shortcuts.pressed('tree.select-all', press('a', { ctrl: true, code: 'KeyA' }))).toBe(
      false,
    )
    expect(
      shortcuts.pressed('tree.select-all', press('a', { ctrl: true, alt: true, code: 'KeyA' })),
    ).toBe(true)
  })

  test('is not read off the window', () => {
    const { shortcuts } = registry
    let opened = 0
    shortcuts.set('app.palette', 'Mod-a')

    const ran = shortcuts.handle(press('a', { ctrl: true, code: 'KeyA' }), {
      palette: () => opened++,
      fullscreen: () => undefined,
    })

    expect(ran).toBe(true)
    expect(opened).toBe(1)
  })
})

describe('what a reader is shown', () => {
  test('is the key written the way this machine writes it', () => {
    expect(registry.shortcuts.hint('app.new')).toBe('Ctrl+Alt+N')
    expect(registry.shortcuts.hint('paragraph.heading-1')).toBe('Ctrl+1')
  })

  test('and follows a rebind', () => {
    const { shortcuts } = registry
    shortcuts.set('app.new', 'Mod-Alt-s')
    expect(shortcuts.hint('app.new')).toBe('Ctrl+Alt+S')
  })

  test('reaches the menus and the palette', async () => {
    const { shortcuts } = registry
    shortcuts.set('app.focus', 'Mod-Alt-9')

    const { appCommands } = await import('./commands')
    const { appMenu } = await import('./app-menu')
    const { isSubmenu } = await import('./menu-item')

    const command = appCommands().find((one) => one.id === 'focus')
    expect(command?.hint).toBe('Ctrl+Alt+9')

    const view = appMenu({ onpalette: () => undefined, onhistory: () => undefined }).find(
      (group) => group.id === 'view',
    )
    const row = view?.rows.find(
      (one) => one !== null && !isSubmenu(one) && one.label === command?.label,
    )
    expect(row !== null && row !== undefined && !isSubmenu(row) ? row.hint : null).toBe(
      'Ctrl+Alt+9',
    )
  })
})

describe('the keys that move the keyboard about', () => {
  test('walk the regions of the window, both ways', () => {
    expect(registry.shortcuts.keyFor('app.region-next')).toBe('F6')
    expect(registry.shortcuts.keyFor('app.region-previous')).toBe('Shift-F6')
  })

  test('reach every panel, and toggle the sidebar', () => {
    for (const id of ['app.files', 'app.outline', 'app.search', 'app.links', 'app.sidebar']) {
      expect(registry.shortcuts.keyFor(id), id).toBeTruthy()
    }
  })

  test('reach the spaces and the switcher', () => {
    expect(registry.shortcuts.keyFor('space.next')).toBeTruthy()
    expect(registry.shortcuts.keyFor('space.previous')).toBeTruthy()
    expect(registry.shortcuts.keyFor('space.switcher')).toBeTruthy()
  })

  test('opens the switcher on Ctrl+Space and Ctrl+Shift+Space', () => {
    const found = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)!
    const switcher = found('space.switcher')
    const alt = found('space.switcher.alt')
    for (const platform of ['win', 'linux'] as const) {
      expect(defaultKeyFor(switcher, platform)).toBe('Mod-Space')
      expect(defaultKeyFor(alt, platform)).toBe('Mod-Shift-Space')
    }
    expect(defaultKeyFor(switcher, 'mac')).toBe('Mod-Shift-Space')
    expect(defaultKeyFor(alt, 'mac')).toBeNull()
    expect(alt.alias).toBe(true)
    expect(alt.label()).toBe(switcher.label())
    for (const platform of PLATFORMS) {
      expect(defaultKeyFor(found('tree.toggle'), platform)).toBe('Mod-Shift-Enter')
    }
  })

  test('and the list of every key there is', () => {
    expect(registry.shortcuts.keyFor('app.keys')).toBeTruthy()
  })

  test('but not on the key a Mac keeps for searching Help', () => {
    const keys = registry.SHORTCUTS.find((one) => one.id === 'app.keys')
    if (!keys) throw new Error('no list of keys')

    expect(defaultKeyFor(keys, 'mac')).toBeNull()
    expect(defaultKeyFor(keys, 'win')).toBe('Mod-Shift-/')
  })

  test('make a new tab on Ctrl+T, the scratchpad on Ctrl+N, and a note on Ctrl+Alt+N', () => {
    const { shortcuts } = registry
    expect(shortcuts.keyFor('app.new-kind')).toBe('Mod-t')
    expect(shortcuts.keyFor('app.scratchpad')).toBe('Mod-n')
    expect(shortcuts.keyFor('app.scratchpad.alt')).toBe('Mod-Shift-x')
    expect(registry.SHORTCUTS.find((one) => one.id === 'app.scratchpad.alt')?.alias).toBe(true)
    expect(shortcuts.keyFor('app.new')).toBe('Mod-Alt-n')

    const chooser = registry.SHORTCUTS.find((one) => one.id === 'app.new-kind')
    expect(chooser?.alias).toBeUndefined()
    expect(chooser?.label()).not.toBe(shortcuts.hint('app.new'))
    expect(registry.SHORTCUTS.some((one) => one.id === 'app.new.alt')).toBe(false)
  })

  test.each(PLATFORMS)('never put two things on one digit through the shift (%s)', (platform) => {
    const digitsOn = (pattern: RegExp) =>
      new Map(
        registry.SHORTCUTS.map((one) => ({ id: one.id, key: defaultKeyFor(one, platform) }))
          .flatMap((one) => {
            const digit = one.key === null ? null : (pattern.exec(one.key)?.[1] ?? null)
            return digit ? [[digit, `${one.id} on ${one.key ?? ''}`] as const] : []
          })
          .map(([digit, said]) => [digit, said]),
      )

    const plain = digitsOn(/^Mod-([0-9])$/)
    const shifted = digitsOn(/^Mod-Shift-([0-9])$/)

    const guilty = [...shifted]
      .filter(([digit]) => plain.has(digit))
      .map(([digit, said]) => `${said} fires ${plain.get(digit) ?? ''} as well`)

    expect(guilty, guilty.join(', ')).toEqual([])
  })

  test('change the size of the words, the way every browser does', () => {
    expect(registry.shortcuts.keyFor('app.zoom-in')).toBe('Mod-=')
    expect(registry.shortcuts.keyFor('app.zoom-out')).toBe('Mod--')
    expect(registry.shortcuts.keyFor('app.zoom-reset')).toBe('Mod-0')
  })

  test('and the two that were on them are one modifier over', () => {
    expect(registry.shortcuts.keyFor('paragraph.heading-up')).toBe('Mod-Shift-=')
    expect(registry.shortcuts.keyFor('paragraph.heading-down')).toBe('Mod-Shift--')
  })

  test('and Paragraph needs none, because a heading key undoes itself', () => {
    expect(registry.shortcuts.keyFor('paragraph.body')).toBeNull()
    expect(registry.shortcuts.keyFor('app.commands')).toBe('Mod-Shift-p')

    const entry = registry.SHORTCUTS.find((one) => one.id === 'paragraph.body')
    expect(entry?.category).toBe('paragraph')
    expect(entry?.label()).toBeTruthy()
  })
})

describe('full window', () => {
  const entry = () => registry.SHORTCUTS.find((one) => one.id === 'app.fill-tab')

  test('is Shift+F11, and Ctrl+Shift+Cmd+F on a Mac', () => {
    expect(defaultKeyFor(entry()!, 'win')).toBe('Shift-F11')
    expect(defaultKeyFor(entry()!, 'linux')).toBe('Shift-F11')
    expect(defaultKeyFor(entry()!, 'mac')).toBe('Mod-Ctrl-Shift-f')
  })

  test('sits in View beside full screen, which keeps its own key', () => {
    expect(entry()?.category).toBe('view')
    expect(entry()?.scope).toBe('app')
    expect(registry.shortcuts.keyFor('app.fullscreen')).toBe('F11')
  })

  test('is no key a browser keeps for itself', () => {
    for (const platform of PLATFORMS) {
      const key = defaultKeyFor(entry()!, platform)
      expect(key).not.toBeNull()
      expect(BROWSER_KEYS.some((held) => sameCombination(held, key ?? '', platform))).toBe(false)
    }
  })

  test('answers the press it is on', () => {
    const shiftF11 = press('F11', { code: 'F11', shift: true })
    expect(registry.shortcuts.pressed('app.fill-tab', shiftF11)).toBe(true)
    expect(registry.shortcuts.pressed('app.fullscreen', shiftF11)).toBe(false)
    expect(registry.shortcuts.pressed('app.fill-tab', press('F11', { code: 'F11' }))).toBe(false)
  })
})

describe('a question on the side, and the scratchpad', () => {
  const entry = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)

  test('the question is Ctrl twice, Cmd twice on a Mac, which nothing else is on', () => {
    for (const platform of PLATFORMS) {
      expect(defaultKeyFor(entry('app.quick-question')!, platform)).toBe('Mod Mod')
    }
    expect(registry.shortcuts.conflicts('app.quick-question', 'Mod Mod')).toEqual([])
    expect(registry.shortcuts.hint('app.quick-question')).toBe('Ctrl Ctrl')
  })

  test('the scratchpad is Ctrl+N, and Ctrl+Shift+X where a browser keeps Ctrl+N', () => {
    expect(registry.shortcuts.keyFor('app.scratchpad')).toBe('Mod-n')
    expect(registry.shortcuts.conflicts('app.scratchpad', 'Mod-n')).toEqual([])
    const key = registry.shortcuts.keyFor('app.scratchpad.alt')
    expect(key).toBe('Mod-Shift-x')
    expect(registry.shortcuts.conflicts('app.scratchpad.alt', 'Mod-Shift-x')).toEqual([])
    for (const platform of PLATFORMS) {
      expect(BROWSER_KEYS.some((held) => sameCombination(held, key ?? '', platform))).toBe(false)
      expect(SYSTEM_KEYS[platform].some((held) => sameCombination(held, key ?? '', platform))).toBe(
        false,
      )
    }
  })

  test('keep their keys under every keyboard that can be chosen', () => {
    for (const id of ['obsidian', 'vscode', 'notion', 'vim']) {
      const preset = presetById(id)
      if (!preset) continue
      expect(preset.keys['app.quick-question'], id).toBeUndefined()
      expect(preset.keys['app.scratchpad'], id).toBeUndefined()
      expect(Object.values(preset.keys), id).not.toContain('Mod-Shift-x')
      expect(Object.values(preset.keys), id).not.toContain('Mod Mod')
    }
  })
})

describe('a page note’s zoom', () => {
  test('is on the keys the plane’s Fit is on, one modifier over', () => {
    expect(registry.shortcuts.keyFor('pages.zoom.in')).toBe('Mod-Alt-=')
    expect(registry.shortcuts.keyFor('pages.zoom.out')).toBe('Mod-Alt--')
    expect(registry.shortcuts.keyFor('pages.fit')).toBe('Mod-Alt-0')
  })

  test('and never on the three that change the size of the words', () => {
    const size = ['app.zoom-in', 'app.zoom-out', 'app.zoom-reset'].map((id) =>
      registry.shortcuts.keyFor(id),
    )

    for (const id of ['pages.zoom.in', 'pages.zoom.out', 'pages.fit']) {
      expect(size, id).not.toContain(registry.shortcuts.keyFor(id))
    }
  })

  test('is read where the paper is, and shares its keys with the plane', () => {
    for (const id of ['pages.zoom.in', 'pages.zoom.out', 'pages.fit', 'pages.add']) {
      const entry = registry.SHORTCUTS.find((one) => one.id === id)
      expect(entry?.scope, id).toBe('panel')
      expect(entry?.contextual, id).toBe(true)
      expect(entry?.category, id).toBe('pages')
    }

    expect(registry.shortcuts.keyFor('canvas.fit')).toBe('Mod-Alt-0')
    expect(registry.shortcuts.conflicts('pages.fit', 'Mod-Alt-0')).toEqual([])
  })

  test("is a browser's over a page, and leaves Present its F5", () => {
    const { shortcuts } = registry
    const keys = {
      'web.reload': 'F5',
      'web.reload.alt': 'Mod-r',
      'web.fresh': 'Mod-Shift-r',
      'web.fresh.alt': 'Mod-F5',
      'web.address': 'Mod-l',
      'web.address.alt': 'Alt-d',
      'web.stop': 'Escape',
    }

    for (const [id, key] of Object.entries(keys)) {
      const entry = registry.SHORTCUTS.find((one) => one.id === id)
      expect(entry?.scope, id).toBe('panel')
      expect(entry?.contextual, id).toBe(true)
      expect(shortcuts.keyFor(id), id).toBe(key)
    }

    expect(shortcuts.keyFor('app.present')).toBe('F5')
    expect(shortcuts.conflicts('web.reload', 'F5')).toEqual([])
    const found = (id: string) => registry.SHORTCUTS.find((one) => one.id === id)!
    expect(defaultKeyFor(found('web.reload'), 'mac')).toBe('Mod-r')
    expect(defaultKeyFor(found('web.address.alt'), 'mac')).toBeNull()
  })

  test('answers the press the surface reads, and no other', () => {
    const { shortcuts } = registry
    const press = (spelling: Partial<KeyboardEvent>) => spelling as KeyboardEvent

    expect(
      shortcuts.pressed(
        'pages.fit',
        press({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
    expect(shortcuts.pressed('pages.fit', press({ key: '0', code: 'Digit0', ctrlKey: true }))).toBe(
      false,
    )
    expect(
      shortcuts.pressed(
        'pages.zoom.in',
        press({ key: '=', code: 'Equal', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
    expect(
      shortcuts.pressed(
        'pages.zoom.out',
        press({ key: '-', code: 'Minus', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
  })

  test('while adding a page and fitting one start on no key at all', () => {
    expect(registry.shortcuts.keyFor('pages.add')).toBeNull()
    expect(registry.shortcuts.keyFor('pages.fit.page')).toBeNull()
    expect(registry.shortcuts.defaultFor('pages.add')).toBeNull()
  })
})

describe('on a Mac', () => {
  test('the keys are written as a Mac writes them', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    const { shortcuts } = await restarted()

    expect(shortcuts.platform).toBe('mac')
    expect(shortcuts.hint('app.new')).toBe('⌥⌘N')
    expect(shortcuts.hint('paragraph.code-block')).toBe('⇧⌘K')
    expect(shortcuts.keyFor('app.next-note')).toBe('Ctrl-Tab')

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })

  const MAC: [id: string, mac: string | null, elsewhere: string][] = [
    ['app.fullscreen', 'Mod-Ctrl-f', 'F11'],
    ['app.fill-tab', 'Mod-Ctrl-Shift-f', 'Shift-F11'],
    ['app.present', 'Mod-Alt-p', 'F5'],
    ['app.focus', 'Mod-Ctrl-o', 'F8'],
    ['app.typewriter', 'Mod-Ctrl-t', 'F9'],
    ['app.read-only', 'Mod-Ctrl-r', 'F10'],
    ['app.next-note.alt', 'Mod-Shift-]', 'Mod-PageDown'],
    ['app.previous-note.alt', 'Mod-Shift-[', 'Mod-PageUp'],
    ['app.note-1', 'Mod-1', 'Mod-Alt-1'],
    ['app.note-9', 'Mod-9', 'Mod-Alt-9'],
    ['app.note-1.alt', null, 'Alt-1'],
    ['app.note-8.alt', null, 'Alt-8'],
    ['app.note-ninth', null, 'Alt-9'],
    ['app.note-9.alt', null, 'Alt-0'],
    ['paragraph.heading-1', 'Mod-Alt-1', 'Mod-1'],
    ['paragraph.heading-6', 'Mod-Alt-6', 'Mod-6'],
    ['paragraph.quote', 'Mod-Alt-q', 'Mod-Shift-q'],
    ['paragraph.ordered-list', null, 'Mod-Shift-['],
    ['paragraph.bullet-list', null, 'Mod-Shift-]'],
    ['format.code', 'Ctrl-`', 'Mod-Shift-`'],
    ['format.strikethrough', 'Ctrl-Shift-`', 'Alt-Shift-5'],
    ['tree.delete', 'Mod-Backspace', 'Delete'],
    ['tree.delete.alt', 'Mod-Delete', 'Backspace'],
    ['tree.rename', 'Mod-Enter', 'F2'],
    ['canvas.frame', 'Mod-Alt-1', 'Mod-1'],
    ['canvas.front', 'Mod-Alt-]', 'Mod-Shift-]'],
    ['canvas.back', 'Mod-Alt-[', 'Mod-Shift-['],
  ]

  test.each(MAC)('%s is %s on a Mac and %s elsewhere', (id, mac, elsewhere) => {
    const entry = registry.SHORTCUTS.find((one) => one.id === id)!
    expect(defaultKeyFor(entry, 'mac')).toBe(mac)
    expect(defaultKeyFor(entry, 'win')).toBe(elsewhere)
    expect(defaultKeyFor(entry, 'linux')).toBe(elsewhere)
  })

  test.each(PLATFORMS)('starts nothing on a key the system keeps (%s)', (platform) => {
    const kept = registry.SHORTCUTS.filter((one) => one.scope !== 'fixed').flatMap((one) => {
      const key = defaultKeyFor(one, platform)
      if (!key) return []
      return SYSTEM_KEYS[platform].some((held) => sameCombination(held, key, platform))
        ? [`${one.id} on ${key}`]
        : []
    })

    expect(kept).toEqual([])
  })

  test('warns about the keys the Mac keeps for itself', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    const { shortcuts } = await restarted()

    for (const key of [
      'F11',
      'Mod-`',
      'Mod-Shift-`',
      'Ctrl-Space',
      'Mod-Ctrl-q',
      'Ctrl-ArrowLeft',
    ]) {
      expect(shortcuts.warning(key), key).not.toBeNull()
    }
    expect(shortcuts.warning('Mod-Ctrl-f')).toBeNull()

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })

  test('the file list deletes on Cmd+Backspace and never on a bare one', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    const { shortcuts } = await restarted()
    const deletes = (event: KeyboardEvent) =>
      shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)

    const cmd = (key: string) => press(key, { meta: true })
    expect(deletes(press('Backspace'))).toBe(false)
    expect(deletes(press('Delete'))).toBe(false)
    expect(deletes(cmd('Backspace'))).toBe(true)
    expect(deletes(cmd('Delete'))).toBe(true)
    expect(shortcuts.hint('tree.delete')).toBe('⌘⌫')

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })

  test('the menus and the palette show the Mac keys, in signs', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    const { shortcuts } = await restarted()
    const { appCommands } = await import('./commands')

    expect(shortcuts.hint('app.fullscreen')).toBe('⌃⌘F')
    expect(shortcuts.hint('app.present')).toBe('⌥⌘P')
    expect(shortcuts.hint('app.note-1')).toBe('⌘1')
    expect(shortcuts.hint('paragraph.heading-1')).toBe('⌥⌘1')
    expect(shortcuts.hint('format.code')).toBe('⌃`')
    expect(shortcuts.hint('app.next-note.alt')).toBe('⇧⌘]')
    expect(shortcuts.hint('paragraph.bullet-list')).toBeUndefined()
    expect(appCommands().find((one) => one.id === 'focus')?.hint).toBe('⌃⌘O')

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })
})

describe('off a Mac', () => {
  test('the same keys read as they always have', async () => {
    const { shortcuts } = await restarted()
    const { appCommands } = await import('./commands')

    expect(shortcuts.hint('app.fullscreen')).toBe('F11')
    expect(shortcuts.hint('app.note-1')).toBe('Ctrl+Alt+1')
    expect(shortcuts.hint('tree.delete')).toBe('Del')
    expect(shortcuts.pressed('tree.delete.alt', press('Backspace'))).toBe(true)
    expect(appCommands().find((one) => one.id === 'focus')?.hint).toBe('F8')
  })
})

describe('a view’s keys', () => {
  test('join the list when a view is drawn, named, grouped and on ids of their own', async () => {
    expect(registry.SHORTCUTS.some((one) => one.id === 'tasks.complete')).toBe(false)
    await import('./views/task-keys')
    const ids = registry.SHORTCUTS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(registry.CATEGORIES.map((one) => one.id))
    const tasks = registry.SHORTCUTS.filter((one) => one.id.startsWith('tasks.'))
    expect(tasks.length).toBeGreaterThan(20)
    for (const one of tasks) {
      expect(groups.has(one.category), one.id).toBe(true)
      expect(one.label(), one.id).not.toBe(one.id)
    }
    expect(registry.shortcuts.keyFor('tasks.complete')).toBe('e')
  })
})
