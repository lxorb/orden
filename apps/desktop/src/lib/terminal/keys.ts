/** Which keys a terminal hands to the app, and which to the shell.
 *
 *  A shell reads nearly every chord there is: Ctrl+W deletes a word, Ctrl+N and Ctrl+P
 *  walk the history, Ctrl+R searches it, Ctrl+T swaps two letters, Ctrl+O runs a line
 *  again, Ctrl+D ends the input. A terminal that let the app have those would be a
 *  terminal nobody could type in. So everything goes to the shell except a short list - the one VS Code
 *  keeps for its workbench, checked against its own `DEFAULT_COMMANDS_TO_SKIP_SHELL`:
 *
 *  - the tab and window keys: Ctrl+Shift+T, Ctrl+Tab, Ctrl+PageUp and PageDown with
 *    and without Shift, the numbered tabs;
 *  - the palette on Ctrl+Shift+P, and on whichever keys a keyboard gives it
 *    instead, the settings on Ctrl+comma, full screen, and the tab filling the window;
 *  - F6 and Shift+F6, which is how a keyboard leaves the terminal for the rest of the
 *    window - Tab cannot be, the shell completes with it;
 *  - the panes, on Ctrl+Alt and an arrow;
 *  - every other app command on Ctrl+Shift, since a terminal cannot tell Ctrl+Shift+E
 *    from Ctrl+E and no shell has one on it - except Ctrl+Shift+W, which is Close
 *    window here and Close tab in every terminal there is: sent to neither, it deletes
 *    a word, which loses nothing;
 *  - on a Mac, every app command on Cmd, which no shell ever sees.
 *
 *  **Every app command on a key the shell reads is both**, and the terminal asks once
 *  which one is meant (Emil, issues #213 and #426): Ctrl+T, a new tab and the shell's
 *  swapped letters; Ctrl+N, the scratchpad and the next line of history; Ctrl+Space,
 *  the space switcher and Emacs's mark; Ctrl+W, closing the tab and deleting a word; and
 *  whichever other command sits - by default or because somebody put it there in
 *  Settings - on Ctrl and a letter, Ctrl+Space, or another key that types a control
 *  character (`shellReads`). Pressed in a terminal with nothing chosen yet, a small
 *  question puts the two side by side, and the answer is kept, per command, for every
 *  terminal from then on unless "Always ask" was ticked; Settings, General, Terminal
 *  lists each answer and takes it back. **Ctrl+C is the interrupt**, always, and never
 *  asked about. And a command put on any other key the program in the terminal reads -
 *  a function key, which htop and mc are worked with, Alt and an arrow - is asked about
 *  the same way rather than given to the program unasked. A key no shell reads -
 *  Ctrl+Shift, Ctrl+Alt and an arrow, Cmd on a Mac - is the app's, as below. See
 *  two-ways.ts.
 *
 *  Before #426 the keys asked about were a list of two, and Ctrl+W went to the shell
 *  without a question, as it does in VS Code and Windows Terminal: a half-typed command
 *  losing its tab to a word deleted is the worst trade there is - which is why it is a
 *  question now rather than the app's. Cmd+W closes the tab on a Mac.
 *
 *  The terminal's own: copying with Ctrl+Shift+C (Cmd+C on a Mac; Ctrl+C is always the
 *  interrupt), pasting with Ctrl+Shift+V, Shift+Insert, Ctrl+V on Windows as Windows
 *  Terminal does, Cmd+V on a Mac; Ctrl+F to find, as VS Code does; the zoom keys, which
 *  size the terminal's type the way they size a note's; and on a Mac Cmd+A and Cmd+K,
 *  Terminal's own select all and clear.
 *
 *  **Alt and a letter is the shell's** - ESC and the letter, as every terminal sends it,
 *  and on Windows ConPTY hands it to the program as the Alt chord Windows Terminal's would
 *  be - so Claude Code's Alt+V pastes an image in a local terminal as it does there. Only
 *  Alt and a digit, the tabs by number, is the app's. In a terminal on another machine
 *  the image key brings this computer's picture over instead (`imageKey`, images.ts).
 *
 *  AltGr is never a chord. Windows says it as Ctrl and Alt, and it is how half of
 *  Europe types `@`, `{` and `\` - so Ctrl and Alt with a key that came out as anything
 *  but its own letter or digit is typing.
 *
 *  Pure: the keystroke, the platform and the app command it matched, if any, which the
 *  caller asks the registry for. See docs/keyboard.md for the list as a reader sees it. */

