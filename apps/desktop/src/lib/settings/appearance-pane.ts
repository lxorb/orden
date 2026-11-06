import { key, t } from '../i18n.svelte'
import { DEFAULTS, type FontPlace, INTERFACE_ZOOMS, modes } from '../modes.svelte'
import { isDesktop, isMobile, platform } from '../tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from '../schemes'
import { sideToggles } from '../side-toggles.svelte'
import { appSettings, builtIns, type SchemeChoice, theme } from '../theme.svelte'
import { type ChosenSettings, SHARED, type ThemeSetting, type ThemeValue } from '../themes/settings'
import { WALLPAPER_THEME } from '../wallpaper/held'
import { wallpaper } from '../wallpaper/wallpaper.svelte'
import { workspace } from '../workspace.svelte'
import type { PictureSide, PairField, Field, Group, Pane } from './fields'
import { part } from './hold'

const FONT_FIELDS: readonly {
  place: FontPlace
  label: string
  hint: string
  own: string
  words: string[]
}[] = [
  {
    place: 'content',
    label: key('Note font'),
    hint: key('The face notes are written in; any font installed here, by its name.'),
    own: 'iA Writer Quattro',
    words: ['writing', 'text', 'serif'],
  },
  {
    place: 'ui',
    label: key('Interface font'),
    hint: key('The face of menus, lists and settings; any font installed here, by its name.'),
    own: 'Geist',
    words: ['ui', 'menus', 'sidebar'],
  },
  {
    place: 'mono',
    label: key('Code font'),
    hint: key('The face of code and terminals; any monospaced font installed here, by its name.'),
    own: 'iA Writer Mono S',
    words: ['monospace', 'code', 'terminal'],
  },
]

function asChoice(value: string): SchemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system'
}

