/** A task item, as a line of markdown says it is.
 *
 *  `- [ ] buy milk` and `- [x] buy milk`, in every marker a list is written with:
 *  the three bullets and the two ways a number is followed. What is inside the
 *  brackets decides the state, and the rule is the checkbox's own: a space is not
 *  done and anything else is. That takes in the marks Obsidian's themes give a
 *  task of their own - `[-]` for cancelled, `[/]` for started - all of which mean
 *  a task nobody is waiting on any more, which is what "done" is for here.
 *
 *  One reading, in the package both sides already have, because three surfaces ask
 *  the same question of the same line: the key that ticks a box, the space search's
 *  `task:` operator, and a row of results with a live box in it. The Rust side asks
 *  it too; see tasks.rs, and the tests that hold the two to the same answers. */

/** The marker, the box, and the state. Offsets are from the start of the line. */
export interface TaskItem {
  /** Where the `[` sits, so a tick can write one character and nothing else. */
  box: number
  /** What is between the brackets, as written. */
  mark: string
  /** Whether the box counts as ticked: anything but a space does. */
  done: boolean
  /** How much of the line is the marker, `- [x] ` and its indentation included,
   *  which is where the task's own words start. */
  marker: number
  /** How far the line is indented, for a marker that is being taken off. */
  indent: number
}

/** A list marker, a box with one character in it, and either a space after the
 *  box or the end of the line - because `- [ ]` with nothing written yet is a task
 *  somebody is about to write. */
const TASK = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])([ \t]+)\[(.)\](?:[ \t]+|$)/

/** The task this line is, or null for a line that is not one. */
export function taskAt(line: string): TaskItem | null {
  const found = TASK.exec(line)
  const [whole, indent, gap, mark] = found ?? []
  if (whole === undefined || indent === undefined || gap === undefined || mark === undefined) {
    return null
  }

  return {
    box: whole.indexOf('[', indent.length + gap.length),
    mark,
    done: mark !== ' ',
    marker: whole.length,
    indent: indent.length,
  }
}

/** The line with its box the other way round. Null where there is no box, so a
 *  caller can tell "nothing to tick" from "ticked". */
export function taskToggled(line: string): string | null {
  const task = taskAt(line)
  if (!task) return null

  return line.slice(0, task.box + 1) + (task.done ? ' ' : 'x') + line.slice(task.box + 2)
}
