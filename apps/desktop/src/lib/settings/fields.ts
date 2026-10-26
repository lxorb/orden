import type { IconNode } from 'lucide'
import type { Store } from './hold'

/** One side's picture in the wallpaper's row; see the `picture` kind. */
export interface PictureSide {
  /** What a pointer resting on it says: the side's name. */
  label: string
  /** The side the app is in now, which wears the ring. */
  current: boolean
  /** A `data:` address, or nothing for the theme's own field. */
  picture(): string
  /** Whether this side has a picture of its own rather than the other side's. */
  own(): boolean
  /** Where the picture's focal point is, as two fractions. */
  focus(): [number, number]
  choose(): void
  remove(): void
  /** The focal point moved; `kept` once the drag lets go. */
  place(x: number, y: number, kept: boolean): void
}

/** What every control has, whatever kind it is. */
interface Common {
  label: string
  /** Other words somebody might look for it by: `font` for the text size, `dark`
   *  and `theme` for the mode. Searched, never shown, so they are the English ones a
   *  hand types into any search box; the label and the choices are searched in the
   *  reader's own language. The settings' own box and the palette both read them;
   *  see settings-search.ts and palette/settings.ts. */
  words?: string[]
  /** One plain sentence about what the setting does, shown behind a small `?`
   *  beside the label (#768). Every setting has one: a name says what is set, and
   *  only a sentence says what setting it does - Memory saver names a thing, and
   *  nobody who has not met it knows what it puts to sleep. Required rather than
   *  optional, so a setting added later cannot come without one. */
  hint: string
  /** A drawing before the name, for a row about a thing that has one: a kind of tab in
   *  Note types wears the mark its cards and its files wear. */
  icon?: IconNode
  /** The name the settings file sets it by, `pane.setting` (#673): what a NixOS
   *  configuration declares through Home Manager's `programs.orden.settings`. Only for
   *  a setting that means the same on every machine a configuration is for; the file's
   *  schema is made from these, see file-schema.ts. Never renamed once released: a
   *  configuration out there names it. */
  key?: string
  /** For a switch that is one member of a list the file sets whole - the languages
   *  spelling is checked in - the value it stands for; the file's `key` is then a list,
   *  and the switch is on where the list has it. */
  member?: string
  /** Where the value is kept, which is where the settings file holds it (see hold.ts):
   *  every keyed field says, so that nothing else that writes the store moves it. */
  store?: Store
  /** How the settings file's value is put in force, where that is not `set`: Hardware
   *  acceleration, which the crate reads from the file itself before the engine starts,
   *  so the row is only told, and nothing asks for a restart. */
  declare?: (value: never) => void
  /** Why a value the file gives is not one this setting takes, beyond its type and its
   *  choices: a key combination that is not one. Null where it is. */
  check?: (value: string) => string | null
  /** Set by the settings file rather than here: that file's path. The row shows the
   *  value and says where it comes from, and its control does nothing; see
   *  file.ts. */
  declared?: string
}

/** One colour among a row of them, drawn as the colour itself. The only control
 *  in the app whose options are not words: naming nine shades would be nine
 *  words saying what nine squares already say. */
export interface SwatchOption {
  value: string
  /** What a pointer resting on it says, and what a screen reader is told - the
   *  one place the colour does have to be a word. */
  label: string
  /** The colour to paint it, in the scheme the app is in. */
  colour: string
}

/** A row's two colours of the reader's own: the two its value shows as now, whether
 *  they are the reader's own rather than a swatch's, and two picked - tried while the
 *  picker is open, kept when it closes. */
export interface PairField {
  get(): readonly [string, string]
  own(): boolean
  preview(first: string, second: string): void
  set(first: string, second: string): void
}

/** One choice among a few, drawn as a row rather than opened as a list. Only
 *  where the choices are two or three short words worth seeing at once. */
export interface Segment {
  value: string
  label: string
  /** Set where the choice cannot be honoured right now - a scheme the theme in
   *  force does not have. Shown as the app shows anything disabled. */
  disabled?: boolean
}

