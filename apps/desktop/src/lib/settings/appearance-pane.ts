import { DEFAULTS, type FontPlace, INTERFACE_ZOOMS, modes } from '../modes.svelte'
import { isDesktop, platform } from '../tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from '../schemes'
import { appSettings, builtIns, type SchemeChoice, theme } from '../theme.svelte'
import { SHARED, type ThemeSetting, type ThemeValue } from '../themes/settings'
import { WALLPAPER_THEME } from '../wallpaper/held'
import { wallpaper } from '../wallpaper/wallpaper.svelte'
import { workspace } from '../workspace.svelte'
import type { PictureSide, PairField, Field, Group, Pane } from './fields'

const FONT_FIELDS: readonly {
  place: FontPlace
  label: string
  hint: string
  own: string
  words: string[]
}[] = [
  {
    place: 'content',
    label: 'Note font',
    hint: 'The face notes are written in; any font installed here, by its name.',
    own: 'iA Writer Quattro',
    words: ['writing', 'text', 'serif'],
  },
  {
    place: 'ui',
    label: 'Interface font',
    hint: 'The face of menus, lists and settings; any font installed here, by its name.',
    own: 'Geist',
    words: ['ui', 'menus', 'sidebar'],
  },
  {
    place: 'mono',
    label: 'Code font',
    hint: 'The face of code and terminals; any monospaced font installed here, by its name.',
    own: 'iA Writer Mono S',
    words: ['monospace', 'code', 'terminal'],
  },
]

function asChoice(value: string): SchemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system'
}

function themeField(setting: ThemeSetting, owner = theme.id): Field {
  const label = setting.label
  const worn = () => owner === theme.id
  const drawer = setting.shared === true ? SHARED : owner
  const get = () => (worn() ? theme.values[setting.id] : theme.keptFor(drawer, setting.id))
  const put = (value: ThemeValue) =>
    worn() ? theme.set(setting.id, value) : theme.setFor(drawer, setting.id, value)
  const common = {
    label,
    hint: setting.hint,
    initial: setting.initial,
    key: drawer === SHARED ? `appearance.${setting.id}` : `themes.${owner}.${setting.id}`,
  }

  if (setting.kind === 'range') {
    return {
      ...common,
      kind: 'slider',
      min: setting.min,
      max: setting.max,
      step: setting.step,
      unit: setting.unit,
      initial: setting.initial,
      ...(setting.least ? { least: setting.least } : {}),
      get: () => Number(get() ?? setting.initial),
      preview: (value) => theme.try(setting.id, value),
      set: put,
    }
  }

  if (setting.kind === 'switch') {
    return {
      ...common,
      kind: 'switch',
      initial: setting.initial,
      get: () => get() === true,
      set: put,
    }
  }

  if (setting.kind === 'colour') {
    const pair = setting.pair
    return {
      ...common,
      ...(pair
        ? {
            pair: {
              get: () => pair.colours(String(get() ?? setting.initial), theme.current),
              own: () => pair.accepts(String(get() ?? '')),
              preview: (first, second) => theme.try(setting.id, pair.of(first, second)),
              set: (first, second) => theme.set(setting.id, pair.of(first, second)),
            } satisfies PairField,
          }
        : {}),
      kind: 'swatches',
      options: setting.options.map((one) => ({
        value: one.value,
        label: one.name,
        colour: one[theme.current],
      })),
      initial: setting.initial,
      get: () => String(get() ?? setting.initial),
      set: put,
    }
  }

  const options = setting.options.map((one) => ({
    value: one.value,
    label: one.label,
    ...(one.disabled ? { disabled: true } : {}),
  }))

  return {
    ...common,
    kind: options.length > 3 && !setting.own ? 'select' : 'segmented',
    options,
    initial: setting.initial,
    get: () => String(get() ?? setting.initial),
    set: put,
  }
}

export async function themeDeclarations(): Promise<Field[]> {
  const fields = appSettings().map((one) => themeField(one, SHARED))
  for (const one of builtIns()) {
    if (!one.own) continue
    const list = await one.own()
    fields.push(...list().map((setting) => themeField(setting, one.id)))
  }
  return fields
}

function pictureField(): Field {
  const sides = (['light', 'dark'] as const).map((scheme): PictureSide => ({
    label: SCHEME_NAMES[scheme],
    current: theme.current === scheme,
    picture: () => wallpaper.of(scheme)?.picture ?? '',
    own: () => wallpaper.owns(scheme),
    focus: () => wallpaper.of(scheme)?.focus ?? [0.5, 0.5],
    choose: () => void wallpaper.choose(scheme),
    remove: () => wallpaper.clear(scheme),
    place: (x, y, kept) => wallpaper.place(scheme, x, y, kept),
  }))

  return {
    kind: 'picture',
    label: 'Picture',
    hint: 'The picture behind the window, one for light and one for dark; drag it to move its centre.',
    words: ['wallpaper', 'background', 'image', 'photo', 'focal point'],
    get: () => wallpaper.of(theme.current)?.picture ?? '',
    set: (value) => {
      if (!value) wallpaper.clear(theme.current)
    },
    sides,
  }
}

