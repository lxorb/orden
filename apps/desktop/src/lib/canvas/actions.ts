/** Everything a canvas can be asked to do, in one place.
 *
 *  A gesture, a key and a menu row are three ways of asking for the same thing,
 *  and this is the thing. The surface next door owns the pointer and the layers;
 *  what happens when something is deleted, duplicated, lined up, coloured or
 *  turned into a note is here, once, so the three ways cannot drift apart.
 *
 *  Everything takes the store and hands nothing back. What is picked, what the
 *  canvas holds and what can be taken back all live there; these are verbs. */

import { type Alignment, aligned, distributed, type Order, ordered } from './arrange'
import {
  connected,
  copied,
  coloured,
  cutInk,
  movedBy,
  pasted,
  placedAt,
  removed,
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
  type Shape,
  type Side,
} from './format'
import { boxOf, facingSide, GRID, type Point } from './geometry'
import { erased, nearStroke, strokesInLasso, tidied } from './ink'
import type { Palette } from './paint'
import type { Hit, PendingStroke, Tool } from './pointer'
import type { CanvasStore } from './store.svelte'
import { tools } from './tools.svelte'
import { storeImage } from '../assets'
import { t, key } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { insideSpace, relativeTo } from '../space-paths'
import { openExternal } from '../tauri'
import { workspace } from '../workspace.svelte'

/** How far a nudge moves a card: one pixel with a bare arrow key, one grid step
 *  with Shift, which is the pair every drawing program has. */
const NUDGE = 1

