<script lang="ts">
  import { keyElsewhere } from './layer-keys'
  import { untrack } from 'svelte'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasFind from './CanvasFind.svelte'
  import CanvasHands from './CanvasHands.svelte'
  import CanvasInk from './CanvasInk.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import CanvasPicked from './CanvasPicked.svelte'
  import PagesPage from './PagesPage.svelte'
  import PagesSlot from './PagesSlot.svelte'
  import PagesZoom from './PagesZoom.svelte'
  import {
    type Camera,
    ctrlWheelZoom,
    graphPoint,
    heldGestures,
    NOTCH,
    pinching,
    turnOf,
  } from './camera'
  import { putWords, toolPressed, wordsAt } from './canvas/actions'
  import {
    coloured,
    copied,
    movedBy,
    pickedBox,
    removed,
    rubbedOut,
    sized,
    withText,
  } from './canvas/edits'
  import { freshId, type InkPoint, type InkStroke } from './canvas/format'
  import { Contacts, hovering, penKind, Stylus } from './canvas/contacts'
  import { hand } from './canvas/hand.svelte'
  import {
    cardsInLasso,
    leadPoint,
    penFelt,
    rubbedBetween,
    strokesInLasso,
    tidied,
  } from './canvas/ink'
  import { DEFAULT_INK, readPalette } from './canvas/palette'
  import { pens } from './canvas/pens.svelte'
  import { FORGIVING, inks, type Tool } from './canvas/pointer'
  import { tick } from './canvas/tick'
  import { tools } from './canvas/tools.svelte'
  import { type Point } from './canvas/geometry'
  import { pageAt } from '@orden/markdown/pages'
  import { longPress } from './longpress'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { stillness } from './platform/src/api'
  import { type Found, matches } from './canvas/find'
  import {
    PapersHeld,
    outlineOf,
    paperAhead,
    paperEdition,
    paperPathOf,
    textsOf,
  } from './pages/paper'
  import { caretAt, type Chosen, chooseTo, chosenIn, wordAround } from './pages/choose'
  import { RightPan } from './canvas/right-pan'
  import { freeScroll, holdFreeScroll } from './canvas/free-scroll'
  import { copyText } from './ui-controls/src/api'
  import { placesOnPaper } from './pdf/find'
  import type { Highlight } from './pdf/highlights'
  import { marksFromOutside } from './pdf/sheets.svelte'
  import { loadHighlights } from './pdf/sidecar'
  import {
    began,
    dragged,
    lifted,
    noPull,
    type Pulling,
    reachFor,
    riseOf,
    startedNearEnd,
    wheeled,
  } from './pages/pull'
  import { inSight } from './pages/sight'
  import { PagesStore } from './pages/store.svelte'
  import { rooms } from './collab/src/api'
  import { said } from './said.svelte'
  import { canWriteIn, trustsHtmlIn } from './sharing/src/api'
  import { shortcuts } from './shortcuts.svelte'

  import { pages as pagesState } from './pages/showing.svelte'
  import { viewport } from './ui-kit/src/api'
  import { samePath } from './platform/src/api'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  const store = untrack(() => new PagesStore(tab))

  untrack(() => {
    const file = store.pages.find((one) => one.file)?.file
    const note = tab.note.path
    if (file) paperAhead({ file, note, root: workspace.rootHolding(note), shared: tab.note.shared })
  })

  const A_TWITCH = 6

  const A_PAUSE = 220

  const INKING: ReadonlySet<Tool> = new Set<Tool>(['draw', 'erase', 'lasso'])

  const PAPER_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
    'select',
    'hand',
    'draw',
    'erase',
    'lasso',
    'words',
  ])

  const TWO_FINGERS = 250

  const GRACE = 160

  const follows = (_value: unknown) => undefined

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let palette = $state<Record<string, string>>({})

  const pages = $derived(store.pages)
  const canvas = $derived(store.canvas)
  const camera = $derived(store.camera)
  const showing = $derived(store.showing)

  const unit = $derived(1 / camera.scale)

  const writable = $derived(!store.readOnly)
  const trusted = $derived(trustsHtmlIn(tab.note))

  const cards = $derived(canvas.nodes.filter((node) => node.type !== 'page'))

  let rise = $state(0)

  let pull = $state.raw<Pulling>(noPull())

  let falling = 0

  const slot = $derived(store.slot)

  const reach = $derived(reachFor((store.last?.height ?? 0) * camera.scale))

  const view = $derived<Camera>(rise ? { ...camera, y: camera.y + rise / camera.scale } : camera)

  const sight = $derived(inSight(pages, view, turnOf(view) ? Math.hypot(width, height) : height))

  const near = $derived(pages.slice(sight.from, sight.to))

  const STILL = 250

  let still = $state(true)

  $effect(() => {
    const at = view
    still = false
    const timer = setTimeout(() => {
      if (at === view) still = true
    }, STILL)
    return () => clearTimeout(timer)
  })

  const seen = $derived.by(() => {
    const turned = turnOf(view) ? Math.hypot(width, height) : 0
    const across = (turned || width) / view.scale / 2
    const down = (turned || height) / view.scale / 2
    return { x: view.x - across, y: view.y - down, width: across * 2, height: down * 2 }
  })

  $effect(() => {
    store.measured(width, height)
  })

  $effect(() => {
    const asked = workspace.gotoPage
    const first = tab.page
    if (!height || !pages.length || (first === undefined && !asked)) return

    untrack(() => {
      if (first !== undefined) {
        tab.page = undefined
        store.turnToPaper(first)
      }
      if (asked && tab.path && samePath(asked.path, tab.path)) {
        workspace.gotoPage = null
        store.turnToPaper(asked.page)
      }
    })
  })

  $effect(() => {
    const id = tab.id
    pagesState.arrived(id, store)
    return () => pagesState.gone(id, store)
  })

  $effect(() => {
    if (store.framed || !width || !height || !store.widest) return

    store.fitWidth(false)
  })

  $effect(() => {
    if (focused && !PAPER_TOOLS.has(tools.which)) tools.choose('select')
  })

  $effect(() => {
    follows(tab.note.revision)
    store.follow()
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => {
      width = element.clientWidth
      height = element.clientHeight
    })
    watcher.observe(element)
    width = element.clientWidth
    height = element.clientHeight
    palette = readPalette(element)

    return () => watcher.disconnect()
  })

  $effect(() => {
    const element = host
    if (!element || typeof MutationObserver === 'undefined') return

    const watcher = new MutationObserver(() => (palette = readPalette(element)))
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })

    return () => watcher.disconnect()
  })

  $effect(() => {
    store.readOnly = !canWriteIn(tab.note) || tab.kind === 'pdf'
  })

  $effect(() => {
    rooms.drawing(tab.note.key, store)
    return () => {
      store.gone()
      rooms.drawing(tab.note.key, null)
    }
  })

  $effect(() => {
    store.shared?.hand(pointing, live)
  })

  const backing = $derived(pages.find((one) => one.file)?.file ?? null)

  interface PaperHit {
    paper: number
    at: number
    length: number
  }

  const MOST_HITS = 500

  const AROUND = 24

  let finding = $state(false)
  let askedFind = $state(0)
  let term = $state('')
  let texts = $state.raw<readonly string[]>([])
  let looking = $state.raw<PaperHit | null>(null)
  let centring = false

  $effect(() => {
    const file = backing
    const note = tab.note.path
    if (!finding || !file) return

    const at = { file, note, root: workspace.rootHolding(note), shared: tab.note.shared }
    paperEdition(at)
    let mine = true
    void textsOf(at).then((read) => {
      if (mine) texts = read
    })
    return () => {
      mine = false
    }
  })

  const paperHits = $derived.by((): PaperHit[] => {
    const wanted = term.trim()
    if (!finding || !wanted) return []

    const out: PaperHit[] = []
    for (const page of pages) {
      if (page.file !== backing || !page.page) continue
      for (const { at, length } of placesOnPaper(texts[page.page - 1] ?? '', wanted)) {
        out.push({ paper: page.page, at, length })
        if (out.length >= MOST_HITS) return out
      }
    }
    return out
  })

  const soughtOn = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const on = new Map<number, PaperHit[]>()
    for (const hit of paperHits) {
      const held = on.get(hit.paper)
      if (held) held.push(hit)
      else on.set(hit.paper, [hit])
    }
    return on
  })

  const shownHit = $derived.by(() => {
    const was = looking
    if (!was) return null
    const kept = paperHits.some(
      (hit) => hit.paper === was.paper && hit.at === was.at && hit.length === was.length,
    )
    return kept ? was : null
  })

  function hitId(hit: PaperHit): string {
    return `paper:${hit.paper}:${hit.at}`
  }

  function around(hit: PaperHit): Found {
    const text = texts[hit.paper - 1] ?? ''
    const from = Math.max(0, hit.at - AROUND)
    const to = Math.min(text.length, hit.at + hit.length + AROUND)
    const said = text.slice(from, to).replace(/\s+/g, ' ').trim()
    return {
      id: hitId(hit),
      paper: hit.paper,
      says: `${from ? '…' : ''}${said}${to < text.length ? '…' : ''}`,
    }
  }

  const found = $derived<Found[]>(
    finding
      ? [
          ...paperHits.map(around),
          ...matches(canvas, term).filter((one) => cards.some((card) => card.id === one.id)),
        ]
      : [],
  )

  function pickFound(id: string) {
    const hit = paperHits.find((one) => hitId(one) === id)
    if (hit) {
      looking = hit
      centring = true
      store.turnToPaper(hit.paper)
      return
    }

    const node = canvas.nodes.find((one) => one.id === id)
    if (!node) return
    looking = null
    store.pick(id)
    store.camera = store.held({
      ...camera,
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    })
  }

  function foundAt(box: { x: number; y: number; width: number; height: number }) {
    if (!centring) return
    centring = false
    store.camera = store.held({
      ...camera,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    })
  }

  function seek(said: string) {
    if (said === term) return
    term = said
    looking = null
  }

  function stopFinding() {
    finding = false
    term = ''
    looking = null
    host?.focus({ preventScroll: true })
  }

  $effect(() => {
    const file = backing
    const note = tab.note.path
    const shared = tab.note.shared
    if (!file) return

    let mine = true
    const at = { file, note, root: workspace.rootHolding(note), shared }
    paperEdition(at)
    void outlineOf(at).then((rows) => {
      if (mine) store.outline = rows
    })
    void paperPathOf(at).then((path) => {
      if (mine) paperPath = path
    })

    return () => {
      mine = false
      store.outline = []
      paperPath = null
    }
  })

  let paperPath = $state<string | null>(null)

  $effect(() => {
    const path = paperPath
    if (!path) return
    follows(marksFromOutside(path))

    let mine = true
    void loadHighlights(path).then((sheet) => {
      if (mine) store.marks = sheet.highlights
    })

    return () => {
      mine = false
      if (paperPath !== path) store.marks = []
    }
  })

  const NO_MARKS: readonly Highlight[] = []

  const NO_HITS: readonly PaperHit[] = []

  const marksOn = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const out = new Map<number, Highlight[]>()
    for (const mark of store.marks) {
      const held = out.get(mark.page)
      if (held) held.push(mark)
      else out.set(mark.page, [mark])
    }
    return out
  })

  const papers = new PapersHeld()

  $effect(() => {
    const note = tab.note.path
    const root = workspace.rootHolding(note)
    const shared = tab.note.shared
    const files = new Set(pages.flatMap((page) => (page.file ? [page.file] : [])))
    papers.keep([...files].map((file) => ({ file, note, root, shared })))
  })

  $effect(() => () => papers.release())

  $effect(() => {
    if (focused && store.editing === null) host?.focus({ preventScroll: true })
  })

  $effect(() => () => {
    if (falling && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(falling)
    store.halt()
  })

  function screenAt(event: { clientX: number; clientY: number }): Point {
    const box = host?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  function planeAt(event: { clientX: number; clientY: number }): Point {
    const at = screenAt(event)
    return graphPoint(view, width, height, at.x, at.y)
  }

  const contacts = new Contacts()

  const right = new RightPan()

  $effect(() => holdFreeScroll())

  function kindOf(event: PointerEvent) {
    return penKind(event, { penSeen: hand.penSeen, touch: viewport.touch })
  }

  const stylus = new Stylus({
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    touch: viewport.touch,
    coalesced:
      typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype,
    predicted:
      typeof PointerEvent !== 'undefined' && 'getPredictedEvents' in PointerEvent.prototype,
  })

  type Gesture =
    | { kind: 'draw'; id: number; page: string; stroke: InkStroke; began: number; on: Camera }
    | {
        kind: 'erase'
        id: number
        run: string
        last: Point
        lastScreen: Point
        whole: boolean
        reach: number
      }
    | { kind: 'lasso'; id: number; points: Point[]; cards?: boolean }
    | { kind: 'armed'; id: number; at: Point; screen: Point }
    | {
        kind: 'pan'
        id: number
        screen: Point
        from: Camera
        moved: boolean
        onSlot: boolean
      }
    | { kind: 'drag'; id: number; from: Point; offset: Point; moved: boolean }
    | { kind: 'pinch'; ids: [number, number]; screens: [Point, Point]; apart: number }
    | { kind: 'choose'; id: number; held: Chosen }

  let gesture = $state.raw<Gesture | null>(null)
  let predicted = $state.raw<InkPoint[]>([])
  let pointing = $state.raw<Point | null>(null)

  let driver = $state.raw<{ id: number; touch: boolean; screen: Point; since: number } | null>(null)

  const live = $derived.by(() => {
    if (gesture?.kind !== 'draw') return null
    return { ...gesture.stroke, points: [...gesture.stroke.points, ...predicted] }
  })

  const dragging = $derived(gesture?.kind === 'drag' ? gesture.offset : { x: 0, y: 0 })

  const shownInk = $derived(
    dragging.x || dragging.y
      ? movedBy(canvas, store.picked, dragging.x, dragging.y).ink
      : canvas.ink,
  )

  const caught = $derived.by(() => {
    const wanted = new Set(store.picked)
    const strokes = canvas.ink.filter((one) => wanted.has(one.id)).map((one) => one.id)
    const box = pickedBox(canvas, strokes)
    if (!box) return null
    const slack = 12 * unit
    return {
      x: box.x - slack,
      y: box.y - slack,
      width: box.width + 2 * slack,
      height: box.height + 2 * slack,
    }
  })

  function sampleOf(event: PointerEvent, began: number): InkPoint {
    const point = planeAt(event)
    return {
      x: point.x,
      y: point.y,
      ...penFelt(event, stylus.traits),
      t: Math.max(0, Math.round(event.timeStamp - began)),
    }
  }

  function inside(
    point: Point,
    box: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    )
  }

  function takesOver(one: Gesture, since: number, now: number): boolean {
    if (one.kind === 'pinch') return false
    if (one.kind !== 'draw' && one.kind !== 'erase') return true

    return now - since <= TWO_FINGERS
  }

  let doubting: { id: number; timer: number; event: PointerEvent } | null = null

  function stopDoubting(id?: number) {
    if (!doubting || (id !== undefined && doubting.id !== id)) return
    window.clearTimeout(doubting.timer)
    doubting = null
  }

  function endDoubting() {
    const was = doubting
    if (!was) return
    stopDoubting()
    cancelled(was.event)
  }

  $effect(() => () => stopDoubting())

  function onpointerdown(event: PointerEvent) {
    if (contacts.echo(event)) return
    endDoubting()
    tools.used()

    const { kind, eraser } = kindOf(event)
    const pen = kind === 'pen'
    if (event.button === 2 && !pen) {
      if (right.down(event)) {
        try {
          host?.setPointerCapture(event.pointerId)
        } catch {
          // The events keep coming; they are only not promised to this element.
        }
      }
      return
    }

    contacts.came(event.pointerId, { pen, eraser })
    stylus.saw(event)
    if (pen) hand.sawPen()

    if (kind === 'touch' && contacts.penned) return
    if (pen && driver?.touch) dropTouch()

    const screen = screenAt(event)
    const one = gesture

    if (!one && kind === 'mouse' && onWords(event)) {
      contacts.went(event.pointerId)
      return
    }

    if (one && driver?.touch && kind === 'touch' && driver.id !== event.pointerId) {
      if (!takesOver(one, driver.since, event.timeStamp)) return

      store.halt()
      if (one.kind === 'erase') store.takeBack(one.run)
      predicted = []
      gesture = {
        kind: 'pinch',
        ids: [driver.id, event.pointerId],
        screens: [driver.screen, screen],
        apart: Math.hypot(screen.x - driver.screen.x, screen.y - driver.screen.y),
      }
      return
    }

    if (one) return

    try {
      host?.setPointerCapture(event.pointerId)
    } catch {
      // The events keep coming; they are only not promised to this element.
    }
    driver = { id: event.pointerId, touch: kind === 'touch', screen, since: event.timeStamp }
    store.halt()

    if (event.target instanceof Element && event.target.closest('.words.live')) {
      event.preventDefault()
    }
    if (kind === 'pen' && !eraser && onWords(event)) {
      if (choose(event.pointerId, event.clientX, event.clientY, false)) return
    }
    if (kind !== 'mouse' && chosenIn(host)) getSelection()?.removeAllRanges()

    const point = planeAt(event)
    const page = pageAt(pages, point)

    const drawing = inks(kind, { penSeen: hand.penSeen, fingerDraws: hand.fingerDraws })
    const asked = eraser ? 'erase' : tools.which
    const tool = drawing || !INKING.has(asked) ? asked : 'select'

    if (tool === 'hand' || !page) {
      gesture = {
        kind: 'pan',
        id: event.pointerId,
        screen,
        from: camera,
        moved: false,
        onSlot: !!slot && writable && inside(point, slot),
      }
      pull = began(pull, startedNearEnd(store.viewBottom, store.last), Date.now())
      return
    }

    if (!writable) return

    if (tool === 'words') {
      event.preventDefault()
      putWords(store, wordsAt(point))
      return
    }

    if (tool === 'draw') {
      const nib = tools.ink
      gesture = {
        kind: 'draw',
        id: event.pointerId,
        page: page.id,
        began: event.timeStamp,
        on: camera,
        stroke: {
          id: freshId(),
          tool: nib.tool,
          color: nib.color,
          size: nib.size,
          opacity: nib.opacity,
          points: [sampleOf(event, event.timeStamp)],
        },
      }
      return
    }

    if (tool === 'erase') {
      rubFrom(event, point, kind === 'touch')
      return
    }

    if ((tool === 'lasso' || tool === 'select') && caught && inside(point, caught)) {
      gesture = {
        kind: 'drag',
        id: event.pointerId,
        from: point,
        offset: { x: 0, y: 0 },
        moved: false,
      }
      return
    }

    if (tool === 'lasso') {
      gesture = { kind: 'lasso', id: event.pointerId, points: [point] }
      return
    }

    const hit = cards.find((node) => inside(point, node))

    if (!hit) {
      store.clearPicked()
      gesture = {
        kind: 'pan',
        id: event.pointerId,
        screen,
        from: camera,
        moved: false,
        onSlot: false,
      }
      pull = began(pull, startedNearEnd(store.viewBottom, store.last), Date.now())
      return
    }

    if (!store.isPicked(hit.id)) store.pick(hit.id, event.shiftKey || event.ctrlKey)
    gesture = {
      kind: 'drag',
      id: event.pointerId,
      from: point,
      offset: { x: 0, y: 0 },
      moved: false,
    }
  }

  const ROOM = 72

  const overPicked = $derived.by(() => {
    const box = caught
    if (!box || gesture || store.editing !== null) return null

    const left = width / 2 + (box.x + box.width / 2 - view.x) * view.scale
    const above = height / 2 + (box.y - view.y) * view.scale
    const under = height / 2 + (box.y + box.height - view.y) * view.scale
    const below = above < ROOM

    return { at: { x: left, y: below ? under : above }, below }
  })

  const pickedColour = $derived.by(() => {
    const first = canvas.ink.find((one) => store.isPicked(one.id))
    return !first || first.color === DEFAULT_INK ? null : first.color
  })

  function colourPicked(colour: string | null) {
    store.edit(coloured(canvas, store.picked, colour ?? DEFAULT_INK))
  }

  function inkPicked(): boolean {
    return writable && canvas.ink.some((one) => store.pickedSet.has(one.id))
  }

  function duplicatePicked() {
    if (!writable || !store.picked.length) return
    const made = copied(canvas, store.picked)
    store.edit(made.canvas)
    store.pickAll(made.ids)
  }

  function deletePicked() {
    if (!writable) return
    const paged = new Set(pages.map((page) => page.id))
    const going = store.picked.filter((id) => !paged.has(id))
    if (!going.length) return
    store.edit(removed(canvas, going))
    store.clearPicked()
  }

  function command(id: string, label: string): MenuEntry {
    return {
      label,
      run: () =>
        void import('./commands').then(({ appCommands, exportCommands }) => {
          const row = [...exportCommands(), ...appCommands()].find((one) => one.id === id)
          if (row && !row.disabled) row.run()
        }),
    }
  }

  function pagesMenu(point: Point): MenuEntry[] {
    const page = pageAt(pages, point)
    const ink = inkPicked()
    const chosen = chosenIn(host)
    const groups: MenuEntry[][] = [
      chosen
        ? [
            {
              label: 'Copy',
              hint: shortcuts.hint('fixed.copy'),
              run: () => void copyText(chosen),
            },
          ]
        : [],
      ink
        ? [
            {
              label: 'Duplicate',
              hint: shortcuts.hint('canvas.duplicate'),
              run: duplicatePicked,
            },
            { label: 'Delete', danger: true, run: deletePicked },
          ]
        : [],
      page && writable
        ? [
            {
              label: 'Add a page after this',
              run: () => {
                const at = store.addPage(page.id)
                if (at) store.glideTo(at)
              },
            },
          ]
        : [],
      [
        { label: 'Fit width', run: () => store.fitAgain() },
        { label: 'Fit page', run: () => store.fitPage() },
        { label: '100%', run: () => store.zoomTo(1) },
      ],
      [command('export-pdf', 'Export as PDF'), command('print', 'Print')],
    ]
    return groups
      .filter((one) => one.length)
      .flatMap((one, index) => (index ? [DIVIDER, ...one] : one))
  }

  function showMenu(event: MouseEvent) {
    menu.show(event, pagesMenu(planeAt(event)), {
      title: 'Pages',
      near: viewport.touch,
    })
  }

  function oncontextmenu(event: MouseEvent) {
    event.preventDefault()
    if (right.ownsMenu(event.timeStamp)) return
    const kind = (event as PointerEvent).pointerType
    if (kind === 'touch' || kind === 'pen') return
    showMenu(event)
  }

  function choose(id: number, x: number, y: number, word: boolean): boolean {
    const at = caretAt(document, x, y)
    const selection = getSelection()
    if (!at || !selection) return false

    const held = word ? wordAround(at) : { from: at, to: at }
    chooseTo(selection, held, at)
    gesture = { kind: 'choose', id, held }
    return true
  }

  function held(event: MouseEvent) {
    const busy = gesture?.kind
    if (busy === 'draw' || busy === 'erase' || busy === 'lasso' || busy === 'choose') return
    const one = gesture
    if (
      one?.kind === 'pan' &&
      !one.moved &&
      driver?.touch &&
      tools.which === 'select' &&
      document.elementFromPoint(event.clientX, event.clientY)?.closest('.words.live') &&
      choose(one.id, event.clientX, event.clientY, true)
    ) {
      endPull()
      return
    }
    const at = planeAt(event)
    gesture =
      one?.kind === 'pan' && !one.moved && driver?.touch && writable && pageAt(pages, at)
        ? { kind: 'armed', id: one.id, at, screen: { x: event.clientX, y: event.clientY } }
        : null
    showMenu(event)
  }

  function rubFrom(event: PointerEvent, point: Point, touch: boolean) {
    const whole = pens.whole || event.shiftKey
    const wide = whole ? pens.strokeRub + (touch ? FORGIVING : 0) : pens.rub
    const erasing = {
      kind: 'erase' as const,
      id: event.pointerId,
      run: freshId(),
      last: point,
      lastScreen: screenAt(event),
      whole,
      reach: wide * unit,
    }
    gesture = erasing
    rub([point], erasing)
  }

  function onpointermove(event: PointerEvent) {
    stopDoubting(event.pointerId)
    pointing = planeAt(event)

    if (hovering(event) && host?.hasPointerCapture(event.pointerId)) {
      host.releasePointerCapture(event.pointerId)
    }

    if (right.holds(event)) {
      const by = right.move(event)
      if (by) {
        store.camera = store.held({
          ...camera,
          x: camera.x - by.dx / camera.scale,
          y: camera.y - by.dy / camera.scale,
        })
      }
      return
    }

    const one = gesture
    if (!one) return

    if (one.kind === 'choose') {
      const at = one.id === event.pointerId ? caretAt(document, event.clientX, event.clientY) : null
      const selection = getSelection()
      if (at && selection) chooseTo(selection, one.held, at)
      return
    }

    const screen = screenAt(event)

    if (one.kind === 'pinch') {
      const which = one.ids.indexOf(event.pointerId)
      if (which < 0) return

      const screens: [Point, Point] =
        which === 0 ? [screen, one.screens[1]] : [one.screens[0], screen]
      const apart = Math.hypot(screens[1].x - screens[0].x, screens[1].y - screens[0].y)
      const middle = { x: (screens[0].x + screens[1].x) / 2, y: (screens[0].y + screens[1].y) / 2 }
      const was = {
        x: (one.screens[0].x + one.screens[1].x) / 2,
        y: (one.screens[0].y + one.screens[1].y) / 2,
      }

      const room = Math.max(0, store.bottom - camera.y) * camera.scale

      store.camera = store.held({
        ...camera,
        x: camera.x - (middle.x - was.x) / camera.scale,
        y: camera.y - (middle.y - was.y) / camera.scale,
      })
      if (one.apart > 0 && Math.abs(apart - one.apart) > 0.5) {
        store.zoomAt(middle, apart / one.apart)
      }

      const answer = dragged(pull, {
        raw: pull.raw + Math.max(0, was.y - middle.y - room),
        reach,
        now: Date.now(),
        still: stillness(),
      })
      pull = answer.pull
      rise = riseOf(pull, reach, Date.now(), stillness())
      if (answer.makes) madePage()

      gesture = { ...one, screens, apart }
      return
    }

    if (one.id !== event.pointerId) return
    if (driver?.id === event.pointerId) driver = { ...driver, screen }

    if (hovering(event) || !contacts.has(event.pointerId)) {
      contacts.went(event.pointerId)
      finish()
      return
    }

    const point = planeAt(event)

    if (one.kind === 'draw' && writable) {
      const now = kindOf(event)
      const turned = contacts.turned(event.pointerId, {
        pen: now.kind === 'pen',
        eraser: now.eraser,
      })
      if (turned?.eraser) {
        predicted = []
        rubFrom(event, point, false)
        return
      }
    }

    if (one.kind === 'pan') {
      const wanted = {
        x: one.from.x - (screen.x - one.screen.x) / camera.scale,
        y: one.from.y - (screen.y - one.screen.y) / camera.scale,
      }
      const bottom = store.bottom
      store.camera = store.held({ ...camera, ...wanted })

      const over = Math.max(0, wanted.y - bottom) * camera.scale
      const answer = dragged(pull, { raw: over, reach, now: Date.now(), still: stillness() })
      pull = answer.pull
      rise = riseOf(pull, reach, Date.now(), stillness())
      if (answer.makes) madePage()

      const moved =
        one.moved || Math.hypot(screen.x - one.screen.x, screen.y - one.screen.y) > A_TWITCH
      if (moved !== one.moved) gesture = { ...one, moved }
      return
    }

    if (one.kind === 'draw' && !sameView(one.on, camera)) {
      finish()
      return
    }

    if (one.kind === 'draw') {
      const events = 'getCoalescedEvents' in event ? event.getCoalescedEvents() : []
      const samples = (events.length ? events : [event]).map((one) =>
        sampleOf(one, gesture?.kind === 'draw' ? gesture.began : event.timeStamp),
      )
      const points = [...one.stroke.points, ...samples]
      gesture = { ...one, stroke: { ...one.stroke, points } }

      const guessed =
        'getPredictedEvents' in event
          ? event
              .getPredictedEvents()
              .map((one) =>
                sampleOf(one, gesture?.kind === 'draw' ? gesture.began : event.timeStamp),
              )
          : []
      predicted = leadPoint(points[points.length - 2], points[points.length - 1], guessed)
      return
    }

    if (one.kind === 'erase') {
      const now = { at: point, screen: screenAt(event) }
      const before = { at: one.last, screen: one.lastScreen }
      rub(rubbedBetween(before, now, camera.scale, one.reach), one)
      gesture = { ...one, last: now.at, lastScreen: now.screen }
      return
    }

    if (one.kind === 'lasso') {
      gesture = { ...one, points: [...one.points, point] }
      return
    }

    if (one.kind === 'armed') {
      if (event.pointerId !== one.id) return
      if (Math.hypot(event.clientX - one.screen.x, event.clientY - one.screen.y) <= A_TWITCH) return
      menu.hide()
      gesture = { kind: 'lasso', id: one.id, points: [one.at, point], cards: true }
      return
    }

    const offset = { x: point.x - one.from.x, y: point.y - one.from.y }
    const moved = one.moved || Math.hypot(offset.x, offset.y) * camera.scale > A_TWITCH
    gesture = { ...one, offset, moved }
  }

  function onpointerup(event: PointerEvent) {
    stopDoubting(event.pointerId)
    contacts.went(event.pointerId)

    const lifted = right.up(event)
    if (lifted) {
      if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
      if (lifted === 'menu') showMenu(event)
      return
    }

    const one = gesture
    if (one?.kind === 'pinch') {
      const which = one.ids.indexOf(event.pointerId)
      if (which < 0) return

      const left = which === 0 ? 1 : 0
      const id = one.ids[left]
      const screen = one.screens[left]
      if (!contacts.has(id)) {
        finish()
        return
      }

      gesture = { kind: 'pan', id, screen, from: camera, moved: true, onSlot: false }
      driver = { id, touch: true, screen, since: event.timeStamp }
      return
    }

    if (one?.kind === 'choose' && one.id === event.pointerId) {
      finish()
      if (chosenIn(host)) showMenu(event)
      return
    }

    if (one?.id === event.pointerId) finish()
  }

  function onpointercancel(event: PointerEvent) {
    const one = gesture
    if (one && one.kind !== 'pinch' && one.id === event.pointerId && kindOf(event).kind === 'pen') {
      endDoubting()
      doubting = { id: event.pointerId, timer: window.setTimeout(endDoubting, GRACE), event }
      return
    }
    cancelled(event)
  }

  function cancelled(event: PointerEvent) {
    contacts.went(event.pointerId)
    right.cancel(event.pointerId)

    const one = gesture
    const mine =
      one?.kind === 'pinch' ? one.ids.includes(event.pointerId) : one?.id === event.pointerId
    if (!mine) return

    const by = driver
    if (one?.kind === 'erase' && by?.touch) store.takeBack(one.run)
    gesture = null
    driver = null
    predicted = []
    endPull()
    if ((one?.kind === 'choose' || by?.touch) && chosenIn(host)) showMenu(placed(event))
  }

  function placed(event: PointerEvent): MouseEvent {
    if (event.clientX || event.clientY) return event
    const box = getSelection()?.getRangeAt(0).getBoundingClientRect()
    return new MouseEvent('contextmenu', { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 })
  }

  function sameView(one: Camera, other: Camera): boolean {
    return one.x === other.x && one.y === other.y && one.scale === other.scale
  }

  function dropTouch() {
    const one = gesture
    if (one?.kind === 'erase') store.takeBack(one.run)
    gesture = null
    driver = null
    predicted = []
    endPull()
  }

  function finish() {
    const one = gesture
    gesture = null
    driver = null
    predicted = []
    if (!one) return

    if (one.kind === 'pan' || one.kind === 'pinch') {
      const answer = lifted(pull, { reach, now: Date.now(), still: stillness() })
      pull = answer.pull
      if (answer.makes) madePage()
      else fall()

      if (one.kind === 'pan' && one.onSlot && !one.moved) madePage()
      return
    }

    if (one.kind === 'draw') {
      const stroke = tidied(one.stroke)
      if (stroke.points.length) store.edit({ ...canvas, ink: [...canvas.ink, stroke] })
      tools.done()
      return
    }

    if (one.kind === 'lasso') {
      const ink = strokesInLasso(canvas.ink, one.points)
      store.pickAll(one.cards ? [...cardsInLasso(cards, one.points), ...ink] : ink)
      return
    }

    if (one.kind === 'drag' && one.moved) {
      store.edit(movedBy(canvas, store.picked, one.offset.x, one.offset.y))
    }
  }

  function rub(ats: readonly Point[], by: { run: string; reach: number; whole: boolean }) {
    store.edit(rubbedOut(canvas, ats, by.reach, by.whole), by.run)
  }

  function madePage() {
    const over = rise
    const number = store.addPage()
    rise = 0
    if (!number) return

    if (over) store.camera = store.held({ ...camera, y: camera.y + over / camera.scale })
    store.glideTo(number)
    tick()
    said.say(`Page ${number}`)
  }

  function fall() {
    rise = riseOf(pull, reach, Date.now(), stillness())
    if (falling || pull.holding || typeof requestAnimationFrame !== 'function') return
    if (rise <= 0) return

    const step = () => {
      falling = 0
      if (pull.holding) return

      rise = riseOf(pull, reach, Date.now(), stillness())
      if (rise > 0) falling = requestAnimationFrame(step)
      else pull = { ...pull, raw: 0 }
    }
    falling = requestAnimationFrame(step)
  }

  function endPull() {
    rise = 0
    pull = { ...pull, raw: 0, holding: false }
  }

  $effect(() => {
    const element = host
    if (!element) return
    return heldGestures(element, (at, by) => {
      store.halt()
      store.zoomAt(screenAt(at), by)
    })
  })

  function onwheel(event: WheelEvent) {
    event.preventDefault()
    store.halt()

    if (event.ctrlKey || event.metaKey) {
      if (!pinching()) store.zoomAt(screenAt(event), ctrlWheelZoom(event))
      return
    }

    const by = freeScroll.wheel(event)

    const now = Date.now()
    if (!pull.holding && now - pull.at > A_PAUSE) {
      pull = began(pull, startedNearEnd(store.viewBottom, store.last), now)
    }

    const wanted = camera.y + by.y / camera.scale
    const bottom = store.bottom
    store.camera = store.held({
      ...camera,
      x: camera.x + by.x / camera.scale,
      y: wanted,
    })

    const answer = wheeled(pull, {
      delta: Math.max(0, wanted - bottom) * camera.scale,
      reach,
      now,
      still: stillness(),
    })
    pull = answer.pull
    if (answer.makes) madePage()
    else fall()
  }

  function typing(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement)
    )
  }

  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (store.editing !== null || typing(event.target)) return
    if (keyElsewhere(event, event.currentTarget)) return

    if (shortcuts.pressed('canvas.find', event)) {
      event.preventDefault()
      finding = true
      askedFind++
      return
    }

    const wanted = toolPressed(event)
    if (wanted && PAPER_TOOLS.has(wanted)) {
      event.preventDefault()
      tools.pressed(wanted, event)
      return
    }

    for (const [id, run] of [
      ['pages.zoom.in', () => store.zoomBy(NOTCH)],
      ['pages.zoom.out', () => store.zoomBy(1 / NOTCH)],
      ['pages.fit', () => store.fitAgain()],
      ['pages.fit.page', () => store.fitPage()],
      ['pages.add', () => madePage()],
    ] as const) {
      if (!shortcuts.pressed(id, event)) continue

      event.preventDefault()
      store.halt()
      run()
      return
    }

    if (shortcuts.pressed('edit.select-all', event)) {
      event.preventDefault()
      chooseAllWords()
      return
    }

    if (shortcuts.pressed('edit.undo', event)) {
      event.preventDefault()
      store.undo()
      return
    }

    if (shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)) {
      event.preventDefault()
      store.redo()
      return
    }

    if (shortcuts.pressed('canvas.duplicate', event) && inkPicked()) {
      event.preventDefault()
      duplicatePicked()
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!store.picked.length || !writable) return

      event.preventDefault()
      deletePicked()
      return
    }

    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      store.halt()
      store.turnTo(showing + (event.key === 'PageDown' ? 1 : -1))
      return
    }

    if (event.key === 'Escape') {
      store.clearPicked()
      if (chosenIn(host)) getSelection()?.removeAllRanges()
    }
  }

  function chooseAllWords() {
    const page = pages[showing - 1]
    const sheet = page ? host?.querySelector(`.sheet[data-page="${CSS.escape(page.id)}"]`) : null
    const layer = sheet?.querySelector('.words')
    const selection = getSelection()
    selection?.removeAllRanges()
    if (layer?.textContent.trim()) selection?.selectAllChildren(layer)
  }

  function onWords(event: MouseEvent): boolean {
    return (
      tools.which === 'select' &&
      event.target instanceof Element &&
      event.target.closest('.words') !== null &&
      !(caught && inside(planeAt(event), caught))
    )
  }

  function ondblclick(event: MouseEvent) {
    if (onWords(event)) return
    if (tools.which !== 'select' && tools.which !== 'hand') return

    store.halt()
    const fitted = store.fitted
    if (fitted && Math.abs(camera.scale - fitted) < fitted * 0.005) store.fitPage()
    else store.fitAgain()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="pages"
  bind:this={host}
  tabindex="0"
  role="application"
  aria-roledescription="Pages"
  aria-label="{pages.length} pages"
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  {onwheel}
  {onkeydown}
  onkeyup={(event) => tools.released(event)}
  {ondblclick}
  {oncontextmenu}
  use:longPress={held}
  style:cursor={!viewport.touch && tools.which === 'lasso' ? 'crosshair' : undefined}
>
  <div
    class="column"
    style:transform="translate({width / 2 - view.x * view.scale}px, {height / 2 -
      view.y * view.scale}px) scale({view.scale})"
  >
    {#each near as page, at (page.id)}
      <PagesPage
        {page}
        number={sight.from + at + 1}
        {unit}
        notePath={tab.note.path}
        root={workspace.rootHolding(tab.note.path)}
        shared={tab.note.shared}
        {seen}
        {still}
        selectable={tools.which === 'select'}
        sought={page.file === backing && page.page ? (soughtOn.get(page.page) ?? NO_HITS) : NO_HITS}
        current={shownHit && shownHit.paper === page.page && page.file === backing
          ? shownHit.at
          : null}
        onfound={foundAt}
        marks={page.file === backing && page.page ? (marksOn.get(page.page) ?? NO_MARKS) : NO_MARKS}
      />
    {/each}

    {#if slot}
      <PagesSlot box={slot} {unit} {rise} {reach} pulling={rise > 0} />
    {/if}

    {#each cards as node (node.id)}
      <CanvasNode
        {node}
        canvasPath={tab.note.path}
        {trusted}
        root={workspace.rootHolding(tab.note.path)}
        picked={store.isPicked(node.id)}
        editing={store.editing === node.id}
        readOnly={store.readOnly}
        offset={store.isPicked(node.id) ? dragging : { x: 0, y: 0 }}
        scale={camera.scale}
        {seen}
        ontext={(text: string) => store.edit(withText(canvas, node.id, text))}
        onleave={() => (store.editing = null)}
      />
    {/each}

    {#if store.hands.length}
      <CanvasHands
        hands={store.hands}
        {unit}
        {palette}
        camera={view}
        {width}
        {height}
        ongo={(at: { x: number; y: number }) => (store.camera = { ...camera, x: at.x, y: at.y })}
      />
    {/if}
  </div>

  <CanvasInk
    ink={shownInk}
    {live}
    camera={view}
    {width}
    {height}
    picked={new Set(store.picked)}
    {palette}
  />

  <PagesZoom zoom={camera.scale} />

  {#if overPicked}
    <CanvasPicked
      at={overPicked.at}
      below={overPicked.below}
      colour={pickedColour}
      size={canvas.ink.find((one) => store.isPicked(one.id))?.size}
      recent={pens.recent}
      grouping={null}
      oncolour={colourPicked}
      onsize={(size: number, drag: string) => store.edit(sized(canvas, store.picked, size), drag)}
      onduplicate={duplicatePicked}
      ondelete={deletePicked}
      ongroup={() => undefined}
      onmore={(event: MouseEvent) => showMenu(event)}
    />
  {/if}

  {#if finding}
    <CanvasFind
      {canvas}
      hits={found}
      asked={askedFind}
      label="Find"
      onterm={seek}
      onpick={pickFound}
      onclose={stopFinding}
    />
  {/if}

  <CanvasBar
    canundo={store.canUndo}
    canredo={store.canRedo}
    places={false}
    onundo={() => store.undo()}
    onredo={() => store.redo()}
    onerase={() => store.edit({ ...canvas, ink: [] })}
  />
</div>

<style>
  .pages {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--content-inner, var(--surface-2));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    outline: none;
  }

  .column {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }
</style>
