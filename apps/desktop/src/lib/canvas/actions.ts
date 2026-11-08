import { type Alignment, aligned, distributed, type Order, ordered } from './arrange'
import {
  connected,
  copied,
  coloured,
  grouped,
  locking,
  movedBy,
  pasted,
  placedAt,
  reattached,
  removed,
  rubbedOut,
  ungrouped,
  withEnds,
  withGroup,
  withLabel,
  withNode,
  withShape,
  withStroke,
} from './edits'
import {
  type Canvas,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  freshId,
  isShape,
  type Shape,
  type Side,
} from './format'
import { bounds, type Box, boxOf, facingSide, GRID, type Point, rectBetween } from './geometry'
import { cardsInLasso, INK_STYLES, strokeBox, strokesInLasso, tidied } from './ink'
import type { Palette } from './paint'
import type { Hit, PendingStroke, PutTool, Tool } from './pointer'
import type { CanvasStore } from './store.svelte'
import { tools } from './tools.svelte'
import { NOTCH, turned, turnOf, zoomed } from '../camera'
import type { Keystroke } from '../keys'
import { shortcuts } from '../shortcuts.svelte'
import { accountAddress, storeImage } from '../assets'
import { chooseFiles, PICTURES } from '../choose-files'
import { t, key } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { busy } from '../busy.svelte'
import { folderOf, insideSpace, relativeTo, withinSpace } from '../space-paths'
import { spaceRelative } from '../recorder/paths'
import { openHref } from '../open-link'
import { workspace } from '../workspace.svelte'
import { loading, pdfjs } from '../pdf/document'
import { PDF_TO_CSS } from '../pdf/pages'

const NUDGE = 1

