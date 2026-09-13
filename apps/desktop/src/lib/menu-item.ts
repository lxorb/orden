/** One row of a menu, wherever the menu is.
 *
 *  A row's own menu, the app menu, the palette: three lists of the same thing, and
 *  each had written down what one of its rows is. The three shapes had the same
 *  five fields between them - `danger` in one, `checked` in the other two - and the
 *  app menu already relied on their being the same, because it passes an export row
 *  out of the palette's registry straight through as a row of its own. A shape two
 *  lists share by coincidence is a shape that drifts; this is the one they share on
 *  purpose.
 *
 *  What a row *draws* is still each list's own, and deliberately: a shortcut is a
 *  `kbd` in the palette and a word in the app menu, the app menu keeps a tick slot
 *  in every row so its labels line up and a row's own menu keeps none, and the
 *  three walk their rows with different keys. This is the vocabulary, not the
 *  drawing.
 *
 *  No runes and no imports, so every one of them can read it. */

export interface MenuItem {
  label: string
  /** Undefined where nothing is bound to it. `shortcuts.hint` answers undefined
   *  for an unbound command, so undefined is a real value here. */
  hint?: string | undefined
  /** Whether this row is the one already in force: the theme in use, the accent it
   *  is drawn in. Drawn as a tick by the lists that keep room for one. */
  checked?: boolean
  /** Whether running it takes something away. Drawn in the danger colour by the
   *  lists that have rows which do. */
  danger?: boolean
  disabled?: boolean
  // A property rather than a method, so a caller may hand the function on - which
  // is how an export row reaches the app menu.
  run: () => void
}

/** A rule between groups of rows. Nothing to land on, and nothing to draw but a
 *  line; every list that has groups steps over it. */
export const DIVIDER = null

/** A row, or the rule between groups. */
export type MenuEntry = MenuItem | typeof DIVIDER
