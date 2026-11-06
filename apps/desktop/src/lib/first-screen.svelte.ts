import type { EditorView } from '@orden/editor'
import { samePath } from './space-paths'
import { isNumber, isRecord, isString, stored } from './stored'
import { mark } from './trace'
import type { Draft, Session } from './workspace/session'

export const KEY = 'nib:first-screen'

const PATIENCE = 8000

export interface Level {
  tag: string
  className: string
  style: string
}

export type Look = Record<string, string>

export interface Kept {
  build: string
  path: string | null
  words: string
  area: { width: number; height: number }
  box: { left: number; top: number; width: number; height: number }
  levels: Level[]
  shift: number
  inset: number
  anchor: number
  at: number
  lines: string
  css: string
  look: Look
}

export const NAMED = String.fromCharCode(0x37c)
export const RENAMED = String.fromCharCode(0x37d)

export function wordsHash(text: string): string {
  const words = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
  let hash = 0x811c9dc5
  for (let at = 0; at < words.length; at++) {
    hash ^= words.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${String(words.length)}:${(hash >>> 0).toString(36)}`
}

const box = (value: unknown): value is Kept['box'] =>
  isRecord(value) &&
  isNumber(value.left) &&
  isNumber(value.top) &&
  isNumber(value.width) &&
  isNumber(value.height)

const level = (value: unknown): value is Level =>
  isRecord(value) && isString(value.tag) && isString(value.className) && isString(value.style)

export function keptOf(value: unknown): Kept | null {
  if (!isRecord(value)) return null
  const { build, path, words, area, levels, shift, inset, anchor, at, lines, css, look } = value
  if (
    !isString(build) ||
    (path !== null && !isString(path)) ||
    !isString(words) ||
    !isRecord(area) ||
    !isNumber(area.width) ||
    !isNumber(area.height) ||
    !box(value.box) ||
    !Array.isArray(levels) ||
    levels.length !== 4 ||
    !levels.every(level) ||
    !isNumber(shift) ||
    !isNumber(inset) ||
    !isNumber(anchor) ||
    !isNumber(at) ||
    !isString(lines) ||
    !isString(css) ||
    !isRecord(look)
  ) {
    return null
  }

  return {
    build,
    path,
    words,
    area: { width: area.width, height: area.height },
    box: value.box,
    levels,
    shift,
    inset,
    anchor,
    at,
    lines,
    css,
    look: Object.fromEntries(Object.entries(look).filter(([, one]) => isString(one))) as Look,
  }
}

export function sameNote(one: string | null, other: string | null): boolean {
  return one === null || other === null ? one === other : samePath(one, other)
}

export function frontOf(state: Session): Draft | null {
  const front = (() => {
    const frame = state.layout?.frame
    if (!frame) return state.tabs?.[state.active ?? 0] ?? null
    if (frame.kind !== 'pane' || frame.pane.stacked === true) return null
    return frame.pane.tabs[frame.pane.active] ?? frame.pane.tabs[0] ?? null
  })()

  return front?.kind === 'note' && front.reading !== true ? front : null
}

class FirstScreen {
  showing = $state<Kept | null>(null)

  pressed: { x: number; y: number } | null = null
  typed = ''

  private risen = false

  private patience: ReturnType<typeof setTimeout> | undefined

  rise(): boolean {
    const first = !this.risen
    this.risen = true
    return first
  }

  async arm(state: Session, words: (front: Draft) => Promise<string | null>): Promise<void> {
    const front = frontOf(state)
    if (!front) return

    const kept = keptOf(stored(KEY))
    if (kept?.build !== __EVEN_BUILD__ || !sameNote(kept.path, front.path)) return

    const text = front.dirty ? front.doc : await words(front)
    if (text === null || wordsHash(text) !== kept.words) return

    this.showing = kept
    this.patience = setTimeout(() => this.drop(), PATIENCE)
  }

  lineUp(view: EditorView, kept: Kept): void {
    const scroller = view.scrollDOM.getBoundingClientRect().top
    const line = view.lineBlockAt(Math.min(kept.anchor, view.state.doc.length))
    view.scrollDOM.scrollTop += line.top + view.documentTop - scroller - kept.at
  }

  handTo(view: EditorView): void {
    const pressed = this.pressed
    if (pressed) {
      const at = view.posAtCoords(pressed)
      if (at !== null) view.dispatch({ selection: { anchor: at } })
    }
    if (this.typed) view.dispatch(view.state.replaceSelection(this.typed))
    if (pressed || this.typed) view.focus()
    mark('first screen handed to the editor')
    this.clear()
  }

  drop(): void {
    if (this.showing) mark('first screen dropped')
    this.clear()
  }

  private clear(): void {
    clearTimeout(this.patience)
    this.showing = null
    this.pressed = null
    this.typed = ''
  }
}

export const firstScreen = new FirstScreen()