export const run = {
  connect(
    store: CanvasStore,
    from: string,
    fromSide: Side,
    to: string,
    toSide: Side | 'auto',
    head = true,
  ) {
    const target = store.canvas.nodes.find((node) => node.id === to)
    const source = store.canvas.nodes.find((node) => node.id === from)
    if (!target || !source) return

    const side = toSide === 'auto' ? facingSide(boxOf(target), boxOf(source)) : toSide
    const made = connected(store.canvas, from, fromSide, to, side, head)
    store.edit(made.canvas)
    if (made.id) store.pick(made.id)
  },

  reattach(store: CanvasStore, edge: string, end: 'from' | 'to', to: string) {
    store.edit(reattached(store.canvas, edge, end, to))
  },

  shape(store: CanvasStore, shape: Shape, from: Point, to: Point, colour: string) {
    const made = withShape(store.canvas, shape, from, to, colour === 'ink' ? undefined : colour)
    store.edit(made.canvas)
    store.pick(made.id)
  },

  group(store: CanvasStore) {
    if (store.picked.length < 1) return

    const made = grouped(store.canvas, store.picked)
    if (!made.id) return

    store.edit(made.canvas)
    store.pick(made.id)
  },

  lock(store: CanvasStore) {
    store.edit(locking(store.canvas, store.picked, true))
    store.pickAll(store.picked)
  },

  unlock(store: CanvasStore, id: string) {
    store.edit(locking(store.canvas, [id], false))
  },

  ungroup(store: CanvasStore) {
    const made = ungrouped(store.canvas, store.picked)
    if (!made.ids.length && made.canvas === store.canvas) return

    store.edit(made.canvas)
    store.pickAll(made.ids)
  },

  leaveCopy(store: CanvasStore, run: string) {
    if (!store.picked.length) return

    const made = copied(store.canvas, store.picked, 0, 0)
    store.edit(made.canvas, run)
  },

  write(store: CanvasStore): boolean {
    const id = store.picked[0]
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (!node || (node.type !== 'text' && node.type !== 'shape')) return false

    store.editing = node.id
    return true
  },

  stroke(store: CanvasStore, pending: PendingStroke) {
    if (!pending.points.length) return

    const { opacity, ...rest } = pending
    const own = INK_STYLES[pending.tool].opacity
    const stroke = { id: freshId(), ...rest, ...(opacity === own ? {} : { opacity }) }

    store.edit(withStroke(store.canvas, tidied(stroke)))
  },

  eraseAll(store: CanvasStore) {
    if (!store.canvas.ink.length) return

    store.edit({ ...store.canvas, ink: [] })
  },

  rub(store: CanvasStore, ats: readonly Point[], reach: number, run?: string) {
    store.edit(rubbedOut(store.canvas, ats, reach, true), run)
  },

  cut(store: CanvasStore, ats: readonly Point[], reach: number, run?: string) {
    store.edit(rubbedOut(store.canvas, ats, reach, false), run)
  },

  lasso(store: CanvasStore, points: readonly Point[], partly = false, cards = false) {
    const ink = strokesInLasso(store.canvas.ink, points, partly)
    if (!cards) {
      store.pickAll(ink)
      return
    }
    store.pickAll([...cardsInLasso(store.canvas.nodes, points, partly), ...ink])
  },

  remove(store: CanvasStore) {
    if (!store.picked.length) return

    store.edit(removed(store.canvas, store.picked))
    store.clearPicked()
  },

  duplicate(store: CanvasStore): boolean {
    if (!store.picked.length) return false

    const made = copied(store.canvas, store.picked)
    store.edit(made.canvas)
    store.pickAll(made.ids)
    return true
  },

  nudge(store: CanvasStore, dx: number, dy: number) {
    if (!store.picked.length) return

    store.edit(movedBy(store.canvas, store.picked, dx, dy))
  },

  align(store: CanvasStore, how: Alignment) {
    store.edit(aligned(store.canvas, store.picked, how))
  },

  distribute(store: CanvasStore, axis: 'x' | 'y') {
    store.edit(distributed(store.canvas, store.picked, axis))
  },

  order(store: CanvasStore, how: Order) {
    store.edit(ordered(store.canvas, store.picked, how))
  },

  colour(store: CanvasStore, colour: string | null) {
    if (!store.picked.length) return

    store.edit(coloured(store.canvas, store.picked, colour))
  },

  ends(store: CanvasStore, from: boolean, to: boolean) {
    store.edit(withEnds(store.canvas, store.picked, from, to))
  },

  paste(store: CanvasStore, incoming: Canvas, text: string, at: Point) {
    if (incoming.nodes.length || incoming.ink.length) {
      const box = bounds([...incoming.nodes, ...incoming.ink.map(strokeBox)])
      const dx = box ? Math.round(at.x - box.x - box.width / 2) : 0
      const dy = box ? Math.round(at.y - box.y - box.height / 2) : 0
      const made = pasted(store.canvas, incoming, dx, dy)

      store.edit(made.canvas)
      store.pickAll(made.ids)
      return
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
      putLink(store, text, placedAt(at, DEFAULT_WIDTH, GRID * 4))
    } else {
      putText(store, text, placedAt(at, DEFAULT_WIDTH, DEFAULT_HEIGHT))
    }
  },

  dropPaths(store: CanvasStore, paths: readonly string[], at: Point) {
    const root = canvasRoot(store)
    if (!root) return

    let next = store.canvas
    const ids: string[] = []

    const inside = paths.flatMap((path) => withinSpace(root, path) ?? [])
    for (const [index, file] of inside.entries()) {
      const id = freshId()
      const box = placedAt({ x: at.x, y: at.y + index * GRID * 10 }, DEFAULT_WIDTH, GRID * 9)
      next = withNode(next, { ...box, id, type: 'file', file })
      ids.push(id)
    }
    if (!ids.length) return

    store.edit(next)
    store.pickAll(ids)
  },

  async dropImage(store: CanvasStore, file: File, where: Point | Box, notePath: string | null) {
    if (store.readOnly) return
    const stored = await storeImage(file, notePath).catch(() => null)
    if (!stored) return

    const root = canvasRoot(store)
    const relative =
      accountAddress(stored) ?? (root && notePath ? spaceRelative(root, notePath, stored) : stored)
    if (!relative) return
    const size = ownSize('picture')
    const box = 'width' in where ? where : placedAt(where, size.width, size.height)

    putFile(store, relative, box)
  },

  async dropPdf(store: CanvasStore, file: File, at: Point, notePath: string | null) {
    if (!notePath || store.readOnly) return

    const bytes = new Uint8Array(await file.arrayBuffer())
    const library = await pdfjs()
    const task = loading(library, bytes)

    try {
      const doc = await task.promise.catch(() => null)
      if (!doc?.numPages) {
        busy.failed(t('That file could not be read'))
        return
      }

      const mode = await prompt.choose({
        title: t('Import PDF'),
        detail: t('Choose how to add the pages to the canvas.'),
        options: [
          { id: 'single', label: t('Single page'), primary: true },
          { id: 'all', label: t('All pages') },
        ],
      })
      if (!mode) return

      let pages: number[]
      if (mode === 'single') {
        const selected =
          doc.numPages === 1
            ? '1'
            : await prompt.find({
                title: t('Choose a page'),
                placeholder: t('Search'),
                options: Array.from({ length: doc.numPages }, (_, index) => ({
                  id: String(index + 1),
                  label: t('Page {number}', { number: index + 1 }),
                })),
              })
        if (!selected) return
        pages = [Number(selected)]
      } else {
        pages = Array.from({ length: doc.numPages }, (_, index) => index + 1)
      }

      const root = canvasRoot(store)
      if (!root) return

      const made: Parameters<typeof withNode>[1][] = []
      let y = at.y
      for (const number of pages) {
        const page = await doc.getPage(number)
        const natural = page.getViewport({ scale: PDF_TO_CSS })
        const area = natural.width * natural.height * 4
        const scale = area > 16 * 1024 * 1024 ? 2 * Math.sqrt((16 * 1024 * 1024) / area) : 2
        const viewport = page.getViewport({ scale: PDF_TO_CSS * scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        const context = canvas.getContext('2d')
        if (!context) {
          page.cleanup()
          continue
        }
        await page.render({ canvas, canvasContext: context, viewport }).promise
        page.cleanup()
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        )
        if (!blob) continue

        const image = new File([blob], `${file.name.replace(/\.pdf$/i, '')}-page-${number}.png`, {
          type: 'image/png',
        })
        const stored = await storeImage(image, notePath)
        if (!stored) continue
        const relative = stored.startsWith('http') ? stored : spaceRelative(root, notePath, stored)
        if (!relative) continue

        const width = Math.round(natural.width)
        const height = Math.round(natural.height)
        const box =
          mode === 'single'
            ? placedAt(at, width, height)
            : placedAt({ x: at.x, y: y + height / 2 }, width, height)
        made.push({ ...box, id: freshId(), type: 'file', file: relative })
        y += height + GRID
      }

      if (made.length) {
        store.edit(made.reduce((next, node) => withNode(next, node), store.canvas))
        store.pickAll(made.map((node) => node.id))
      }
    } finally {
      await task.destroy().catch(() => undefined)
    }
  },

  async open(store: CanvasStore, hit: Hit, at: Point) {
    if (hit.edge) {
      await askLabel(store, hit.edge)
      return
    }

    const node = hit.node ? store.canvas.nodes.find((one) => one.id === hit.node) : null

    if (!node) {
      putText(store, '', placedAt(at, DEFAULT_WIDTH, DEFAULT_HEIGHT), true)
      return
    }

    switch (node.type) {
      case 'text':
        if (store.readOnly) break
        store.pick(node.id)
        store.editing = node.id
        break
      case 'group':
        await askLabel(store, node.id)
        break
      case 'link':
        openHref(node.url)
        break
      case 'file': {
        if (/^https?:\/\//i.test(node.file)) {
          openHref(node.file)
          break
        }
        const root = canvasRoot(store)
        if (root) await workspace.openEntry(insideSpace(root, node.file))
        break
      }
      case 'shape':
        if (store.readOnly) break
        store.pick(node.id)
        store.editing = node.id
        break
      case 'page':
        break
    }
  },

  async toNote(store: CanvasStore, canvasPath: string | null) {
    const id = store.picked[0]
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (node?.type !== 'text' || !node.text.trim()) return

    const root = canvasRoot(store)
    const folder = canvasPath === null ? root : folderOf(canvasPath)
    const path = await workspace.noteFrom(node.text, folder ?? undefined)
    if (!path || !root) return

    store.edit({
      ...store.canvas,
      nodes: store.canvas.nodes.map((one) =>
        one.id === node.id
          ? {
              id: one.id,
              type: 'file',
              x: one.x,
              y: one.y,
              width: one.width,
              height: one.height,
              file: relativeTo(root, path),
              ...(one.color === undefined ? {} : { color: one.color }),
            }
          : one,
      ),
    })
  },

  keys(store: CanvasStore, event: KeyboardEvent, view: KeyView): boolean {
    const tool = toolPressed(event)
    if (tool) {
      tools.pressed(tool, event)
      return true
    }

    const step = event.shiftKey ? GRID : NUDGE
    const arrow = { ...keystroke(event), shiftKey: false }
    const nudge = NUDGES.find(([id]) => shortcuts.pressed(id, arrow))
    if (nudge) {
      if (!store.picked.length) return false

      run.nudge(store, nudge[1] * step, nudge[2] * step)
      return true
    }

    if (
      shortcuts.pressed('canvas.delete', event) ||
      shortcuts.pressed('canvas.delete.alt', event)
    ) {
      if (!store.picked.length) return false

      run.remove(store)
      return true
    }

    for (const [id, act] of ACTS) {
      if (!shortcuts.pressed(id, event)) continue

      return act(store, view) !== false
    }

    return false
  },
}

export function toolPressed(event: KeyboardEvent): Tool | null {
  return TOOL_KEYS.find(([id]) => shortcuts.pressed(id, event))?.[1] ?? null
}

const TOOL_KEYS: readonly (readonly [string, Tool])[] = [
  ['canvas.tool.select', 'select'],
  ['canvas.tool.hand', 'hand'],
  ['canvas.tool.draw', 'draw'],
  ['canvas.tool.erase', 'erase'],
  ['canvas.tool.lasso', 'lasso'],
  ['canvas.tool.text', 'text'],
  ['canvas.tool.words', 'words'],
  ['canvas.tool.file', 'file'],
  ['canvas.tool.picture', 'picture'],
  ['canvas.tool.link', 'link'],
  ['canvas.tool.group', 'group'],
  ['canvas.tool.rect', 'rect'],
  ['canvas.tool.ellipse', 'ellipse'],
  ['canvas.tool.rhombus', 'rhombus'],
  ['canvas.tool.triangle', 'triangle'],
  ['canvas.tool.line', 'line'],
  ['canvas.tool.arrow', 'arrow'],
  ['canvas.tool.elbow', 'elbow'],
]

function keystroke(event: KeyboardEvent): Keystroke {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
  }
}