function themeField(setting: ThemeSetting, owner = theme.id): Field {
  const label = t(setting.label)
  const worn = () => owner === theme.id
  const drawer = setting.shared === true ? SHARED : owner
  const get = () => (worn() ? theme.values[setting.id] : theme.keptFor(drawer, setting.id))
  const put = (value: ThemeValue) =>
    worn() ? theme.set(setting.id, value) : theme.setFor(drawer, setting.id, value)
  const common = {
    label,
    hint: t(setting.hint),
    initial: setting.initial,
    key: drawer === SHARED ? `appearance.${setting.id}` : `themes.${owner}.${setting.id}`,
    store: {
      on: theme,
      name: 'chosen',
      take: (whole: unknown) => (whole as ChosenSettings)[drawer]?.[setting.id],
      put: (whole: unknown, value: unknown) => {
        const chosen = whole as ChosenSettings
        return { ...chosen, [drawer]: { ...chosen[drawer], [setting.id]: value as ThemeValue } }
      },
    },
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
        label: t(one.name),
        colour: one[theme.current],
      })),
      initial: setting.initial,
      get: () => String(get() ?? setting.initial),
      set: put,
    }
  }

  const options = setting.options.map((one) => ({
    value: one.value,
    label: t(one.label),
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
    label: t(SCHEME_NAMES[scheme]),
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
    label: t('Picture'),
    hint: t(
      'The picture behind the window, one for light and one for dark; drag it to move its centre.',
    ),
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
    label: t('Appearance'),
    groups: [
      {
        title: t('Theme'),
        fields: [
          {
            kind: 'select',
            key: 'appearance.style',
            store: { on: theme, name: 'id' },
            open: true,
            label: t('Style'),
            hint: t('The theme Orden is drawn in.'),
            words: ['theme', 'look'],
            options: theme.all.map((one) => ({ value: one.id, label: t(one.name) })),
            get: () => theme.id,
            set: (value) => theme.select(value),
          },
          {
            kind: 'segmented',
            key: 'appearance.mode',
            store: { on: theme, name: 'scheme' },
            label: t('Mode'),
            hint: t('Light, dark, or whichever the system is in.'),
            words: ['dark', 'light', 'night', 'theme'],
            options: SCHEME_CHOICES.map((one) => ({
              value: one,
              label: t(SCHEME_NAMES[one]),
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
              title: t(theme.active.name),
              fields: [...(theme.id === WALLPAPER_THEME ? [pictureField()] : []), ...ownFields()],
            },
          ]
        : []),

      {
        title: t('Fonts'),
        fields: FONT_FIELDS.map((one): Field => ({
          kind: 'text',
          key: `appearance.${one.place}Font`,
          store: part(modes, 'fonts', one.place),
          label: t(one.label),
          words: ['font', 'typeface', 'family', 'custom font', ...one.words],
          hint: t(one.hint),
          placeholder: one.own,
          font: { mono: one.place === 'mono' },
          initial: '',
          get: () => modes.fonts[one.place],
          set: (value) => modes.setFont(one.place, value),
        })),
      },

      {
        title: t('File list'),
        fields: [
          {
            kind: 'segmented',
            key: 'appearance.essentials',
            store: { on: workspace.device, name: 'essentialTiles' },
            label: t('Essentials'),
            hint: t(
              'Whether the bookmarks at the top of the file list show as tiles or as a list.',
            ),
            words: ['bookmarks', t('Bookmarks'), 'favorites', 'pinned', 'tiles', 'grid', 'list'],
            options: [
              { value: 'tiles', label: t('Grid') },
              { value: 'list', label: t('List') },
            ],
            initial: 'tiles',
            get: () => (workspace.device.essentialTiles ? 'tiles' : 'list'),
            set: (value) => workspace.device.showEssentialTiles(value !== 'list'),
          },
        ],
      },

      ...(isMobile
        ? []
        : ([
            {
              title: t('Sidebars'),
              fields: [
                {
                  kind: 'switch',
                  key: 'appearance.sideTogglesInside',
                  store: { on: sideToggles, name: 'inside' },
                  label: t('Sidebar toggles inside the sidebars'),
                  hint: t(
                    'Each sidebar’s toggle sits in the sidebar, and the right sidebar comes out at its edge of the window.',
                  ),
                  words: ['sidebar', 'toggle', 'button', 'title bar', 'edge', 'hover', 'peek'],
                  initial: false,
                  get: () => sideToggles.inside,
                  set: (on) => sideToggles.set(on),
                },
              ],
            },
          ] satisfies Group[])),

      {
        title: t('Pointer'),
        fields: [
          {
            kind: 'switch',
            key: 'appearance.pointingHand',
            store: { on: modes, name: 'hand' },
            label: t('Pointing hand on buttons'),
            hint: t('Shows a pointing hand over buttons, as web pages do.'),
            words: ['cursor', 'mouse', 'hand', 'click'],
            initial: DEFAULTS.hand,
            get: () => modes.hand,
            set: () => modes.toggleHand(),
          },
          {
            kind: 'switch',
            key: 'appearance.paneFollowsPointer',
            store: { on: workspace.device, name: 'paneFollowsPointer' },
            label: t('Active pane follows the pointer'),
            hint: t('The pane under the pointer becomes the one you work in.'),
            words: ['pane', 'split', 'focus follows mouse', 'hover', 'mouse', 'active'],
            initial: true,
            get: () => workspace.device.paneFollowsPointer,
            set: (on) => workspace.device.followPointer(on),
          },
        ],
      },

      {
        title: t('Tabs'),
        fields: [
          {
            kind: 'switch',
            key: 'appearance.overviewBlur',
            store: { on: modes, name: 'overviewBlur' },
            label: t('Blur the app behind the tab overview'),
            hint: t('Shows the app blurred behind the windows, instead of Orden’s own background.'),
            words: ['overview', 'alt alt', 'blur', 'background', 'windows'],
            initial: DEFAULTS.overviewBlur,
            get: () => modes.overviewBlur,
            set: () => modes.toggleOverviewBlur(),
          },
        ],
      },

      ...(isDesktop
        ? ([
            {
              title: t('Window'),
              fields: [
                {
                  kind: 'segmented',
                  key: 'appearance.frame',
                  store: { on: modes, name: 'frame' },
                  label: t('Frame'),
                  hint: t('Orden’s own title bar, or the window frame of your system.'),
                  words: ['title bar', 'window'],
                  options: [
                    { value: 'nib', label: t('Orden’s own') },
                    { value: 'system', label: t('The system’s') },
                  ],
                  initial: DEFAULTS.frame,
                  get: () => modes.frame,
                  set: (value) => modes.setFrame(value),
                },
                {
                  kind: 'switch',
                  key: 'appearance.flushBottom',
                  store: { on: modes, name: 'flushBottom' },
                  label: t('Square bottom edge'),
                  hint: t(
                    'What is open runs into the bottom of the window with square corners; in a split, the panes that touch it.',
                  ),
                  words: ['corners', 'rounded', 'square', 'bottom', 'edge', 'card', 'gap', 'flush'],
                  initial: DEFAULTS.flushBottom,
                  get: () => modes.flushBottom,
                  set: () => modes.toggleFlushBottom(),
                },
                ...(zooms
                  ? ([
                      {
                        kind: 'select',
                        label: t('Zoom'),
                        hint: t('How large all of Orden is drawn on this device.'),
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