function ownFields(): Field[] {
  return theme.settings
    .filter((one) => one.own === true && (one.when?.() ?? true))
    .map((one) => themeField(one))
}

export function appearancePane(): Pane {
  const zooms = isDesktop && platform() === 'linux'
  if (zooms) void modes.askInterfaceZoom().catch(() => undefined)
  return {
    id: 'appearance',
    label: 'Appearance',
    groups: [
      {
        title: 'Theme',
        fields: [
          {
            kind: 'select',
            key: 'appearance.style',
            open: true,
            label: 'Style',
            hint: 'The theme Orden is drawn in.',
            words: ['theme', 'look'],
            options: theme.all.map((one) => ({ value: one.id, label: one.name })),
            get: () => theme.id,
            set: (value) => theme.select(value),
          },
          {
            kind: 'segmented',
            key: 'appearance.mode',
            label: 'Mode',
            hint: 'Light, dark, or whichever the system is in.',
            words: ['dark', 'light', 'night', 'theme'],
            options: SCHEME_CHOICES.map((one) => ({
              value: one,
              label: SCHEME_NAMES[one],
              disabled: !theme.offers(one),
            })),
            get: () => theme.shown,
            set: (value) => theme.setScheme(asChoice(value)),
          },
          ...theme.settings.filter((one) => one.own !== true).map((one) => themeField(one)),
        ],
      },

      ...(theme.settings.some((one) => one.own === true)
        ? [
            {
              title: theme.active.name,
              fields: [...(theme.id === WALLPAPER_THEME ? [pictureField()] : []), ...ownFields()],
            },
          ]
        : []),

      {
        title: 'Fonts',
        fields: FONT_FIELDS.map((one): Field => ({
          kind: 'text',
          key: `appearance.${one.place}Font`,
          label: one.label,
          words: ['font', 'typeface', 'family', 'custom font', ...one.words],
          hint: one.hint,
          placeholder: one.own,
          font: { mono: one.place === 'mono' },
          initial: '',
          get: () => modes.fonts[one.place],
          set: (value) => modes.setFont(one.place, value),
        })),
      },

      {
        title: 'Pointer',
        fields: [
          {
            kind: 'switch',
            key: 'appearance.pointingHand',
            label: 'Pointing hand on buttons',
            hint: 'Shows a pointing hand over buttons, as web pages do.',
            words: ['cursor', 'mouse', 'hand', 'click'],
            initial: DEFAULTS.hand,
            get: () => modes.hand,
            set: () => modes.toggleHand(),
          },
          {
            kind: 'switch',
            key: 'appearance.paneFollowsPointer',
            label: 'Active pane follows the pointer',
            hint: 'The pane under the pointer becomes the one you work in.',
            words: ['pane', 'split', 'focus follows mouse', 'hover', 'mouse', 'active'],
            initial: true,
            get: () => workspace.device.paneFollowsPointer,
            set: (on) => workspace.device.followPointer(on),
          },
        ],
      },

      ...(isDesktop
        ? ([
            {
              title: 'Window',
              fields: [
                {
                  kind: 'segmented',
                  key: 'appearance.frame',
                  label: 'Frame',
                  hint: 'Orden’s own title bar, or the window frame of your system.',
                  words: ['title bar', 'window'],
                  options: [
                    { value: 'orden', label: 'Orden’s own' },
                    { value: 'system', label: 'The system’s' },
                  ],
                  initial: DEFAULTS.frame,
                  get: () => modes.frame,
                  set: (value) => modes.setFrame(value),
                },
                ...(zooms
                  ? ([
                      {
                        kind: 'select',
                        label: 'Zoom',
                        hint: 'How large all of Orden is drawn on this device.',
                        words: ['scale', 'interface', 'ui', 'sidebar', 'bigger', 'smaller'],
                        options: INTERFACE_ZOOMS.map((one) => ({
                          value: String(one),
                          label: `${String(Math.round(one * 100))}%`,
                        })),
                        initial: '1',
                        get: () => String(modes.interfaceZoom),
                        set: (value) => void modes.setInterfaceZoom(Number(value)),
                      },
                    ] satisfies Field[])
                  : []),
              ],
            },
          ] satisfies Group[])
        : []),
    ],
  }
}