export const run = {
  connect(store: CanvasStore, from: string, fromSide: Side, to: string, toSide: Side | 'auto') {
    const target = store.canvas.nodes.find((node) => node.id === to)
    const source = store.canvas.nodes.find((node) => node.id === from)
    if (!target || !source) return

    const side = toSide === 'auto' ? facingSide(boxOf(target), boxOf(source)) : toSide
    const made = connected(store.canvas, from, fromSide, to, side)
    store.edit(made.canvas)
    if (made.id) store.pick(made.id)
  },

  shape(store: CanvasStore, shape: Shape, from: Point, to: Point, colour: string) {
    const made = withShape(store.canvas, shape, from, to, colour === 'ink' ? undefined : colour)
    store.edit(made.canvas)
    store.pick(made.id)
  },

  /** A stroke of ink, tidied on the way in: a digitiser reports far more points
   *  than a line needs, and the ones it drops are the ones that say nothing. */
  stroke(store: CanvasStore, pending: PendingStroke) {
    if (pending.points.length < 2) return

    store.edit(withStroke(store.canvas, tidied({ id: freshId(), ...pending })))
  },

  /** Whole strokes gone, which is what the stroke eraser does: touch a line
   *  anywhere and the line goes. */
  rub(store: CanvasStore, ids: readonly string[]) {
    if (!ids.length) return

    const going = new Set(ids)
    store.edit({ ...store.canvas, ink: store.canvas.ink.filter((one) => !going.has(one.id)) })
  },

  /** A hole rubbed through whatever is under the eraser, which may leave the two
   *  ends of a line behind. Every point of the drag is one of these, so the plane
   *  answers under the nib rather than when it is lifted. */
  cut(store: CanvasStore, at: Point, reach: number) {
    const next = cutInk(store.canvas, (stroke) =>
      nearStroke(stroke, at, reach) ? erased(stroke, at, reach) : [stroke],
    )

    store.edit(next)
  },

  /** What a loop caught. Only strokes a loop went right round, so half a word is
   *  never dragged away from the other half. */
  lasso(store: CanvasStore, points: readonly Point[]) {
    store.pickAll(strokesInLasso(store.canvas.ink, points))
  },

  remove(store: CanvasStore) {
    if (!store.picked.length) return

    store.edit(removed(store.canvas, store.picked))
    store.clearPicked()
  },

  duplicate(store: CanvasStore) {
    if (!store.picked.length) return

    const made = copied(store.canvas, store.picked)
    store.edit(made.canvas)
    store.pickAll(made.ids)
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

  /** Which way the arrows on the picked connectors point. */
  ends(store: CanvasStore, from: boolean, to: boolean) {
    store.edit(withEnds(store.canvas, store.picked, from, to))
  },

  /** Cards from a clipboard: another canvas, an address, or some words. */
  paste(store: CanvasStore, incoming: Canvas, text: string, at: Point) {
    if (incoming.nodes.length || incoming.ink.length) {
      // Centred on the pointer, so a paste lands where the reader is looking
      // rather than where the cards happened to be in the canvas they came from.
      const box = spanOf(incoming)
      const dx = box ? Math.round(at.x - box.x - box.width / 2) : 0
      const dy = box ? Math.round(at.y - box.y - box.height / 2) : 0
      const made = pasted(store.canvas, incoming, dx, dy)

      store.edit(made.canvas)
      store.pickAll(made.ids)
      return
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) putLink(store, text, at)
    else putText(store, text, at)
  },

  /** Notes and pictures dragged out of the file list. Several of them go one
   *  under the other, which is where a hand dropping a folder's worth would put
   *  them anyway. */
  dropPaths(store: CanvasStore, paths: readonly string[], at: Point) {
    const root = workspace.activeSpace?.root
    if (!root) return

    let next = store.canvas
    const ids: string[] = []

    for (const [index, path] of paths.entries()) {
      const id = freshId()
      const box = placedAt({ x: at.x, y: at.y + index * GRID * 10 }, DEFAULT_WIDTH, GRID * 9)
      next = withNode(next, { ...box, id, type: 'file', file: relativeTo(root, path) })
      ids.push(id)
    }

    store.edit(next)
    store.pickAll(ids)
  },

  /** A picture pasted or dropped: stored where every other pasted picture goes,
   *  and put on the plane as a card of its own. */
  async dropImage(store: CanvasStore, file: File, at: Point, notePath: string | null) {
    const stored = await storeImage(file, notePath).catch(() => null)
    if (!stored) return

    const root = workspace.activeSpace?.root
    const relative = root && !stored.startsWith('http') ? relativeTo(root, stored) : stored
    const id = freshId()
    const wide = GRID * 16

    store.edit(
      withNode(store.canvas, {
        ...placedAt(at, wide, Math.round(wide * 0.7)),
        id,
        type: 'file',
        file: relative,
      }),
    )
    store.pick(id)
  },

  /** What a double click means, wherever it landed. */
  async open(store: CanvasStore, hit: Hit, at: Point) {
    if (hit.edge) {
      await askLabel(store, hit.edge)
      return
    }

    const node = hit.node ? store.canvas.nodes.find((one) => one.id === hit.node) : null

    if (!node) {
      putText(store, '', at, true)
      return
    }

    switch (node.type) {
      case 'text':
        store.pick(node.id)
        store.editing = node.id
        break
      case 'group':
        await askLabel(store, node.id)
        break
      case 'link':
        await openExternal(node.url)
        break
      case 'file': {
        const root = workspace.activeSpace?.root
        if (root) await workspace.openEntry(insideSpace(root, node.file))
        break
      }
      case 'shape':
        store.pick(node.id)
        break
    }
  },

  /** A card that has outgrown its box, as a note beside the canvas, with the
   *  card left behind pointing at it. */
  async toNote(store: CanvasStore, canvasPath: string | null) {
    const id = store.picked[0]
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (node?.type !== 'text' || !node.text.trim()) return

    const root = workspace.activeSpace?.root
    const folder = canvasPath === null ? root : folderOfPath(canvasPath)
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

  /** The keys the plane answers to on its own. Answers whether it took the key,
   *  so the surface knows whether to stop it going anywhere else. */
  keys(store: CanvasStore, event: KeyboardEvent, view: KeyView): boolean {
    const adds = event.ctrlKey || event.metaKey
    const step = event.shiftKey ? GRID : NUDGE

    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        if (!store.picked.length) return false
        run.remove(store)
        return true
      case 'ArrowLeft':
        run.nudge(store, -step, 0)
        return store.picked.length > 0
      case 'ArrowRight':
        run.nudge(store, step, 0)
        return store.picked.length > 0
      case 'ArrowUp':
        run.nudge(store, 0, -step)
        return store.picked.length > 0
      case 'ArrowDown':
        run.nudge(store, 0, step)
        return store.picked.length > 0
    }

    if (adds) {
      switch (event.key.toLowerCase()) {
        case '0':
          store.fit(view.width, view.height)
          return true
        case '1':
          store.frame(view.width, view.height)
          return true
        case 'd':
          run.duplicate(store)
          return true
        case 'f':
          view.onfind()
          return true
        case ']':
          run.order(store, event.shiftKey ? 'front' : 'forward')
          return true
        case '[':
          run.order(store, event.shiftKey ? 'back' : 'backward')
          return true
      }
    }

    // A tool by its own letter, the way every drawing program does it, and only
    // with no modifier, so Ctrl+V is still a paste.
    if (!adds && !event.altKey) {
      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool) {
        tools.choose(tool)
        return true
      }
    }

    return false
  },
}