/** One control, and how to read and write whatever sits behind it. A field
 *  that says what it starts as can be put back to that; a pane whose fields
 *  all can offers a reset. */
export type Field = Common &
  (
    | {
        kind: 'switch'
        initial?: boolean
        /** Out of anybody's hands right now: the last kind of tab still offered, which
         *  cannot be turned off. Drawn faded, and a press does nothing. */
        locked?: () => boolean
        get(): boolean
        set(on: boolean): void
      }
    | {
        kind: 'slider'
        min: number
        max: number
        step: number
        unit?: string
        initial?: number
        /** The least the dial may be turned to now; see `least` in themes/settings.ts. */
        least?: () => number
        get(): number
        /** Shown while the knob is dragged and kept nowhere; `set` is letting go. A
         *  slider without one keeps every position it passes. */
        preview?(value: number): void
        set(value: number): void
      }
    | {
        kind: 'select'
        /** `note` is one thing worth knowing about that choice before it is made,
         *  drawn as a footnote mark against the name; see Select.svelte. */
        options: { value: string; label: string; note?: string }[]
        /** The options are what this machine has - its shells, the themes installed -
         *  so a settings file may name one that is not among them yet. */
        open?: boolean
        initial?: string
        get(): string
        set(value: string): void
      }
    | {
        kind: 'segmented'
        options: Segment[]
        initial?: string
        get(): string
        set(value: string): void
      }
    /** A row of colours. Only ever a theme setting: a colour is one of the four
     *  things a theme may offer, and the accent is the app's own. */
    | {
        kind: 'swatches'
        options: SwatchOption[]
        initial?: string
        get(): string
        set(value: string): void
        /** Two colours of the reader's own after the swatches, each a dot that opens
         *  the platform's colour picker: glass's pair. */
        pair?: PairField
      }
    /** The pictures somebody chose: a thumbnail per side of the theme, which opens
     *  the file chooser when pressed and moves the picture's focal point when dragged,
     *  and a cross on one that has a picture of its own. Only the wallpaper's. */
    | {
        kind: 'picture'
        /** Left out: a picture somebody chose is not a default a reset puts back. */
        initial?: string
        /** The picture the side in force wears, as a `data:` address or nothing; `set('')`
         *  takes it away. What a row that is only read - a search, the glasses - sees. */
        get(): string
        set(value: string): void
        sides: PictureSide[]
      }
    /** A value the app says rather than one somebody sets - the version this is - and
     *  a press copies it. Nothing to put back, so it has no `initial` and a pane's
     *  reset passes over it. */
    | {
        kind: 'value'
        initial?: undefined
        get(): string
        press(): void
      }
    /** A line somebody types. Only where nothing else will do - a spoken command's
     *  own phrase, a page's margin - and never on the glasses, which have nothing to
     *  type with. */
    | {
        kind: 'text'
        /** What it says with nobody having typed anything, which for a phrase is the
         *  phrase the app already answers to. An empty field is that put back. */
        placeholder: string
        /** Written as it is typed rather than when the field is left.
         *
         *  The page setup is the one that wants this: the margin and the running text
         *  are read by an export the reader may start from the row of buttons under
         *  the very same card, without the field ever losing focus. A phrase the app
         *  answers to is the other way round - half a word is a phrase that matches
         *  nothing, so it waits. */
        live?: boolean
        /** A face's name, picked from the families installed or typed (#772): drawn as
         *  a combobox that lists them, the monospaced ones first for code; see
         *  FontPicker.svelte. */
        font?: { mono: boolean }
        initial?: string
        get(): string
        set(value: string): void
      }
  )

/** A line under a card, for what no control on it can say about itself. Its own
 *  words where there is nothing to open, and a link where there is: the language
 *  row says a catalogue was machine-written and where a correction goes. */
export interface Caption {
  text: string
  url?: string
}

export interface Group {
  title: string
  caption?: Caption
  fields: Field[]
}

/** The panes that are only about settings. The account and the LLM connector are
 *  their own thing and stay written out by hand. */
type PaneId =
  'general' | 'editor' | 'kinds' | 'spelling' | 'markdown' | 'appearance' | 'glasses' | 'export'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}
