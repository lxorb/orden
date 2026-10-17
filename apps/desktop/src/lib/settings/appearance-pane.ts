import { t } from '../i18n.svelte'
import { DEFAULTS, modes } from '../modes.svelte'
import { isDesktop } from '../tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from '../schemes'
import { type SchemeChoice, theme } from '../theme.svelte'
import type { ThemeSetting } from '../themes/settings'
import { WALLPAPER_THEME } from '../wallpaper/held'
import { wallpaper } from '../wallpaper/wallpaper.svelte'
import { workspace } from '../workspace.svelte'
import type { PictureSide, PairField, Field, Group, Pane } from './fields'

/** A control hands its value back as a string, because that is what a control
 *  holds. Following the system is what anything else reads as. */
function asChoice(value: string): SchemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system'
}

/** One of the theme's own settings, as a row of the pane.
 *
 *  The whole of what Appearance knows about what a theme offers. A theme declares
 *  a kind and the app already has a control for each: a colour is a row of
 *  swatches, a number in a range is the dial every other measurement in the app
 *  uses, a switch is a switch, and a choice of two or three short words is the
 *  segmented control - past three it is a dropdown, because a row of six words is
 *  a row nobody can read at a glance.
 *
 *  The label goes through `t()` on its way in: a theme the app ships with declares
 *  words the catalogues carry, and a theme file declares its author's own, which
 *  `t()` hands back unchanged. */
function themeField(setting: ThemeSetting): Field {
  const label = t(setting.label)
  const get = () => theme.values[setting.id]
  const common = { label, initial: setting.initial }

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
      set: (value) => theme.set(setting.id, value),
    }
  }

  if (setting.kind === 'switch') {
    return {
      ...common,
      kind: 'switch',
      initial: setting.initial,
      get: () => get() === true,
      set: (on) => theme.set(setting.id, on),
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
      set: (value) => theme.set(setting.id, value),
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
    set: (value) => theme.set(setting.id, value),
  }
}

/** The wallpaper's pictures, light first: the side the app is not in shows what it
 *  would wear, which is this side's picture until it is given one of its own. */
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
    words: ['wallpaper', 'background', 'image', 'photo', 'focal point'],
    get: () => wallpaper.of(theme.current)?.picture ?? '',
    set: (value) => {
      if (!value) wallpaper.clear(theme.current)
    },
    sides,
  }
}

/** A built-in theme's own rows that are there right now. */
function ownFields(): Field[] {
  return theme.settings.filter((one) => one.own === true && (one.when?.() ?? true)).map(themeField)
}

/** Settings › Appearance; see `preferences` in ../preferences.ts. */
export function appearancePane(): Pane {
  return {
    id: 'appearance',
    label: t('Appearance'),
    groups: [
      {
        title: t('Theme'),
        fields: [
          {
            // The theme, and nothing else. A theme has a dark side or a light
            // one or both; which of them the app is showing is the row below.
            //
            // Named for what it picks rather than for the group it is in: the
            // group is the theme and both rows are about it, so a row called
            // Theme under a heading called Theme read as "Theme / Theme / Mode"
            // and said nothing about which of the two was which. This one picks
            // the look - the palette and the type a theme sets - and the one
            // below picks which side of it the app is showing.
            kind: 'select',
            label: t('Style'),
            words: ['theme', 'look'],
            options: theme.all.map((one) => ({ value: one.id, label: t(one.name) })),
            get: () => theme.id,
            set: (value) => theme.select(value),
          },
          {
            // Following the system is where everybody starts and the only one
            // of the three that changes with the hour, so it stays a segment
            // of its own rather than being something to arrive back at.
            //
            // Neither row says what it started as, so the pane offers no reset:
            // a look chosen from a gallery is not a default anybody drifted
            // away from, and the accent below is drawn by hand where a reset
            // could not reach it.
            kind: 'segmented',
            label: t('Mode'),
            words: ['dark', 'light', 'night', 'theme'],
            options: SCHEME_CHOICES.map((one) => ({
              value: one,
              label: t(SCHEME_NAMES[one]),
              disabled: !theme.offers(one),
            })),
            get: () => theme.shown,
            set: (value) => theme.setScheme(asChoice(value)),
          },
          // And whatever the theme in force offers of its own, under the two
          // rows that chose it and with no heading between: they are the
          // theme's, and where they sit is what says so. A theme with nothing
          // to offer adds nothing, so the group is the same two rows it has
          // always been. See themes/settings.ts.
          ...theme.settings.filter((one) => one.own !== true).map(themeField),
        ],
      },

      // A built-in's own dials - glass's material, the wallpaper's picture - in a
      // card of the theme's name: there are more of them than a row under Style can
      // carry, and the name is the heading they already have. The picture first,
      // which is what the wallpaper is about; the thumbnails are the pictures, so
      // the row needs no more words.
      ...(theme.settings.some((one) => one.own === true)
        ? [
            {
              title: t(theme.active.name),
              fields: [...(theme.id === WALLPAPER_THEME ? [pictureField()] : []), ...ownFields()],
            },
          ]
        : []),

      // The Essentials as Zen's grid of tiles, or as the list of names they were;
      // found by the word they went by before, in English and in the reader's own.
      {
        title: t('File list'),
        fields: [
          {
            kind: 'segmented',
            label: t('Essentials'),
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

      {
        title: t('Pointer'),
        fields: [
          {
            // A desktop app's arrow over its buttons, or a web page's hand. The
            // arrow stays the default; the Claude app offers the same switch.
            kind: 'switch',
            label: t('Pointing hand on buttons'),
            words: ['cursor', 'mouse', 'hand', 'click'],
            initial: DEFAULTS.hand,
            get: () => modes.hand,
            set: () => modes.toggleHand(),
          },
        ],
      },

      // The window itself: who draws its frame. Desktop only, because a browser tab
      // has none - and on a phone the system draws everything. Orden's own frame stays
      // the default: the bar it draws holds the menu, the sidebar toggle, the tabs
      // and the window's three buttons, and it is the shape the whole shell is
      // measured from. See appearance.rs.
      //
      // Whether the desk shows through the window is not here: that is the glass
      // theme, chosen under Style above. A row of its own was a switch that took the
      // window's ground away and showed next to nothing, since every surface painted
      // over the ground; see material.ts.
      ...(isDesktop
        ? ([
            {
              title: t('Window'),
              fields: [
                {
                  kind: 'segmented',
                  label: t('Frame'),
                  words: ['title bar', 'window'],
                  options: [
                    { value: 'nib', label: t('Orden’s own') },
                    { value: 'system', label: t('The system’s') },
                  ],
                  initial: DEFAULTS.frame,
                  get: () => modes.frame,
                  set: (value) => modes.setFrame(value),
                },
              ],
            },
          ] satisfies Group[])
        : []),
    ],
  }
}
