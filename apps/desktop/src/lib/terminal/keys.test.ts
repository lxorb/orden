import { describe, expect, test } from 'vitest'
import {
  controlOf,
  imageKey,
  imageKeyTyped,
  type Keystroke,
  routeKey,
  shellReads,
  typedBy,
} from './keys'

/** Which keys a terminal lets the app have: VS Code's split, checked against its own
 *  skip list. See keys.ts, and docs/keyboard.md for the list as a reader sees it. */

function press(key: string, held: Partial<Omit<Keystroke, 'key'>> = {}): Keystroke {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

const ctrl = { ctrlKey: true }
const ctrlShift = { ctrlKey: true, shiftKey: true }
const cmd = { metaKey: true }

describe('on Windows and Linux', () => {
  test.each(['win', 'linux'] as const)('the tab and window keys are the app’s (%s)', (platform) => {
    for (const [key, held, command] of [
      ['T', ctrlShift, 'app.reopen'],
      ['Tab', ctrl, 'app.next-note'],
      ['Tab', ctrlShift, 'app.previous-note'],
      ['PageDown', ctrl, 'app.next-note.alt'],
      ['PageUp', ctrlShift, 'app.move-tab-left'],
      ['P', ctrlShift, 'app.commands'],
      ['F6', {}, 'app.region-next'],
      ['F11', {}, 'app.fullscreen'],
      ['F11', { shiftKey: true }, 'app.fill-tab'],
      // The scratchpad's second key: Ctrl+Shift, which no shell has, so nothing to ask.
      ['X', ctrlShift, 'app.scratchpad.alt'],
      ['X', ctrlShift, 'app.scratchpad'],
      ['3', { altKey: true }, 'app.note-3.alt'],
      ['3', { ctrlKey: true, altKey: true }, 'app.note-3'],
      ['ArrowRight', { ctrlKey: true, altKey: true }, 'pane.split-right'],
      ['E', ctrlShift, 'app.files'],
      // Every pane's tab put down, where Ctrl+D alone is the shell's end of input: a shell
      // cannot tell the two apart, so the app losing it would gain the shell nothing.
      ['D', ctrlShift, 'app.deselect-all'],
      // The space switcher's second key: a shell reads Ctrl+Shift+Space as Ctrl+Space,
      // and the app's chord has the Shift.
      [' ', ctrlShift, 'space.switcher.alt'],
    ] as const) {
      expect(routeKey(press(key, held), platform, command, false), `${key} ${command}`).toBe('app')
    }
  })

  /** A key only a shell has is the shell's, and Ctrl+C is the interrupt whatever an app
   *  command might be on it. */
  test('a key nothing of the app is on is the shell’s, and Ctrl+C always is', () => {
    for (const [key, command] of [
      ['r', null],
      ['c', null],
      ['d', null],
      ['c', 'edit.copy'],
    ] as const) {
      expect(routeKey(press(key, ctrl), 'win', command, false), key).toBe('shell')
    }
    expect(routeKey(press('a'), 'win', null, false)).toBe('shell')
    expect(routeKey(press('F5'), 'win', null, false)).toBe('shell')
  })

  /** Emil, issues #213 and #426: every app command on a key the shell reads is both, and
   *  which one it is in a terminal is the reader's to say, once - the defaults and any key
   *  rebound onto one alike. Ctrl+W among them, which went to the shell without a
   *  question before. See two-ways.ts. */
  test('every app command on a key a shell reads is both, and asked about', () => {
    for (const [key, command] of [
      ['t', 'app.new-kind'],
      ['n', 'app.scratchpad'],
      ['w', 'app.close'],
      ['p', 'app.print'],
      ['o', 'app.palette.open'],
      ['e', 'app.reading'],
      // End of input to a shell, and Deselect tab everywhere else.
      ['d', 'app.deselect-tab'],
      // NUL to a shell - Emacs's mark, PowerShell's menu of completions - and the space
      // switcher everywhere else.
      [' ', 'space.switcher'],
      // US to a shell, readline's undo, and the source view everywhere else.
      ['/', 'app.source'],
      // A key somebody put a command on in Settings.
      ['k', 'app.palette.alt'],
      ['[', 'app.back'],
    ] as const) {
      expect(routeKey(press(key, ctrl), 'win', command, false), key).toBe('ask')
      expect(routeKey(press(key, ctrl), 'linux', command, false), key).toBe('ask')
    }
    // A command rebound off a key a shell reads is a chord no shell has.
    expect(routeKey(press('T', ctrlShift), 'win', 'app.new-kind', false)).toBe('app')
  })

  /** A command put on a function key, or on Alt and an arrow, is on a key the program in
   *  the terminal reads too - htop and mc are worked with F-keys, a shell moves a word
   *  with Alt and an arrow - so it is asked about as well, not given away unasked. */
  test('a command on a function key or Alt and an arrow is both too', () => {
    expect(routeKey(press('F9'), 'win', 'app.scratchpad', false)).toBe('ask')
    expect(routeKey(press('F2'), 'linux', 'app.print', false)).toBe('ask')
    expect(routeKey(press('ArrowLeft', { altKey: true }), 'win', 'app.back', false)).toBe('ask')
    // The app's own function keys stay the app's, and a key with no command on it is the
    // program's.
    expect(routeKey(press('F6'), 'win', 'app.region-next', false)).toBe('app')
    expect(routeKey(press('F11'), 'linux', 'app.fullscreen', false)).toBe('app')
    expect(routeKey(press('F9'), 'win', null, false)).toBe('shell')
  })

  /** What the program would have read, typed once the answer is the shell. */
  test('a key answered for the shell is typed as xterm would have sent it', () => {
    expect(typedBy(press('F9'))).toBe('\x1b[20~')
    expect(typedBy(press('F2'))).toBe('\x1bOQ')
    expect(typedBy(press('F5', { shiftKey: true }))).toBe('\x1b[15;2~')
    expect(typedBy(press('ArrowLeft'))).toBe('\x1b[D')
    expect(typedBy(press('ArrowLeft', { altKey: true }))).toBe('\x1b[1;3D')
    expect(typedBy(press('F1', { ctrlKey: true }))).toBe('\x1b[1;5P')
    expect(typedBy(press('n', ctrl))).toBe('\x0e')
    expect(typedBy(press(' ', ctrl))).toBe('\x00')
    expect(typedBy(press('b', { altKey: true }))).toBe('\x1bb')
    expect(typedBy(press('Shift'))).toBeNull()
  })

  test('a character a shell reads is Ctrl and a letter, Ctrl+Space, or another control key', () => {
    expect(shellReads(press('n', ctrl))).toBe(true)
    expect(shellReads(press(' ', ctrl))).toBe(true)
    expect(shellReads(press('[', ctrl))).toBe(true)
    expect(shellReads(press('/', ctrl))).toBe(true)
    expect(shellReads(press('2', ctrl))).toBe(true)
    expect(shellReads(press('N', ctrlShift))).toBe(false)
    expect(shellReads(press(' ', ctrlShift))).toBe(false)
    expect(shellReads(press('n', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(shellReads(press('1', ctrl))).toBe(false)
    expect(shellReads(press(',', ctrl))).toBe(false)
    expect(shellReads(press('n', cmd))).toBe(false)
  })

  /** What the shell would have read, typed once the answer is the shell: DC4 is
   *  readline's transpose-chars, SO its next-history, NUL Emacs's mark. */
  test('the shell is given the character the key would have typed', () => {
    expect(controlOf('t')).toBe('\x14')
    expect(controlOf('n')).toBe('\x0e')
    expect(controlOf('N')).toBe('\x0e')
    expect(controlOf(' ')).toBe('\x00')
    expect(controlOf('[')).toBe('\x1b')
    expect(controlOf('/')).toBe('\x1f')
  })

  /** Close window here and Close tab in every terminal there is: neither, then. */
  test('Ctrl+Shift+W is sent to nobody', () => {
    expect(routeKey(press('W', ctrlShift), 'win', 'app.close-window', false)).toBe('shell')
  })

  test('the terminal’s own copy, paste and find', () => {
    expect(routeKey(press('C', ctrlShift), 'linux', null, false)).toBe('copy')
    expect(routeKey(press('V', ctrlShift), 'linux', null, false)).toBe('paste')
    expect(routeKey(press('Insert', { shiftKey: true }), 'linux', null, false)).toBe('paste')
    expect(routeKey(press('f', ctrl), 'win', null, true)).toBe('find')
    expect(routeKey(press('=', ctrl), 'win', 'app.zoom-in', false)).toBe('zoom-in')
    expect(routeKey(press('0', ctrl), 'win', 'app.zoom-reset', false)).toBe('zoom-reset')
  })

  /** Windows Terminal and VS Code paste on Ctrl+V there; Linux keeps it for the shell. */
  test('Ctrl+V pastes on Windows only, and Ctrl+C is always the interrupt', () => {
    expect(routeKey(press('v', ctrl), 'win', null, false)).toBe('paste')
    expect(routeKey(press('v', ctrl), 'linux', null, false)).toBe('shell')
    expect(routeKey(press('c', ctrl), 'win', null, false)).toBe('shell')
  })

  /** AltGr is Ctrl and Alt to Windows, and it is how half of Europe types a brace. */
  test('AltGr typing a character is never a chord', () => {
    expect(routeKey(press('{', { ctrlKey: true, altKey: true }), 'win', 'app.note-7', false)).toBe(
      'shell',
    )
    expect(routeKey(press('@', { ctrlKey: true, altKey: true }), 'win', null, false)).toBe('shell')
  })
})

describe('on a Mac', () => {
  /** No shell ever sees Cmd, so every app command on it is the app's - Cmd+W closing
   *  the tab among them, as it does in Terminal and iTerm2. */
  test('every app command on Cmd is the app’s', () => {
    expect(routeKey(press('w', cmd), 'mac', 'app.close', false)).toBe('app')
    expect(routeKey(press('t', cmd), 'mac', 'app.new-kind', false)).toBe('app')
    // Nothing to ask: Cmd+N never reaches a shell.
    expect(routeKey(press('n', cmd), 'mac', 'app.scratchpad', false)).toBe('app')
    expect(routeKey(press('Tab', ctrl), 'mac', 'app.next-note', false)).toBe('app')
  })

  test('Ctrl is the shell’s, all of it', () => {
    expect(routeKey(press('w', ctrl), 'mac', null, false)).toBe('shell')
    expect(routeKey(press('c', ctrl), 'mac', null, false)).toBe('shell')
  })

  test('and Terminal’s own copy, paste, select all and clear', () => {
    expect(routeKey(press('c', cmd), 'mac', null, false)).toBe('copy')
    expect(routeKey(press('v', cmd), 'mac', null, false)).toBe('paste')
    expect(routeKey(press('a', cmd), 'mac', null, false)).toBe('select-all')
    expect(routeKey(press('k', cmd), 'mac', null, false)).toBe('clear')
  })
})

/** Issue 228: Claude Code pastes a picture on Alt+V on Windows and Ctrl+V elsewhere, and
 *  reads the clipboard itself. */
describe('the key an agent pastes a picture with', () => {
  const alt = { altKey: true }

  test('Alt and a letter no command is on is the shell’s in a local terminal, Alt+V included', () => {
    for (const platform of ['win', 'linux'] as const) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        expect(routeKey(press(letter, alt), platform, null, false), letter).toBe('shell')
      }
      // Claude Code's Alt+K, which the app has too: both, and asked about once (#426).
      expect(routeKey(press('k', alt), platform, 'app.ask-selection', false)).toBe('ask')
    }
  })

  test('is Alt+V off a Mac, and Ctrl+V where Ctrl+V is the shell’s', () => {
    expect(imageKey(press('v', alt), 'win')).toBe(true)
    expect(imageKey(press('v', alt), 'linux')).toBe(true)
    expect(imageKey(press('v', ctrl), 'linux')).toBe(true)
    expect(imageKey(press('v', ctrl), 'mac')).toBe(true)
    // Windows Terminal's paste, and the terminal's own here; a paste brings a picture.
    expect(imageKey(press('v', ctrl), 'win')).toBe(false)
    expect(routeKey(press('v', ctrl), 'win', null, false)).toBe('paste')
    // Option+V types a character on a Mac.
    expect(imageKey(press('v', alt), 'mac')).toBe(false)
  })

  test('and nothing else', () => {
    expect(imageKey(press('v'), 'win')).toBe(false)
    expect(imageKey(press('V', { altKey: true, shiftKey: true }), 'win')).toBe(false)
    expect(imageKey(press('v', { ctrlKey: true, altKey: true }), 'win')).toBe(false)
    expect(imageKey(press('v', ctrlShift), 'linux')).toBe(false)
    expect(imageKey(press('b', alt), 'win')).toBe(false)
  })

  test('types what xterm.js would have where no picture is brought over', () => {
    expect(imageKeyTyped(press('v', alt))).toBe('\x1bv')
    expect(imageKeyTyped(press('v', ctrl))).toBe('\x16')
  })
})
