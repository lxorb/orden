/** A setting's extension, built once for each value the setting can take.
 *
 *  Every mode lives in a compartment, and a compartment handed the value it
 *  already holds is a reconfiguration that changes nothing. Handed an equal
 *  value built freshly, it is a reconfiguration that throws work away: the
 *  language is the loud case, because a second `markdown()` is a different
 *  parser as far as @codemirror/language is concerned, so it drops the parse of
 *  the whole document and starts again from the top of it - and every decoration
 *  built off the tree is blank until the parse catches up. That showed as a note
 *  going raw for a frame at a time while a pane was being resized, since a
 *  resize re-applies the modes to every editor on the page.
 *
 *  So a mode nobody changed costs nothing to apply again, and applying all of
 *  them is something the app may do as often as it likes. */

export function once<T extends string | boolean, E>(build: (value: T) => E): (value: T) => E {
  const made = new Map<T, E>()

  return (value) => {
    let built = made.get(value)
    if (built === undefined) {
      built = build(value)
      made.set(value, built)
    }
    return built
  }
}
