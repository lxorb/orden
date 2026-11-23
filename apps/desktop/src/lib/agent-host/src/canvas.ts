import { shownPath } from '@orden/markdown/shown'
import type { AgentAnswer } from '../../automation/src/api'
import { readable as guarded } from '../../reader-verbs/src/api'
import { type Canvas, readCanvas as parse, writeCanvas } from '@orden/markdown/canvas'
import { merged, stamped } from '@orden/markdown/canvas-merge'
import { canWriteAt } from '../../sharing/src/api'
import { invoke } from '../../platform/src/api'
import { type NoteDoc } from '../../documents/src/api'
import { writeFile } from '../../file-writes/src/api'
import { workspace } from '../../workspace/src/api'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import {
  asked,
  type Call,
  done,
  maybe,
  need,
  Refused,
  namedTab,
  tabsOwnSpace,
  docSource,
  judged,
  judgedForWriting,
  onDisk,
  type Place,
  placeOf,
  sharedSource,
  tabWithId,
} from '../../agent-verbs/src/api'
import { inTurn } from '../../agent-docs/src/api'
import { applied, readable } from './canvas-ops'
import { readablePages } from './pages-ops'
import { readsOf, sizesOf } from './pages-read'
import { pagesAsked } from './pdf-text'
import { pagesOf } from '@orden/markdown/pages'
import { isRecord } from '../../platform/src/api'
import { kindsWhere } from '../../tab-kinds/src/api'

interface Target {
  place: Place
  relative: string
  path: string | null
  draft: NoteDoc | null
}
function canvasOf(call: Call, writing: boolean): Target {
  if (maybe(call, 'tab') !== null) return canvasInTab(call, writing)
  const place = placeOf(call)
  const asked = need(call, 'path')
  const relative = writing ? judgedForWriting(asked) : judged(asked)
  if (!isCanvasTarget(relative) && !isPagesTarget(relative)) {
    throw new Refused('bad_arguments', `${relative} is not a canvas or a page note`)
  }
  const path = onDisk(place, relative)
  if (writing && !canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }
  guarded(path, relative)
  return { place, relative, path, draft: null }
}
const PLANES = kindsWhere((one) => one.plane)
function canvasInTab(call: Call, writing: boolean): Target {
  const { tab, place, relative } = namedTab(call, PLANES, 'a canvas or page note')
  if (relative !== null) {
    const args = { ...call.args, tab: null, path: relative, space: place.space.id }
    return canvasOf({ ...call, args }, writing)
  }
  if (tab.path !== null) throw new Refused('by_hand', `tab ${tab.id} is outside every space`)
  if (tab.note.shared !== null) {
    throw new Refused('by_hand', `tab ${tab.id} is a canvas somebody shared, kept by its room`)
  }
  tabsOwnSpace(call, tab, place)
  return { place, relative: '', path: null, draft: tab.note }
}
function openAs(target: Target): NoteDoc | null {
  return target.draft ?? (target.path === null ? null : workspace.documentAt(target.path))
}
async function drawnAt(target: Target) {
  const open = openAs(target)
  if (!open) return null
  const { CanvasStore } = await import('../../canvas/src/api')
  return CanvasStore.drawing(open, workspace.tabs)
}
async function canvasAt(target: Target): Promise<Canvas> {
  const drawn = await drawnAt(target)
  if (drawn) return drawn.canvas
  const open = openAs(target)
  if (open) {
    open.flush()
    return parse(open.text)
  }
  const words = target.path === null ? null : await invoke<string>('read_note', { path: target.path }).catch(() => null)
  if (words === null) throw new Refused('no_such_file', 'there is no canvas there')
  return parse(words)
}
function isPages(target: Target): boolean {
  return target.draft ? target.draft.kind === 'pages' : isPagesTarget(target.relative)
}
function nameOf(target: Target, call: Call): string {
  return target.relative || `tab ${maybe(call, 'tab') ?? ''}`
}
const FIELDS_AT_ONCE = 20
function paperPlace(target: Target) {
  return { note: target.path, root: target.place.space.root }
}
async function pageReads(target: Target, canvas: Canvas, numbers: string | null) {
  const pages = pagesOf(canvas)
  const asked = new Set(
    numbers === null ? pagesAsked(`1-${FIELDS_AT_ONCE}`, pages.length) : pagesAsked(numbers, pages.length),
  )
  return readsOf(
    pages.filter((_, at) => asked.has(at + 1)),
    paperPlace(target),
  )
}
export function isPlaneCall(call: Call): boolean {
  const tab = maybe(call, 'tab')
  if (tab !== null) return PLANES.includes(tabWithId(call, tab).kind)
  const path = maybe(call, 'path') ?? ''
  return isCanvasTarget(path) || isPagesTarget(path)
}
export async function canvasShown(call: Call) {
  const target = canvasOf(call, false)
  return {
    canvas: await canvasAt(target),
    pages: isPages(target),
    path: target.path,
    root: target.place.space.root,
    name: nameOf(target, call),
    source: target.draft ? docSource(target.draft) : sharedSource(target.place, target.relative),
  }
}
export async function readCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, false)
  const canvas = await canvasAt(target)
  const read = isPages(target)
    ? readablePages(canvas, await pageReads(target, canvas, maybe(call, 'pages')))
    : readable(canvas)
  return done(
    { path: target.relative, ...read },
    target.draft ? docSource(target.draft) : sharedSource(target.place, target.relative),
  )
}
async function printedSizes(target: Target, canvas: Canvas, ops: unknown): Promise<Map<string, number>> {
  const placing = Array.isArray(ops) && ops.some((op) => isRecord(op) && op.op === 'add_card' && op.page !== undefined)
  if (!isPages(target) || !placing) return new Map()
  return sizesOf(pagesOf(canvas), paperPlace(target))
}
export async function editCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, true)
  const before = await canvasAt(target)
  const sizes = await printedSizes(target, before, call.args.ops)
  applied(before, call.args.ops, sizes)
  const named = nameOf(target, call)
  const question = await asked(call, null, `Edit the canvas ${shownPath(named)} in ${target.place.space.name}`)
  if (question) return question
  const made = await edited(target, call.args.ops, call.caller.agent?.name, sizes)
  return done({ path: target.relative, made })
}
async function edited(
  target: Target,
  ops: unknown,
  source: string | undefined,
  sizes: ReadonlyMap<string, number>,
): Promise<string[]> {
  const drawn = await drawnAt(target)
  if (drawn) {
    const done = applied(drawn.canvas, ops, sizes)
    drawn.edit(done.canvas)
    return done.made
  }
  const open = openAs(target)
  if (open) {
    open.flush()
    const before = parse(open.text)
    const done = applied(before, ops, sizes)
    open.replace(writeCanvas(stamped(before, done.canvas, Date.now())))
    return done.made
  }
  const path = target.path
  if (path === null) throw new Refused('no_such_file', 'there is no canvas there')
  return inTurn(path, async () => {
    const was = await invoke<string>('read_note', { path })
    const before = parse(was)
    const done = applied(before, ops, sizes)
    const mine = stamped(before, done.canvas, Date.now())
    const now = await invoke<string>('read_note', { path }).catch(() => was)
    const kept = now === was ? mine : merged(mine, parse(now))
    await invoke('snapshot_note', { path, content: now, source }).catch(() => undefined)
    await writeFile(path, writeCanvas(kept))
    return done.made
  })
}
