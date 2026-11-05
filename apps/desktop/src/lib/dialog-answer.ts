/** A file dialog an agent's command would open, answered by the path the agent gave
 *  instead of shown (#1078; docs/agent-native.md 8.14), as a VS Code extension's command
 *  takes a `Uri` where a person would be shown `showOpenDialog`.
 *
 *  The command sets one answer going; the next dialog takes it, once, and asks it for
 *  the path - which is where the crate says whether the agent may read or write there
 *  (`agents_dialog_path`). Null is a dialog put away. Nothing of this is loaded until a
 *  dialog is about to open or an agent runs a command with a path. */

/** Answers a dialog: the file to read (`write` false) or write, or null. */
export type DialogJudge = (write: boolean) => Promise<string | null>

let held: DialogJudge | null = null

/** The next file dialog is answered by `judge` instead of shown. */
export function answerNextDialog(judge: DialogJudge | null): void {
  held = judge
}

/** The answer waiting for this dialog, taken: null where somebody is to be shown it. */
export function dialogAnswer(): DialogJudge | null {
  const judge = held
  held = null
  return judge
}