const NUDGES: readonly (readonly [string, number, number])[] = [
  ['canvas.nudge.left', -1, 0],
  ['canvas.nudge.right', 1, 0],
  ['canvas.nudge.up', 0, -1],
  ['canvas.nudge.down', 0, 1],
]

const ACTS: readonly (readonly [string, (store: CanvasStore, view: KeyView) => unknown])[] = [
  ['canvas.duplicate', (store) => run.duplicate(store)],
  ['canvas.write', (store) => run.write(store)],
  ['canvas.group', (store) => run.group(store)],
  ['canvas.ungroup', (store) => run.ungroup(store)],
  ['canvas.fit', (store, view) => store.fit(view.width, view.height)],
  ['canvas.zoom.in', (store, view) => zoomedBy(store, view, NOTCH)],
  ['canvas.zoom.out', (store, view) => zoomedBy(store, view, 1 / NOTCH)],
  ['canvas.zoom.actual', (store, view) => actualSize(store, view)],
  ['canvas.upright', (store, view) => upright(store, view)],
  ['canvas.frame', (store, view) => store.frame(view.width, view.height)],
  ['canvas.find', (_store, view) => view.onfind()],
  ['canvas.front', (store) => run.order(store, 'front')],
  ['canvas.forward', (store) => run.order(store, 'forward')],
  ['canvas.back', (store) => run.order(store, 'back')],
  ['canvas.backward', (store) => run.order(store, 'backward')],
]