export interface KeyView {
  width: number
  height: number
  path: string | null
  name: string
  palette: Palette
  onfind: () => void
}

/** One letter each, on the keys they sit under on a keyboard: v for the arrow,
 *  h for the hand, and the first letter of everything else. */
const TOOL_KEYS: Record<string, Tool | undefined> = {
  v: 'select',
  h: 'hand',
  d: 'draw',
  e: 'erase',
  q: 'lasso',
  c: 'text',
  n: 'file',
  k: 'link',
  g: 'group',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
}

function folderOfPath(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : path
}

function spanOf(canvas: Canvas) {
  const [first] = canvas.nodes
  if (!first) return null

  let least = first.x
  let most = first.x + first.width
  let lowest = first.y
  let highest = first.y + first.height

  for (const node of canvas.nodes) {
    least = Math.min(least, node.x)
    most = Math.max(most, node.x + node.width)
    lowest = Math.min(lowest, node.y)
    highest = Math.max(highest, node.y + node.height)
  }

  return { x: least, y: lowest, width: most - least, height: highest - lowest }
}

function putText(store: CanvasStore, text: string, at: Point, writing = false) {
  const id = freshId()
  store.edit(
    withNode(store.canvas, {
      ...placedAt(at, DEFAULT_WIDTH, DEFAULT_HEIGHT),
      id,
      type: 'text',
      text,
    }),
  )
  store.pick(id)
  // A card made by hand is a card somebody is about to write in.
  if (writing) store.editing = id
}

function putLink(store: CanvasStore, url: string, at: Point) {
  const id = freshId()
  store.edit(
    withNode(store.canvas, { ...placedAt(at, DEFAULT_WIDTH, GRID * 4), id, type: 'link', url }),
  )
  store.pick(id)
}

async function askLabel(store: CanvasStore, id: string) {
  const node = store.canvas.nodes.find((one) => one.id === id)
  const was =
    node?.type === 'group'
      ? (node.label ?? '')
      : (store.canvas.edges.find((one) => one.id === id)?.label ?? '')

  const answer = await prompt.ask({ title: t('Name this'), value: was, confirmLabel: key('Save') })
  if (answer !== null) store.edit(withLabel(store.canvas, id, answer))
}

/** What a tool puts on the plane where it was pressed. A tool that puts nothing
 *  down - the arrow, the hand, the pen - has nothing to do here. */
export async function place(store: CanvasStore, tool: Tool, at: Point) {
  switch (tool) {
    case 'text':
      putText(store, '', at, true)
      return
    case 'group': {
      // Room enough to put a handful of cards in, which is what a frame is for.
      const id = freshId()
      store.edit(
        withGroup(store.canvas, { ...placedAt(at, GRID * 20, GRID * 12), id, type: 'group' }),
      )
      store.pick(id)
      return
    }
    case 'link': {
      const url = await prompt.ask({
        title: t('Which address'),
        placeholder: t('Address'),
        confirmLabel: key('Add'),
      })
      if (url) putLink(store, url, at)
      return
    }
    case 'file': {
      const root = workspace.activeSpace?.root
      if (!root) return

      const chosen = await prompt.find({
        title: t('Which note'),
        placeholder: t('Search'),
        options: workspace.files.map((one) => {
          const relative = relativeTo(root, one.path)
          return { id: relative, label: relative }
        }),
      })

      if (!chosen) return

      const id = freshId()
      store.edit(
        withNode(store.canvas, {
          ...placedAt(at, DEFAULT_WIDTH, GRID * 9),
          id,
          type: 'file',
          file: chosen,
        }),
      )
      store.pick(id)
      return
    }
    // A tool that puts nothing down: the arrow, the hand, and the three a pen
    // wants, which draw rather than place.
    case 'select':
    case 'hand':
    case 'draw':
    case 'erase':
    case 'lasso':
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return
  }
}

