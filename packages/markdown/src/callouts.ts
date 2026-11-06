import type { IconNode } from 'lucide'
import Bug from 'lucide/dist/esm/icons/bug.mjs'
import Check from 'lucide/dist/esm/icons/check.mjs'
import CircleCheck from 'lucide/dist/esm/icons/circle-check.mjs'
import CircleQuestionMark from 'lucide/dist/esm/icons/circle-question-mark.mjs'
import ClipboardList from 'lucide/dist/esm/icons/clipboard-list.mjs'
import Flame from 'lucide/dist/esm/icons/flame.mjs'
import Info from 'lucide/dist/esm/icons/info.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import Quote from 'lucide/dist/esm/icons/quote.mjs'
import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
import X from 'lucide/dist/esm/icons/x.mjs'
import Zap from 'lucide/dist/esm/icons/zap.mjs'
import { CHEVRON, iconMarkup, type IconParts } from './icons'

const LOOKS: ReadonlyMap<string, IconNode> = new Map(
  Object.entries({
    note: Pencil,
    abstract: ClipboardList,
    info: Info,
    todo: CircleCheck,
    tip: Flame,
    success: Check,
    question: CircleQuestionMark,
    warning: TriangleAlert,
    failure: X,
    danger: Zap,
    bug: Bug,
    example: List,
    quote: Quote,
  }),
)

const ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    summary: 'abstract',
    tldr: 'abstract',
    hint: 'tip',
    important: 'tip',
    check: 'success',
    done: 'success',
    help: 'question',
    faq: 'question',
    caution: 'warning',
    attention: 'warning',
    fail: 'failure',
    missing: 'failure',
    error: 'danger',
    cite: 'quote',
  }),
)

const SHOUTED = new Set(['tldr', 'faq'])

const MARKER = /^([ \t]*\[!([^\]\n]+)\]([-+])?[ \t]*)([^\n]*)/

export interface Callout {
  type: string
  look: string | null
  label: string
  title: string
  foldable: boolean
  folded: boolean
  taken: number
  rest: string
}

export function opensCallout(block: { type: string; raw: string }): boolean {
  if (block.type === 'paragraph') return true
  return block.type === 'heading' && !/^ {0,3}#/.test(block.raw)
}

export function calloutOf(text: string): Callout | null {
  const found = MARKER.exec(text)
  if (!found) return null

  const type = (found[2] ?? '').trim().toLowerCase()
  if (!type) return null

  const sign = found[3]
  const title = (found[4] ?? '').trim()
  const after = text.slice(found[0].length)
  const body = after.startsWith('\n') ? after.slice(1) : after

  return {
    type,
    look: LOOKS.has(type) ? type : (ALIASES.get(type) ?? null),
    label: SHOUTED.has(type) ? type.toUpperCase() : type.charAt(0).toUpperCase() + type.slice(1),
    title,
    foldable: sign !== undefined,
    folded: sign === '-',
    taken: text.length - body.length,
    rest: body,
  }
}

export function calloutIconParts(look: string | null): IconParts | null {
  const node = look === null ? undefined : LOOKS.get(look)
  return node ?? null
}

export function calloutIcon(look: string | null): string {
  const parts = calloutIconParts(look)
  return parts ? iconMarkup(parts, 'callout-icon') : ''
}

export function calloutChevron(): string {
  return iconMarkup(CHEVRON, 'callout-fold')
}