function upright(store: CanvasStore, view: { width: number; height: number }): boolean {
  const turn = turnOf(store.camera)
  if (!turn) return false

  const { width, height } = view
  store.camera = turned(store.camera, width, height, width / 2, height / 2, -turn)
  return true
}

export function actualSize(store: CanvasStore, view: { width: number; height: number }) {
  const { width, height } = view
  store.camera = zoomed(store.camera, width, height, width / 2, height / 2, 1 / store.camera.scale)
}

function zoomedBy(store: CanvasStore, view: KeyView, by: number) {
  const { width, height } = view
  store.camera = zoomed(store.camera, width, height, width / 2, height / 2, by)
}

export interface KeyView {
  width: number
  height: number
  path: string | null
  name: string
  palette: Palette
  onfind: () => void
}

function putText(store: CanvasStore, text: string, box: Box, writing = false) {
  if (store.readOnly) return
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'text', text }))
  store.pick(id)
  if (writing) store.editing = id
}

export function putWords(store: CanvasStore, box: Box) {
  if (store.readOnly) return
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'text', text: '', bare: true }))
  store.pick(id)
  store.editing = id
  tools.choose('select')
}

function putLink(store: CanvasStore, url: string, box: Box) {
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'link', url }))
  store.pick(id)
}

function putFile(store: CanvasStore, file: string, box: Box) {
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'file', file }))
  store.pick(id)
}

