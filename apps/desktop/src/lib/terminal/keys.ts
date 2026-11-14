import type { Platform } from '../ui-kit/src/api'

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

export interface Keystroke {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

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

const NEITHER = new Set(['app.close-window'])

const SHELL_FIRST = new Set(['app.reload'])

const SHELL_KEYS = new Set([
  'pane.focus-left',
  'pane.focus-down',
  'pane.focus-up',
  'pane.focus-right',
])

const ZOOM: Record<string, Route> = {
  'app.zoom-in': 'zoom-in',
  'app.zoom-out': 'zoom-out',
  'app.zoom-reset': 'zoom-reset',
}

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
  if (NEITHER.has(command) || SHELL_KEYS.has(command)) return 'shell'
  if (SHELL_FIRST.has(command)) return shellReads(event) ? 'shell' : 'app'
  if (shellReads(event)) return key === 'c' ? 'shell' : 'ask'
  if (APP_KEYS.has(command) || command.startsWith('app.note-')) return 'app'
  if (!mac && event.ctrlKey && event.altKey) return 'app'
  if (mac && event.metaKey) return 'app'
  if (!mac && event.ctrlKey && event.shiftKey) return 'app'

  return 'ask'
}

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

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Home', 'End'])

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

export function imageKey(event: Keystroke, platform: Platform): boolean {
  if (event.key.toLowerCase() !== 'v' || event.shiftKey || event.metaKey) return false
  if (event.altKey && !event.ctrlKey) return platform !== 'mac'
  return event.ctrlKey && !event.altKey && platform !== 'win'
}

export function imageKeyTyped(event: Keystroke): string {
  return event.altKey ? '\x1bv' : controlOf('v')
}

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

export function shellReads(event: Keystroke): boolean {
  const bare = !event.shiftKey && !event.altKey && !event.metaKey
  return event.ctrlKey && bare && (/^[a-z]$/i.test(event.key) || event.key in CONTROLS)
}

export function controlOf(key: string): string {
  const control = CONTROLS[key]
  if (control !== undefined) return control
  return String.fromCharCode(key.toLowerCase().charCodeAt(0) - 96)
}
