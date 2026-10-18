/** Whether a space is an Obsidian vault: `.obsidian` at its root, which Obsidian makes
 *  with its settings in it the first time it opens a folder. In a vault a task's `📅` is
 *  the Tasks plugin's due date, a deadline; in a space of nib's own it is a start date
 *  (#371, `@nib/markdown/task-dates`).
 *
 *  Asked of the files Obsidian always writes there, by whether they are there - nothing
 *  in the app lists a hidden folder - once per root, and answered no where none can be read: the
 *  web app's spaces, a space nib made. */

import { invoke, joinPath } from '../tauri'

/** What Obsidian writes into `.obsidian` of every vault it opens. */
const SETTINGS = ['app.json', 'workspace.json', 'core-plugins.json']

const asked = new Map<string, Promise<boolean>>()

export function isVault(root: string): Promise<boolean> {
  let found = asked.get(root)
  if (!found) {
    // A stamp rather than the words: nothing in it is read, only whether it is there.
    found = Promise.all(
      SETTINGS.map((name) =>
        invoke<unknown>('file_stamp', { path: joinPath(root, `.obsidian/${name}`) }).catch(
          () => null,
        ),
      ),
    ).then((stamps) => stamps.some((stamp) => stamp !== null && stamp !== undefined))
    asked.set(root, found)
  }
  return found
}