async function askLabel(store: CanvasStore, id: string) {
  if (store.readOnly) return
  const node = store.canvas.nodes.find((one) => one.id === id)
  const was =
    node?.type === 'group'
      ? (node.label ?? '')
      : (store.canvas.edges.find((one) => one.id === id)?.label ?? '')

  const answer = await prompt.ask({ title: t('Name this'), value: was, confirmLabel: key('Save') })
  if (answer !== null) store.edit(withLabel(store.canvas, id, answer))
}

function ownSize(tool: PutTool): { width: number; height: number } {
  if (isShape(tool)) return { width: GRID * 6, height: GRID * 4 }

  switch (tool) {
    case 'text':
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
    case 'words':
      return { width: GRID * 12, height: GRID * 2 }
    case 'file':
      return { width: DEFAULT_WIDTH, height: GRID * 9 }
    case 'picture':
      return { width: GRID * 16, height: Math.round(GRID * 16 * 0.7) }
    case 'link':
      return { width: DEFAULT_WIDTH, height: GRID * 4 }
    case 'group':
      return { width: GRID * 20, height: GRID * 12 }
  }
}

export interface Putting {
  colour: string
  path: string | null
}

function canvasRoot(store: CanvasStore): string | null {
  return workspace.rootHolding(store.path)
}

export async function place(store: CanvasStore, tool: PutTool, at: Point, putting: Putting) {
  const size = ownSize(tool)
  await putDown(
    store,
    tool,
    tool === 'words' ? wordsAt(at) : placedAt(at, size.width, size.height),
    putting,
  )
}

export function wordsAt(at: Point): Box {
  const { width, height } = ownSize('words')
  return { x: Math.round(at.x), y: Math.round(at.y - height / 2), width, height }
}

export async function pull(
  store: CanvasStore,
  tool: PutTool,
  from: Point,
  to: Point,
  putting: Putting,
) {
  await putDown(store, tool, rectBetween(from, to), putting, from, to)
}

async function putDown(
  store: CanvasStore,
  tool: PutTool,
  box: Box,
  putting: Putting,
  from?: Point,
  to?: Point,
) {
  if (store.readOnly) return
  if (isShape(tool)) {
    const corner = from ?? { x: box.x, y: box.y }
    const other = to ?? { x: box.x + box.width, y: box.y + box.height }
    run.shape(store, tool, corner, other, putting.colour)
    return
  }

  switch (tool) {
    case 'text':
      putText(store, '', box, true)
      return
    case 'words':
      putWords(store, box)
      return
    case 'group': {
      const id = freshId()
      store.edit(withGroup(store.canvas, { ...box, id, type: 'group' }))
      store.pick(id)
      return
    }
    case 'link': {
      const url = await prompt.ask({
        title: t('Which address'),
        placeholder: t('Address'),
        confirmLabel: key('Add'),
      })
      if (url) putLink(store, url, box)
      return
    }
    case 'file': {
      const root = canvasRoot(store)
      if (!root) return

      const chosen = await prompt.find({
        title: t('Which note'),
        placeholder: t('Search'),
        options: workspace.shownFiles.flatMap((one) => {
          const relative = withinSpace(root, one.path)
          return relative ? [{ id: relative, label: relative }] : []
        }),
      })

      if (chosen) putFile(store, chosen, box)
      return
    }
    case 'picture': {
      const [file] = await chooseFiles({ accept: PICTURES })
      if (!file) return

      await run.dropImage(store, file, box, putting.path)
      return
    }
  }
}

export interface MenuView extends KeyView {
  narrowed: boolean
  onnarrow: () => void
  trusted: boolean
  bare: boolean
  again: (rows: MenuEntry[], title: string) => void
  locked: string | null
}

function sections(...groups: readonly MenuEntry[][]): MenuEntry[] {
  return groups
    .filter((one) => one.length)
    .flatMap((one, index) => (index ? [DIVIDER, ...one] : one))
}

