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
import { erased, INK_STYLES, nearStroke, strokesInLasso, tidied } from './ink'
import type { Palette } from './paint'
import type { Hit, PendingStroke, Tool } from './pointer'
import type { CanvasStore } from './store.svelte'
import { tools } from './tools.svelte'
import { shortcuts } from '../shortcuts.svelte'
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
    // One point is a dot, which is a stroke like any other. None at all is
    // nothing, and cannot happen: a stroke starts at the point the pen went down.
    if (!pending.points.length) return

    // The alpha is written down only where it is not the one this kind of pen has
    // by itself, so a plane drawn by somebody who never touched the dial is the
    // same bytes it was before there was a dial.
    const { opacity, ...rest } = pending
    const own = INK_STYLES[pending.tool].opacity
    const stroke = { id: freshId(), ...rest, ...(opacity === own ? {} : { opacity }) }

    store.edit(withStroke(store.canvas, tidied(stroke)))
  },

  /** Every stroke on the plane, gone, which is what the eraser's own row asks
   *  for. One edit, so one press of undo brings the drawing back. */
  eraseAll(store: CanvasStore) {
    if (!store.canvas.ink.length) return

    store.edit({ ...store.canvas, ink: [] })
  },

  /** Whole strokes gone, which is what the stroke eraser does: touch a line
   *  anywhere and the line goes. `run` names the drag it is part of, so the whole
   *  drag is one step to take back; see `edit` in store.svelte.ts. */
  rub(store: CanvasStore, ids: readonly string[], run?: string) {
    if (!ids.length) return

    const going = new Set(ids)
    store.edit({ ...store.canvas, ink: store.canvas.ink.filter((one) => !going.has(one.id)) }, run)
  },

  /** A hole rubbed through whatever is under the eraser, which may leave the two
   *  ends of a line behind. Every point of the drag is one of these, so the plane
   *  answers under the nib rather than when it is lifted, and all of them are one
   *  rub. */
  cut(store: CanvasStore, at: Point, reach: number, run?: string) {
    const next = cutInk(store.canvas, (stroke) =>
      nearStroke(stroke, at, reach) ? erased(stroke, at, reach) : [stroke],
    )

    store.edit(next, run)
  },

  /** What a loop or a box caught. Only strokes it went right round, so half a word
   *  is never dragged away from the other half, unless the lasso's own panel says
   *  a stroke it touched at all counts. */
  lasso(store: CanvasStore, points: readonly Point[], partly = false) {
    store.pickAll(strokesInLasso(store.canvas.ink, points, partly))
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
   *  so the surface knows whether to stop it going anywhere else.
   *
   *  Every one of them is in the shortcut registry, so a reader who rebound one
   *  has their own key here and can see the whole list in the settings. They are
   *  marked contextual there, which is what lets a plane hold a bare letter and
   *  the arrows without being a clash with anything the file list holds. */
  keys(store: CanvasStore, event: KeyboardEvent, view: KeyView): boolean {
    const tool = TOOL_KEYS.find(([id]) => shortcuts.pressed(id, event))
    if (tool) {
      tools.choose(tool[1])
      return true
    }

    // Shift makes a nudge a grid step, which is the pair every drawing program
    // has. The key itself is the registry's; the modifier is what it means.
    const step = event.shiftKey ? GRID : NUDGE
    const nudge = NUDGES.find(([id]) => shortcuts.pressed(id, event))
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

      act(store, view)
      return true
    }

    return false
  },
}

/** Which tool each key puts in your hand. */
const TOOL_KEYS: readonly (readonly [string, Tool])[] = [
  ['canvas.tool.select', 'select'],
  ['canvas.tool.hand', 'hand'],
  ['canvas.tool.draw', 'draw'],
  ['canvas.tool.erase', 'erase'],
  ['canvas.tool.lasso', 'lasso'],
  ['canvas.tool.text', 'text'],
  ['canvas.tool.file', 'file'],
  ['canvas.tool.link', 'link'],
  ['canvas.tool.group', 'group'],
  ['canvas.tool.rect', 'rect'],
  ['canvas.tool.ellipse', 'ellipse'],
  ['canvas.tool.line', 'line'],
  ['canvas.tool.arrow', 'arrow'],
]

/** Which way each nudge goes. */
const NUDGES: readonly (readonly [string, number, number])[] = [
  ['canvas.nudge.left', -1, 0],
  ['canvas.nudge.right', 1, 0],
  ['canvas.nudge.up', 0, -1],
  ['canvas.nudge.down', 0, 1],
]

/** Everything else a key does, by the id it is bound to. */
const ACTS: readonly (readonly [string, (store: CanvasStore, view: KeyView) => void])[] = [
  ['canvas.duplicate', (store) => run.duplicate(store)],
  ['canvas.fit', (store, view) => store.fit(view.width, view.height)],
  ['canvas.frame', (store, view) => store.frame(view.width, view.height)],
  ['canvas.find', (_store, view) => view.onfind()],
  ['canvas.front', (store) => run.order(store, 'front')],
  ['canvas.forward', (store) => run.order(store, 'forward')],
  ['canvas.back', (store) => run.order(store, 'back')],
  ['canvas.backward', (store) => run.order(store, 'backward')],
]

export interface KeyView {
  width: number
  height: number
  path: string | null
  name: string
  palette: Palette
  onfind: () => void
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
