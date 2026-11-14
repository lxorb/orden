import type { FoldLines } from '@orden/editor'
import { isBaseTarget, isChatTarget, isPagesTarget, isWebTarget } from '@orden/markdown/links'
import { identifier } from '../identifier'
import { roomKind } from '../collab/src/api'
import { nameOf, samePath } from '../space-paths'
import { isNumber, isRecord, isString, keepJson, stringList } from '../stored'
import { builtinName, readSpec } from '../views/spec'
import type { Panel, Space } from '../workspace.svelte'
import type { TabKind } from './documents.svelte'
import { type Along, type Frame, pane } from './pane-tree'
import { PANELS } from './panels'
import { isRetiredTab } from './retired-tabs'
import { isTabKind } from './tab-kinds'

const VERSION = 2

export interface Draft {
  kind: TabKind
  path: string | null
  name: string
  doc: string
  dirty: boolean
  cursor: number
  scroll: number
  anchor?: number | undefined
  folds?: readonly FoldLines[] | undefined
  base?: string | undefined
  share?: string | undefined
  reading?: boolean | undefined
  source?: boolean | undefined
  page?: number | undefined
  zoom?: number | undefined
  address?: string | undefined
  apart?: string | undefined
  space?: string | undefined
}

export interface PaneDraft {
  id: string
  tabs: Draft[]
  active: number
  recent?: number[]
  linked: boolean
  stacked?: boolean
}

export type FrameDraft =
  | { kind: 'pane'; pane: PaneDraft }
  | { kind: 'split'; id: string; along: Along; fraction: number; sides: [FrameDraft, FrameDraft] }

export interface Layout {
  frame: FrameDraft
  focused: string
  panel: Panel | null
}

export interface Position {
  cursor: number
  scroll: number
  anchor?: number | undefined
  folds?: readonly FoldLines[] | undefined
  at: number
}

export interface ClosedTab {
  draft: Draft
  paneId: string
  at: number
  batch?: number
  trashed?: string | undefined
}

export interface Session {
  spaces: Space[]
  activeSpace: string | null
  positions?: Record<string, Position>
  layout?: Layout
  tabs?: Draft[]
  active?: number
  openPaths?: string[]
  activePath?: string | null
  closed?: ClosedTab[]
  panel: Panel | null
  right?: Panel[]
  rightPanel?: Panel | null
  lastRight?: Panel | null
  known?: Panel[]
  sets?: unknown
}

export function isPanel(value: unknown): value is Panel {
  return PANELS.some((panel) => panel === value)
}

function tabKind(value: unknown, path: unknown): TabKind {
  const said = isTabKind(value) ? value : 'note'
  if (typeof path !== 'string') return said

  if (isWebTarget(path)) return 'web'
  if (isBaseTarget(path)) return 'view'
  if (isChatTarget(path)) return 'channel'

  if (isPagesTarget(path)) return 'pages'
  if (roomKind(path) === 'plane') return 'canvas'
  return said === 'canvas' || said === 'pages' ? 'note' : said
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.root)
}

function readFolds(value: unknown): readonly FoldLines[] | null {
  if (!Array.isArray(value)) return null

  const out: FoldLines[] = []
  for (const one of value as unknown[]) {
    if (!Array.isArray(one) || one.length !== 2) continue

    const pair = one as unknown[]
    const head = pair[0]
    const last = pair[1]
    if (!isNumber(head) || !isNumber(last)) continue
    if (!Number.isInteger(head) || !Number.isInteger(last)) continue
    if (head < 1 || last <= head) continue
    out.push([head, last])
  }

  return out.length ? out : null
}

export function readDraft(value: unknown): Draft | null {
  if (!isRecord(value) || isRetiredTab(value)) return null

  const { kind, path, name, doc, dirty, cursor, scroll, anchor, share, reading } = value
  const { folds, page, zoom, address, space, source, apart, base } = value
  if (typeof name !== 'string' || typeof doc !== 'string') return null
  if (path !== null && typeof path !== 'string') return null

  const shut = readFolds(folds)
  const builtin =
    path === null && tabKind(kind, path) === 'view' ? readSpec(doc)?.builtin : undefined

  return {
    kind: tabKind(kind, path),
    path,
    name: builtin === undefined ? name : builtinName(builtin),
    doc,
    dirty: dirty === true,
    cursor: isNumber(cursor) ? cursor : 0,
    scroll: isNumber(scroll) ? scroll : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
    ...(shut ? { folds: shut } : {}),
    ...(path !== null && dirty === true && typeof base === 'string' ? { base } : {}),
    ...(isString(share) ? { share } : {}),
    ...(reading === true ? { reading: true } : {}),
    ...(typeof source === 'boolean' ? { source } : {}),
    ...(isNumber(page) && page >= 1 ? { page } : {}),
    ...(isNumber(zoom) && zoom > 0 ? { zoom } : {}),
    ...(isString(address) ? { address } : {}),
    ...(path === null && isString(space) ? { space } : {}),
    ...(path === null && isString(apart) ? { apart } : {}),
  }
}