import type { Platform } from '../keys'

/** Where a keystroke goes. */
export type Route =
  | 'shell'
  | 'app'
  | 'ask'
  | 'copy'
  | 'paste'
  | 'find'
  | 'select-all'
  | 'clear'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

/** The keystroke, as much of it as the answer needs. */
export interface Keystroke {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The app's commands a terminal gives way to on any platform. */
const APP_KEYS = new Set([
  'app.reopen',
  'app.new-window',
  'app.next-note',
  'app.previous-note',
  'app.next-note.alt',
  'app.previous-note.alt',
  'app.move-tab-left',
  'app.move-tab-right',
  'app.palette',
  'app.palette.alt',
  'app.commands',
  'app.commands.alt',
  'app.settings',
  'app.fullscreen',
  'app.fill-tab',
  'app.region-next',
  'app.region-previous',
])

/** Sent to nobody: see the top of this file. */
const NEITHER = new Set(['app.close-window'])

const ZOOM: Record<string, Route> = {
  'app.zoom-in': 'zoom-in',
  'app.zoom-out': 'zoom-out',
  'app.zoom-reset': 'zoom-reset',
}

/** Where a key pressed in a terminal goes. `command` is the app command the keystroke
 *  matches, if any; `finds` whether it is the find key. */
export function routeKey(
  event: Keystroke,
  platform: Platform,
  command: string | null,
  finds: boolean,
): Route {
  const mac = platform === 'mac'
  const only = (ctrl: boolean, shift: boolean, meta = false) =>
    event.ctrlKey === ctrl && event.shiftKey === shift && event.metaKey === meta && !event.altKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  // AltGr, whatever it types. A letter or a digit that comes out as itself was not
  // typed with AltGr but chorded with Ctrl and Alt: the numbered tabs, a pane.
  if (!mac && event.ctrlKey && event.altKey && /^[^a-z0-9]$/i.test(event.key)) return 'shell'

  if (mac) {
    if (only(false, false, true) && key === 'c') return 'copy'
    if (only(false, false, true) && key === 'v') return 'paste'
    if (only(false, false, true) && key === 'a') return 'select-all'
    if (only(false, false, true) && key === 'k') return 'clear'
  } else {
    if (only(true, true) && key === 'c') return 'copy'
    if (only(true, true) && key === 'v') return 'paste'
    if (only(false, true) && key === 'Insert') return 'paste'
    if (platform === 'win' && only(true, false) && key === 'v') return 'paste'
    if (only(true, true) && key === 'a') return 'select-all'
  }

  if (finds) return 'find'
  if (command === null) return 'shell'

  const zoom = ZOOM[command]
  if (zoom) return zoom
  if (NEITHER.has(command)) return 'shell'
  // A key the shell reads as a character of its own, which an app command is on as well:
  // asked about, once. Ctrl+C is the interrupt whatever is on it.
  if (shellReads(event)) return key === 'c' ? 'shell' : 'ask'
  if (APP_KEYS.has(command) || command.startsWith('app.note-')) return 'app'
  // The panes, on Ctrl+Alt and an arrow: a named key, so never AltGr typing anything.
  if (!mac && event.ctrlKey && event.altKey) return 'app'
  if (mac && event.metaKey) return 'app'
  if (!mac && event.ctrlKey && event.shiftKey) return 'app'

  // Any other key an app command is on is one the program in the terminal reads too: a
  // function key htop and mc are worked with, Alt and an arrow a shell moves a word with,
  // wherever somebody put the command. Asked about, once, like a control character.
  return 'ask'
}

/** The arrows, Home and End, and F1 to F4, which xterm ends with a letter. */
const LETTERED: Readonly<Record<string, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
  F1: 'P',
  F2: 'Q',
  F3: 'R',
  F4: 'S',
}