export interface MenuView extends KeyView {
  narrowed: boolean
  onnarrow: () => void
}

/** The menu, which is the whole of what a canvas can do, written down. What a
 *  reader cannot find a key for they find here. */
export function canvasMenu(store: CanvasStore, at: Point, view: MenuView): MenuEntry[] {
  const picked = store.picked.length > 0
  const several = store.picked.length > 1
  const many = store.picked.length > 2
  const onEdge = store.picked.some((id) => store.canvas.edges.some((edge) => edge.id === id))
  const onCard =
    store.picked.length === 1 &&
    store.canvas.nodes.find((one) => one.id === store.picked[0])?.type === 'text'

  return [
    { label: t('Card'), run: () => void place(store, 'text', at) },
    { label: t('Note or picture'), run: () => void place(store, 'file', at) },
    { label: t('Link'), run: () => void place(store, 'link', at) },
    { label: t('Group'), run: () => void place(store, 'group', at) },
    DIVIDER,
    { label: t('Duplicate'), disabled: !picked, run: () => run.duplicate(store) },
    { label: t('Delete'), danger: true, disabled: !picked, run: () => run.remove(store) },
    ...(onCard
      ? [{ label: t('Turn into a note'), run: () => void run.toNote(store, view.path) }]
      : []),
    DIVIDER,
    { label: t('Bring to front'), disabled: !picked, run: () => run.order(store, 'front') },
    { label: t('Bring forward'), disabled: !picked, run: () => run.order(store, 'forward') },
    { label: t('Send backward'), disabled: !picked, run: () => run.order(store, 'backward') },
    { label: t('Send to back'), disabled: !picked, run: () => run.order(store, 'back') },
    DIVIDER,
    { label: t('Align left'), disabled: !several, run: () => run.align(store, 'left') },
    { label: t('Align centre'), disabled: !several, run: () => run.align(store, 'centre') },
    { label: t('Align right'), disabled: !several, run: () => run.align(store, 'right') },
    { label: t('Align top'), disabled: !several, run: () => run.align(store, 'top') },
    { label: t('Align middle'), disabled: !several, run: () => run.align(store, 'middle') },
    { label: t('Align bottom'), disabled: !several, run: () => run.align(store, 'bottom') },
    { label: t('Spread across'), disabled: !many, run: () => run.distribute(store, 'x') },
    { label: t('Spread down'), disabled: !many, run: () => run.distribute(store, 'y') },
    ...(onEdge
      ? [
          DIVIDER,
          { label: t('Arrow at the end'), run: () => run.ends(store, false, true) },
          { label: t('Arrow at the start'), run: () => run.ends(store, true, false) },
          { label: t('Arrows at both ends'), run: () => run.ends(store, true, true) },
          { label: t('No arrows'), run: () => run.ends(store, false, false) },
        ]
      : []),
    DIVIDER,
    { label: t('Find on the canvas'), run: view.onfind },
    { label: t('Fit the canvas'), run: () => store.fit(view.width, view.height) },
    {
      label: t('Zoom to what is picked'),
      disabled: !picked,
      run: () => store.frame(view.width, view.height),
    },
    {
      label: view.narrowed ? t('Show the whole canvas') : t('Narrow to what is picked'),
      disabled: !picked && !view.narrowed,
      run: view.onnarrow,
    },
    DIVIDER,
    { label: t('Export as PNG'), run: () => void exportAs(store, view, 'png') },
    { label: t('Export as SVG'), run: () => void exportAs(store, view, 'svg') },
    { label: t('Export as PDF'), run: () => void exportAs(store, view, 'pdf') },
  ]
}

async function exportAs(store: CanvasStore, view: MenuView, how: 'png' | 'svg' | 'pdf') {
  const picture = await import('./picture')
  const drawing = {
    canvas: store.canvas,
    palette: view.palette,
    path: view.path,
    root: workspace.activeSpace?.root ?? null,
    name: view.name,
  }

  if (how === 'png') await picture.exportCanvasPng(drawing)
  else if (how === 'svg') await picture.exportCanvasSvg(drawing)
  else await picture.exportCanvasPdf(drawing)
}
