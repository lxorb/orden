import { Compartment, Facet, type Extension, type StateEffect } from '@codemirror/state'
import { type EditorView, keymap, type KeyBinding } from '@codemirror/view'

export interface BindingSpec {
  id: string
  key: string | null
  mac?: string | null
  win?: string | null
  linux?: string | null
  run: NonNullable<KeyBinding['run']>
  shift?: NonNullable<KeyBinding['shift']>
  scope?: string
  preventDefault?: boolean
  contextual?: boolean
  alias?: boolean
}

export type KeyOverrides = Record<string, string | null>

const shortcutKeys = Facet.define<KeyOverrides, KeyOverrides>({
  combine: (values) => values[0] ?? {},
})

const chosen = new Compartment()

export function shortcutExtensions(overrides: KeyOverrides = {}): Extension {
  return chosen.of(shortcutKeys.of(overrides))
}

export function shortcutEffect(overrides: KeyOverrides): StateEffect<unknown> {
  return chosen.reconfigure(shortcutKeys.of(overrides))
}

export function setShortcutKeys(view: EditorView, overrides: KeyOverrides) {
  view.dispatch({ effects: shortcutEffect(overrides) })
}

export function defaultKeyFor(
  spec: Pick<BindingSpec, 'key' | 'mac' | 'win' | 'linux'>,
  platform: 'mac' | 'win' | 'linux',
): string | null {
  const own = platform === 'mac' ? spec.mac : platform === 'win' ? spec.win : spec.linux
  return own === undefined ? spec.key : own
}

const PLATFORMS = ['mac', 'win', 'linux'] as const

export function bindings(specs: BindingSpec[], overrides: KeyOverrides): KeyBinding[] {
  const built: KeyBinding[] = []

  for (const spec of specs) {
    const chosen = spec.id in overrides ? (overrides[spec.id] ?? null) : undefined
    if (chosen === null) continue

    const binding: KeyBinding = { run: spec.run }
    if (spec.shift) binding.shift = spec.shift
    if (spec.scope) binding.scope = spec.scope
    if (spec.preventDefault) binding.preventDefault = true

    if (chosen === undefined) {
      const split = PLATFORMS.some((platform) => spec[platform] === null)
      if (spec.key !== null && !split) binding.key = spec.key
      for (const platform of PLATFORMS) {
        const key = split ? defaultKeyFor(spec, platform) : spec[platform]
        if (key) binding[platform] = key
      }
      if (!binding.key && !binding.mac && !binding.win && !binding.linux) continue
    } else {
      binding.key = chosen
    }

    built.push(binding)
  }

  return built
}

export function boundKeymap(specs: BindingSpec[]): Extension {
  return keymap.compute([shortcutKeys], (state) => bindings(specs, state.facet(shortcutKeys)))
}