/** Which of those xterm sends as CSI rather than SS3 with nothing held. */
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Home', 'End'])

/** The keys xterm ends with a number and a tilde. */
const NUMBERED: Readonly<Record<string, number>> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
}

/** What the program in a terminal would have read for a key, typed once it has been
 *  answered for the shell: xterm's sequences, with the modifiers as xterm numbers them
 *  (1, plus Shift 1, Alt 2, Ctrl 4). Null for a key that types nothing. */
export function typedBy(event: Keystroke): string | null {
  const held = 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0)
  const said = held > 1 ? `1;${String(held)}` : ''
  const lettered = LETTERED[event.key]
  if (lettered) {
    if (held > 1) return `\x1b[${said}${lettered}`
    return `${ARROWS.has(event.key) ? '\x1b[' : '\x1bO'}${lettered}`
  }
  const numbered = NUMBERED[event.key]
  if (numbered) return `\x1b[${String(numbered)}${held > 1 ? `;${String(held)}` : ''}~`
  if (shellReads(event)) return controlOf(event.key)
  if (event.key.length !== 1) return null
  return event.altKey ? `\x1b${event.key}` : event.key
}

/** Whether a key is the one a coding agent pastes a picture from the clipboard with:
 *  Claude Code's Alt+V on Windows, and Ctrl+V on Linux and a Mac, where Ctrl+V is the
 *  shell's (on Windows it is the terminal's own paste, which brings a picture over by
 *  itself; see images.ts). Alt+V on Linux too, for a hand used to Windows. Not Option+V on
 *  a Mac, which types a character. */
export function imageKey(event: Keystroke, platform: Platform): boolean {
  if (event.key.toLowerCase() !== 'v' || event.shiftKey || event.metaKey) return false
  if (event.altKey && !event.ctrlKey) return platform !== 'mac'
  return event.ctrlKey && !event.altKey && platform !== 'win'
}

/** What the image key types where nothing is brought over: what xterm.js would have
 *  sent for it - ESC and the letter for Alt, the control character for Ctrl. */
export function imageKeyTyped(event: Keystroke): string {
  return event.altKey ? '\x1bv' : controlOf('v')
}

/** The control characters Ctrl types with a key that is not a letter, as xterm.js sends
 *  them: NUL on Ctrl+Space and Ctrl+2, ESC on Ctrl+[ and Ctrl+3, and on along the row to
 *  US on Ctrl+/ and Ctrl+7, and DEL on Ctrl+8. Ctrl and the minus, the equals and the
 *  nought are the type's size, and never reach here. */
const CONTROLS: Readonly<Record<string, string>> = {
  ' ': '\x00',
  '2': '\x00',
  '[': '\x1b',
  '3': '\x1b',
  '\\': '\x1c',
  '4': '\x1c',
  ']': '\x1d',
  '5': '\x1d',
  '6': '\x1e',
  '/': '\x1f',
  '7': '\x1f',
  '8': '\x7f',
}

/** Whether a chord is one a shell reads as a character of its own: Ctrl and a letter,
 *  Ctrl+Space, or Ctrl and another key that types a control character (`CONTROLS`), and
 *  nothing else held. Anything else an app command is on is a chord no shell has. */
export function shellReads(event: Keystroke): boolean {
  const bare = !event.shiftKey && !event.altKey && !event.metaKey
  return event.ctrlKey && bare && (/^[a-z]$/i.test(event.key) || event.key in CONTROLS)
}

/** The character a key the shell reads types with Ctrl, which is what the shell would
 *  have read had the terminal not asked first: Ctrl+T is DC4, Ctrl+N is SO, Ctrl+Space
 *  is NUL. */
export function controlOf(key: string): string {
  const control = CONTROLS[key]
  if (control !== undefined) return control
  return String.fromCharCode(key.toLowerCase().charCodeAt(0) - 96)
}