function readDrafts(value: unknown): Draft[] {
  if (!Array.isArray(value)) return []
  return value.map(readDraft).filter((draft): draft is Draft => draft !== null)
}

function readPane(value: unknown): PaneDraft | null {
  if (!isRecord(value) || !isString(value.id)) return null

  return {
    id: value.id,
    tabs: readDrafts(value.tabs),
    active: isNumber(value.active) ? value.active : 0,
    ...(Array.isArray(value.recent) ? { recent: value.recent.filter(isNumber) } : {}),
    linked: value.linked === true,
    stacked: value.stacked === true,
  }
}

const ALONG: readonly Along[] = ['row', 'column']

function readFrame(value: unknown): FrameDraft | null {
  if (!isRecord(value)) return null

  if (value.kind === 'split') {
    const sides = Array.isArray(value.sides) ? value.sides.map(readFrame) : []
    const [first, second] = sides
    if (!first || !second) return first ?? second ?? null

    const along = ALONG.find((one) => one === value.along) ?? 'row'
    const fraction = isNumber(value.fraction) ? value.fraction : 0.5
    const id = isString(value.id) ? value.id : identifier()

    return { kind: 'split', id, along, fraction, sides: [first, second] }
  }

  const pane = readPane(value.pane)
  return pane ? { kind: 'pane', pane } : null
}

export function readLayout(value: unknown): Layout | null {
  if (!isRecord(value)) return null

  const frame = readFrame(value.frame)
  if (!frame) return null

  return {
    frame,
    focused: isString(value.focused) ? value.focused : '',
    panel: isPanel(value.panel) ? value.panel : null,
  }
}

export function readPosition(value: unknown): Position | null {
  if (!isRecord(value)) return null

  const { cursor, scroll, anchor, folds, at } = value
  if (!isNumber(cursor) || !isNumber(scroll)) return null

  const kept = readFolds(folds)

  return {
    cursor,
    scroll,
    at: isNumber(at) ? at : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
    ...(kept ? { folds: kept } : {}),
  }
}

function readPositions(value: unknown): Record<string, Position> {
  if (!isRecord(value)) return {}

  const out: Record<string, Position> = {}
  for (const [path, one] of Object.entries(value)) {
    const place = readPosition(one)
    if (place) out[path] = place
  }

  return out
}

export function readClosed(value: unknown): ClosedTab | null {
  if (!isRecord(value)) return null

  const draft = readDraft(value.draft)
  if (!draft) return null

  return {
    draft,
    paneId: isString(value.paneId) ? value.paneId : '',
    at: isNumber(value.at) && value.at >= 0 ? value.at : 0,
    ...(isNumber(value.batch) ? { batch: value.batch } : {}),
    ...(isString(value.trashed) ? { trashed: value.trashed } : {}),
  }
}

export function arrangementIn(state: Session): Layout | null {
  if (state.layout) return state.layout

  const paths = state.openPaths ?? []
  const tabs = state.tabs?.length
    ? state.tabs
    : paths.flatMap((path) => readDraft({ path, name: nameOf(path), doc: '' }) ?? [])
  if (!tabs.length) return null

  const id = identifier()
  const active = state.tabs?.length
    ? (state.active ?? 0)
    : Math.max(
        0,
        paths.findIndex((path) => samePath(path, state.activePath ?? null)),
      )
  return {
    frame: { kind: 'pane', pane: { id, tabs, active, linked: false } },
    focused: id,
    panel: state.panel,
  }
}

export function arrivingWith(read: Layout, now: Layout): Layout {
  const panes = panesOf(read.frame)
  const held = panes.flatMap((one) => one.tabs)
  const open = panesOf(now.frame)
    .flatMap((one) => one.tabs)
    .filter((tab) => tab.dirty || !held.some((one) => one.path && samePath(one.path, tab.path)))
  const into = (panes.find((one) => one.id === read.focused) ?? panes[0])?.id
  const behind = (frame: FrameDraft): FrameDraft => {
    if (frame.kind === 'split')
      return { ...frame, sides: [behind(frame.sides[0]), behind(frame.sides[1])] }
    if (frame.pane.id !== into) return frame
    return { kind: 'pane', pane: { ...frame.pane, tabs: [...frame.pane.tabs, ...open] } }
  }
  return { ...read, panel: now.panel, frame: open.length ? behind(read.frame) : read.frame }
}