export function canvasMenu(store: CanvasStore, at: Point, view: MenuView): MenuEntry[] {
  const picked = store.picked.length > 0
  const several = store.picked.length > 1
  const many = store.picked.length > 2
  const chosen = new Set(store.picked)
  const onEdge = picked && store.canvas.edges.some((edge) => chosen.has(edge.id))
  const cards = picked ? store.canvas.nodes.filter((node) => chosen.has(node.id)) : []
  const onCard = store.picked.length === 1 && cards[0]?.type === 'text'
  const onFrame = cards.some((node) => node.type === 'group')
  const onNode = cards.length > 0
  const locked = view.locked
  const putting = { colour: tools.colour, path: view.path }

  const arranging = arrangeRows(store, several, many)

  return sections(
    locked ? [{ label: t('Unlock'), run: () => run.unlock(store, locked) }] : [],
    view.bare
      ? [
          { label: t('Card'), run: () => void place(store, 'text', at, putting) },
          { label: t('Note'), run: () => void place(store, 'file', at, putting) },
          { label: t('Picture'), run: () => void place(store, 'picture', at, putting) },
          { label: t('Link'), run: () => void place(store, 'link', at, putting) },
          { label: t('Frame'), run: () => void place(store, 'group', at, putting) },
        ]
      : [],
    picked
      ? [
          { label: t('Duplicate'), run: () => run.duplicate(store) },
          { label: t('Delete'), danger: true, run: () => run.remove(store) },
          ...(onCard
            ? [{ label: t('Turn into a note'), run: () => void run.toNote(store, view.path) }]
            : []),
          { label: t('Group'), run: () => run.group(store) },
          ...(onFrame ? [{ label: t('Ungroup'), run: () => run.ungroup(store) }] : []),
          ...(onNode ? [{ label: t('Lock'), run: () => run.lock(store) }] : []),
          {
            label: t('Arrange'),
            more: () => Promise.resolve(arranging),
            run: () => view.again(arranging, t('Arrange')),
          },
        ]
      : [],
    onEdge
      ? [
          { label: t('Arrow at the end'), run: () => run.ends(store, false, true) },
          { label: t('Arrow at the start'), run: () => run.ends(store, true, false) },
          { label: t('Arrows at both ends'), run: () => run.ends(store, true, true) },
          { label: t('No arrows'), run: () => run.ends(store, false, false) },
        ]
      : [],
    [
      { label: t('Find on the canvas'), run: view.onfind },
      { label: t('Fit the canvas'), run: () => store.fit(view.width, view.height) },
      ...(turnOf(store.camera)
        ? [{ label: t('Turn upright'), run: () => void upright(store, view) }]
        : []),
      ...(picked
        ? [
            {
              label: t('Zoom to what is picked'),
              run: () => store.frame(view.width, view.height),
            },
          ]
        : []),
      ...(picked || view.narrowed
        ? [
            {
              label: view.narrowed ? t('Show the whole canvas') : t('Narrow to what is picked'),
              run: view.onnarrow,
            },
          ]
        : []),
    ],
    [
      { label: t('Export as PNG'), run: () => void exportAs(store, view, 'png') },
      { label: t('Export as SVG'), run: () => void exportAs(store, view, 'svg') },
      { label: t('Export as PDF'), run: () => void exportAs(store, view, 'pdf') },
    ],
  )
}

function arrangeRows(store: CanvasStore, several: boolean, many: boolean): MenuEntry[] {
  return sections(
    [
      { label: t('Bring to front'), run: () => run.order(store, 'front') },
      { label: t('Bring forward'), run: () => run.order(store, 'forward') },
      { label: t('Send backward'), run: () => run.order(store, 'backward') },
      { label: t('Send to back'), run: () => run.order(store, 'back') },
    ],
    several
      ? [
          { label: t('Align left'), run: () => run.align(store, 'left') },
          { label: t('Align centre'), run: () => run.align(store, 'centre') },
          { label: t('Align right'), run: () => run.align(store, 'right') },
          { label: t('Align top'), run: () => run.align(store, 'top') },
          { label: t('Align middle'), run: () => run.align(store, 'middle') },
          { label: t('Align bottom'), run: () => run.align(store, 'bottom') },
        ]
      : [],
    many
      ? [
          { label: t('Spread across'), run: () => run.distribute(store, 'x') },
          { label: t('Spread down'), run: () => run.distribute(store, 'y') },
        ]
      : [],
  )
}

async function exportAs(store: CanvasStore, view: MenuView, how: 'png' | 'svg' | 'pdf') {
  const picture = await import('./picture')
  const drawing = {
    canvas: store.canvas,
    palette: view.palette,
    path: view.path,
    root: canvasRoot(store),
    name: view.name,
    trusted: view.trusted,
  }

  if (how === 'png') await picture.exportCanvasPng(drawing)
  else if (how === 'svg') await picture.exportCanvasSvg(drawing)
  else await picture.exportCanvasPdf(drawing)
}
