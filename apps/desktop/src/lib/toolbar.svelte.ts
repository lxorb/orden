import Link from 'lucide/dist/esm/icons/link.mjs'
import type { IconNode } from 'lucide'
import { account, api, type AccountSettings } from './accounts/src/api'
import { BY_ID, runnable } from './shortcuts/registry'
import { forget, isString, keepJson, stored } from './platform/src/api'

const STORAGE_KEY = 'orden:toolbar'

const MOST_BUTTONS = 24

export const DEFAULT_TOOLBAR: readonly string[] = [
  'format.bold',
  'format.italic',
  'format.strikethrough',
  'format.highlight',
  'format.code',
  'paragraph.heading-2',
  'paragraph.quote',
  'format.link',
  'format.clear',
]

const MARKS: Record<string, string> = {
  'format.bold': 'B',
  'format.italic': 'I',
  'format.strikethrough': 'S',
  'format.highlight': 'M',
  'format.underline': 'U',
  'format.code': '<>',
  'format.clear': '×',
  'format.comment': '//',
  'paragraph.body': '¶',
  'paragraph.heading-1': 'H1',
  'paragraph.heading-2': 'H',
  'paragraph.heading-3': 'H3',
  'paragraph.heading-4': 'H4',
  'paragraph.heading-5': 'H5',
  'paragraph.heading-6': 'H6',
  'paragraph.heading-up': 'H+',
  'paragraph.heading-down': 'H-',
  'paragraph.quote': '"',
  'paragraph.bullet-list': '•',
  'paragraph.ordered-list': '1.',
  'paragraph.task-list': '☐',
  'paragraph.task': '☑',
  'paragraph.math-block': '∑',
  'paragraph.toc': '≡',
  'paragraph.rule': '––',
}

const GLYPHS: Record<string, IconNode> = {
  'format.link': Link,
}

const HIGH = new Set(['paragraph.quote'])

export function glyphFor(id: string): IconNode | null {
  return GLYPHS[id] ?? null
}

export function lowMark(id: string): boolean {
  return HIGH.has(id)
}

export function markFor(id: string): string {
  const mark = MARKS[id]
  if (mark) return mark

  const label = BY_ID.get(id)?.label() ?? id
  const first = new Intl.Segmenter().segment(label)[Symbol.iterator]().next().value?.segment
  return first?.toLocaleUpperCase() ?? '?'
}

export function nameFor(id: string): string {
  return BY_ID.get(id)?.label() ?? id
}

class Toolbar {
  chosen = $state<string[] | null>(null)

  get ids(): readonly string[] {
    return this.chosen ?? DEFAULT_TOOLBAR
  }

  get changed(): boolean {
    return this.chosen !== null
  }

  restore() {
    const held = stored(STORAGE_KEY)
    this.chosen = usable(held)
  }

  add(id: string) {
    if (!runnable(id) || this.ids.includes(id) || this.ids.length >= MOST_BUTTONS) return

    this.chosen = [...this.ids, id]
    this.settle()
  }

  remove(id: string) {
    if (!this.ids.includes(id)) return

    this.chosen = this.ids.filter((one) => one !== id)
    this.settle()
  }

  move(from: number, to: number) {
    const list = [...this.ids]
    const held = list[from]
    if (held === undefined) return

    const landing = Math.max(0, Math.min(list.length - 1, to))
    if (landing === from) return

    list.splice(from, 1)
    list.splice(landing, 0, held)

    this.chosen = list
    this.settle()
  }

  reset() {
    this.chosen = null
    this.settle()
  }

  private settle() {
    if (this.chosen) keepJson(STORAGE_KEY, this.chosen)
    else forget(STORAGE_KEY)

    this.share()
  }

  receive(remote: AccountSettings) {
    const theirs = remote.toolbar
    if (theirs === undefined) {
      if (this.chosen) this.share()
      return
    }

    const usableOnes = theirs === null ? null : usable(theirs)
    if (JSON.stringify(usableOnes) === JSON.stringify(this.chosen)) return

    this.chosen = usableOnes
    if (usableOnes) keepJson(STORAGE_KEY, usableOnes)
    else forget(STORAGE_KEY)
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    void api.saveSettings(token, { toolbar: this.chosen }).catch(() => undefined)
  }
}

export function usable(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const out: string[] = []
  for (const one of value) {
    if (!isString(one) || out.includes(one) || !runnable(one)) continue
    out.push(one)
    if (out.length >= MOST_BUTTONS) break
  }

  return out.length || value.length === 0 ? out : null
}

export const toolbar = new Toolbar()