export function readSession(value: unknown): Session | null {
  if (!isRecord(value)) return null

  const layout = readLayout(value.layout)
  const drafts = Array.isArray(value.tabs) ? readDrafts(value.tabs) : null
  const openPaths = stringList(value.openPaths)

  return {
    spaces: Array.isArray(value.spaces) ? value.spaces.filter(isSpace) : [],
    activeSpace: isString(value.activeSpace) ? value.activeSpace : null,
    panel: layout?.panel ?? (isPanel(value.panel) ? value.panel : null),
    ...(Array.isArray(value.right) ? { right: [...new Set(value.right.filter(isPanel))] } : {}),
    ...(isPanel(value.rightPanel) ? { rightPanel: value.rightPanel } : {}),
    ...(isPanel(value.lastRight) ? { lastRight: value.lastRight } : {}),
    ...(Array.isArray(value.known) ? { known: value.known.filter(isPanel) } : {}),
    ...(value.sets === undefined ? {} : { sets: value.sets }),
    positions: readPositions(value.positions),
    ...(layout ? { layout } : {}),
    ...(drafts ? { tabs: drafts } : {}),
    ...(isNumber(value.active) ? { active: value.active } : {}),
    ...(openPaths ? { openPaths } : {}),
    ...(isString(value.activePath) ? { activePath: value.activePath } : {}),
    closed: Array.isArray(value.closed)
      ? value.closed.map(readClosed).filter((one): one is ClosedTab => one !== null)
      : [],
  }
}

export function panesOf(frame: FrameDraft): PaneDraft[] {
  if (frame.kind === 'pane') return [frame.pane]
  return [...panesOf(frame.sides[0]), ...panesOf(frame.sides[1])]
}

export function frameOf(draft: FrameDraft, showing: (pane: PaneDraft) => string | null): Frame {
  if (draft.kind === 'pane') {
    const one = pane(draft.pane.id, showing(draft.pane))
    one.linked = draft.pane.linked
    one.stacked = draft.pane.stacked === true
    return one
  }

  return {
    kind: 'split',
    id: draft.id,
    along: draft.along,
    fraction: draft.fraction,
    sides: [frameOf(draft.sides[0], showing), frameOf(draft.sides[1], showing)],
  }
}

export function frameDraft(
  frame: Frame,
  strip: (pane: { id: string; activeTabId: string | null }) => {
    tabs: Draft[]
    active: number
    recent?: number[]
  },
): FrameDraft {
  if (frame.kind === 'pane') {
    const { tabs, active, recent } = strip(frame)
    return {
      kind: 'pane',
      pane: {
        id: frame.id,
        tabs,
        active,
        ...(recent?.length ? { recent } : {}),
        linked: frame.linked,
        stacked: frame.stacked,
      },
    }
  }

  return {
    kind: 'split',
    id: frame.id,
    along: frame.along,
    fraction: frame.fraction,
    sides: [frameDraft(frame.sides[0], strip), frameDraft(frame.sides[1], strip)],
  }
}

export function withoutText(layout: Layout): Layout {
  return { ...layout, frame: bareFrame(layout.frame) }
}

function bareFrame(frame: FrameDraft): FrameDraft {
  if (frame.kind === 'split') {
    return { ...frame, sides: [bareFrame(frame.sides[0]), bareFrame(frame.sides[1])] }
  }

  const tabs = frame.pane.tabs.map((draft) => {
    if (!draft.path || !draft.doc) return draft
    const bare: Draft = { ...draft, doc: '', dirty: false }
    delete bare.base
    return bare
  })

  return { kind: 'pane', pane: { ...frame.pane, tabs } }
}

function withoutBases(layout: Layout): Layout | null {
  if (!panesOf(layout.frame).some((pane) => pane.tabs.some((tab) => tab.base !== undefined)))
    return null
  const bare = (frame: FrameDraft): FrameDraft => {
    if (frame.kind === 'split')
      return { ...frame, sides: [bare(frame.sides[0]), bare(frame.sides[1])] }
    const tabs = frame.pane.tabs.map(({ base: _base, ...draft }) => draft)
    return { ...frame, pane: { ...frame.pane, tabs } }
  }
  return { ...layout, frame: bare(layout.frame) }
}

export function writeSession(key: string, state: Session): boolean {
  if (put(key, state)) return true

  const shorter: Session = { ...state, closed: [] }
  if (put(key, shorter)) return true

  const unmerged = state.layout ? withoutBases(state.layout) : null
  if (unmerged && put(key, { ...shorter, layout: unmerged })) return true

  const lean = state.layout ? withoutText(state.layout) : undefined
  return put(key, { ...shorter, ...(lean ? { layout: lean } : {}) })
}

function put(key: string, state: Session): boolean {
  return keepJson(key, { version: VERSION, ...state })
}
