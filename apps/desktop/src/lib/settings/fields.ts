import type { IconNode } from 'lucide'

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
  /** One plain sentence about what the setting does, shown behind a small `i`
   *  beside the label. For the settings whose name only means something to
   *  somebody who already knows the word; one that explains itself has none, and
   *  shows no glyph at all. */
  hint?: string
  /** A drawing before the name, for a row about a thing that has one: a kind of tab in
   *  Note types wears the mark its cards and its files wear. */
  icon?: IconNode
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
