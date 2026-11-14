import type { IModes } from '@xterm/xterm'

const MARKS = ['\x1b]133;A', '\x1b]633;A'].map((mark) => new TextEncoder().encode(mark))

const BEL = 0x07
const ESC = 0x1b
const BACKSLASH = 0x5c

export function promptEnd(bytes: Uint8Array): number {
  for (let at = bytes.indexOf(ESC); at >= 0; at = bytes.indexOf(ESC, at + 1)) {
    const mark = MARKS.find((one) => one.every((byte, step) => bytes[at + step] === byte))
    if (!mark) continue

    for (let end = at + mark.length; end < bytes.length; end++) {
      if (bytes[end] === BEL) return end + 1
      if (bytes[end] === ESC) return bytes[end + 1] === BACKSLASH ? end + 2 : -1
    }
    return -1
  }
  return -1
}

export interface Left {
  modes: Pick<
    IModes,
    | 'mouseTrackingMode'
    | 'sendFocusMode'
    | 'applicationCursorKeysMode'
    | 'applicationKeypadMode'
    | 'bracketedPasteMode'
    | 'synchronizedOutputMode'
  >
  alternate: boolean
}

const MOUSE_OFF = [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]
  .map((mode) => `\x1b[?${mode}l`)
  .join('')

export function tidied(left: Left, paste: boolean, all = true): string {
  const { modes } = left
  let out = ''
  if (all && left.alternate) out += '\x1b[?1049l'
  if (modes.mouseTrackingMode !== 'none') out += MOUSE_OFF
  if (modes.sendFocusMode) out += '\x1b[?1004l'
  if (modes.synchronizedOutputMode) out += '\x1b[?2026l'
  if (all && modes.applicationCursorKeysMode) out += '\x1b[?1l'
  if (all && modes.applicationKeypadMode) out += '\x1b>'
  if (all && !paste && modes.bracketedPasteMode) out += '\x1b[?2004l'
  return out && `${out}\x1b[?25h`
}

export function pastesItself(shell: string): boolean {
  return shell !== 'cmd' && !shell.startsWith('vs-cmd:')
}

export function reporting(left: Left): boolean {
  return left.modes.mouseTrackingMode !== 'none' || left.modes.sendFocusMode
}
