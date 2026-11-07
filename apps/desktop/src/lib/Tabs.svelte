<script lang="ts">
  import { dropOver } from './drag-paths'
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { whileHere } from './while-here'
  import { staysOn } from './caret'
  import Door from './Door.svelte'
  import { views } from './views.svelte'
  import { fade } from 'svelte/transition'
  import { quintOut } from 'svelte/easing'
  import { agentMarks } from './agent-marks.svelte'
  import {
    carried,
    carriedMark,
    dragged,
    draggedBookmark,
    isBookmarkDrag,
    isTreeDrag,
    mayCarryAddress,
  } from './drag-paths'
  import { chrome } from './glass/chrome.svelte'
  import { i18n, t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { menu } from './menu.svelte'
  import { middleOpens, tabAsk } from './new-tab'
  import { rooms } from './rooms.svelte'
  import { roving } from './roving'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import SharedMark from './SharedMark.svelte'
  import { privateMark, syncMark, soundMark, tabNameField, tabOverview } from './surfaces.svelte'
  import TabMark from './TabMark.svelte'
  import UnsavedDot from './UnsavedDot.svelte'
  import { askPlace } from './save-place/door'
  import type { ClosingWidths } from './tab-strip/closing.svelte'
  import { flushStart } from './tab-strip/flush'
  import { revealed } from './tab-strip/scroll'
  import { wheelAlong } from './tab-strip/wheel'
  import {
    arrival,
    handOver,
    keyOf,
    picks,
    register,
    stripOf,
    TabDrag,
  } from './tab-strip/drag.svelte'
  import type { Block } from './tab-strip/picking.svelte'
  import {
    type Bounds,
    crossTakes,
    endOf,
    fitted,
    holds,
    keptWidths,
    MAGNETISM,
    moved,
    OPENING,
    partsFor,
    placed,
    separated,
    slotAt,
    trailing,
    widened,
    widthsFor,
    worthKeeping,
  } from './tab-strip/layout'
  import { initialOf, siteLook, twins } from './tab-strip/twins'
  import { insideSpace, nameOf } from './space-paths'
  import { shownName } from './note-name'
  import { chosenIcon } from './chosen-icon'
  import { pages } from './web-tab/pages.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import type { Landing } from './workspace/panes.svelte'
  import { fitTabs, iconTabs } from './tab-strip/icon-tabs.svelte'
  import { isDraft } from './workspace/drafts'
  import { inside } from './workspace/zones'
  import { initial } from './icons'
  import { dur, stillness } from './motion'
  import Cross from './Cross.svelte'

  const { paneId, caption = false }: { paneId: string; caption?: boolean } = $props()

  const pane = $derived(workspace.panes.at(paneId))
  const tabs = $derived(workspace.tabsIn(paneId))
  const focused = $derived(workspace.panes.focusedId === paneId)
  const alone = $derived(workspace.panes.count < 2)
  const twinned = $derived(workspace.twins(paneId).length > 0)

  const walking = $derived(workspace.showing(paneId))
  const walked = $derived(tabs.some((one) => one.trail.length > 1))

  function showTrail(event: MouseEvent, tab: Tab) {
    if (!tab.canGoBack) return
    event.preventDefault()
    void here(import('./tab-strip/menu')).then(({ trailMenu }) =>
      menu.show(event, trailMenu(tab), { title: t('Back') }),
    )
  }

  function showMenu(event: MouseEvent, tab: Tab) {
    event.preventDefault()
    event.stopPropagation()
    void here(import('./tab-strip/menu')).then(({ tabMenu, tabMenuTitle }) =>
      menu.show(event, tabMenu(tab, paneId), { title: tabMenuTitle(tab, paneId) }),
    )
  }

  function showNoteMenu(event: MouseEvent) {
    void here(import('./note-menu')).then(({ noteMenu }) =>
      menu.show(event, noteMenu(event, paneId)),
    )
  }

  let onMark = false
  function resumes(id: string) {
    if (onMark && agentMarks.on[id]?.stopped) agentMarks.act?.(id, 'resume')
    onMark = false
  }

  function showStripMenu(event: MouseEvent) {
    if (document.elementFromPoint(event.clientX, event.clientY) !== strip) return
    void here(import('./tab-strip/strip-menu')).then(({ stripMenu }) =>
      menu.show(event, stripMenu(paneId)),
    )
  }

  const LEAD = 8
  const PLUS_GAP = 4
  const PLUS = 28 + 2 * PLUS_GAP
  const TOP = 5

  let strip = $state<HTMLElement>()
  let stripWidth = $state(0)
  let live = $state(false)
  let resizing = $state(false)

  const flush = $derived(flushStart(paneId))
  const lead = $derived(flush ? 0 : LEAD)

  const room = $derived(
    stripWidth > 0 ? Math.max(0, stripWidth - lead - (viewport.touch ? 0 : PLUS)) : null,
  )

  const here = whileHere()

  const drag = new TabDrag()
  let closing = $state<ClosingWidths | null>(null)
  onMount(() => {
    void here(import('./tab-strip/closing.svelte')).then(
      (one) => (closing = new one.ClosingWidths()),
    )
  })
  let hovered = $state<string | null>(null)
  let settling = $state<string | null>(null)
  let grabY = 0

  const activeId = $derived(pane?.activeTabId ?? null)
  const icons = $derived(iconTabs.on && !viewport.touch)
  let measurer = $state<HTMLSpanElement | undefined>()
  let fits = $state<Record<string, number>>({})
  let names: Record<string, number> = {}
  let namesFont = ''
  let pen: CanvasRenderingContext2D | null | undefined

  function measured(name: string): number {
    if (!measurer) return 0
    const type = getComputedStyle(measurer)
    const font = `${type.fontStyle} ${type.fontWeight} ${type.fontSize} ${type.fontFamily}`
    if (font !== namesFont) {
      names = {}
      namesFont = font
    }
    let width = names[name]
    if (width === undefined) {
      pen ??= document.createElement('canvas').getContext('2d')
      if (!pen) return 0
      pen.font = font
      width = pen.measureText(name).width
      names[name] = width
    }
    return width
  }

  $effect(() => {
    const next: Record<string, number> = {}
    if (fitTabs.on && measurer) {
      for (const tab of tabs) {
        const name = measured(tab.shown)
        if (name <= 0) continue
        const seen = rooms.seen[tab.note.key]
        next[tab.id] = fitted(
          name,
          trailing({
            reading: tab.reading,
            sound: tab.kind === 'web' && pages.of(tab.id).playing,
            shared: !!tab.note.shared,
            draft: isDraft(tab.note),
            faces: Math.min(seen?.people.length ?? 0, 3),
            dots: Math.min(seen?.mine ?? rooms.present[tab.note.key] ?? 0, 3),
          }),
        )
      }
    }
    const now = untrack(() => fits)
    const keys = Object.keys(next)
    if (keys.length !== Object.keys(now).length || keys.some((id) => now[id] !== next[id]))
      fits = next
  })

  const sized = $derived(
    tabs.map((tab) => ({
      id: tab.id,
      icon: icons && tab.id !== activeId,
      active: tab.id === activeId,
      fit: fits[tab.id],
    })),
  )

  const opened = $derived(
    icons && !drag.on && hovered !== null && hovered !== activeId ? hovered : null,
  )

  let settledOpen = $state<string | null>(null)
  $effect(() => {
    const now = opened
    if (now === null) {
      settledOpen = null
      return
    }
    const timer = setTimeout(() => (settledOpen = now), dur(OPENING))
    return () => clearTimeout(timer)
  })

  const lettered = $derived.by(() => {
    if (!icons) return new Set<string>()
    const looks = tabs.map((tab) => {
      const own =
        tab.kind === 'terminal' ||
        tab.kind === 'graph' ||
        (tab.path !== null && chosenIcon(tab.path) !== null)
      const look = own
        ? null
        : tab.kind === 'web'
          ? siteLook(tab.address ?? pages.addressOf(tab.id))
          : tab.kind
      return { id: tab.id, look }
    })
    return twins(looks)
  })

  const widths = $derived.by(() => {
    const shared =
      (closing?.widths ? keptWidths(sized, closing.widths) : null) ?? widthsFor(sized, room)
    const at = opened === null ? -1 : sized.findIndex((one) => one.id === opened)
    return at < 0 ? shared : widened(shared, at, room, sized[at]?.fit)
  })
  const base = $derived(placed(widths))

  const picking = $derived(picks.loaded)
  const picked = $derived(new Set(picking?.chosen.of(paneId).map((one) => one.id)))
  let plainOnPick = false
  let block = $state<Block | null>(null)
  const lifted = $derived(drag.tabId === null ? [] : (block?.ids ?? [drag.tabId]))

  const landing = $derived(workspace.panes.landing)
  const incoming = $derived(
    landing?.kind === 'strip' && landing.paneId === paneId && !drag.on ? landing.at : null,
  )

  const behind = (one: (typeof sized)[number]) => ({ ...one, active: false, icon: icons })

  const arriving = $derived.by(() => {
    if (incoming === null || !fitTabs.on) return undefined
    const carriedTab = workspace.panes.dragging?.tabId
    const tab = carriedTab ? workspace.tabs.find((one) => one.id === carriedTab) : undefined
    if (tab) return fits[tab.id]
    const mark = carriedMark()
    const path =
      mark === null
        ? carried()[0]
        : (() => {
            const kept = workspace.bookmarks.list[mark]
            const root = workspace.activeSpace?.root
            return kept?.kind === 'note' && root ? insideSpace(root, kept.path) : undefined
          })()
    if (path === undefined) return undefined
    const name = workspace.opened.at(path)?.shown ?? shownName(nameOf(path))
    const width = measured(name)
    return width > 0 ? fitted(width) : undefined
  })

  const layout = $derived.by(() => {
    const boxes: Record<string, Bounds> = {}
    const carried = drag.tabId

    if (carried) {
      if (block) return block.layout(room, drag)
      const from = drag.from
      const own = { x: drag.x, width: widths[from] ?? 0 }

      if (drag.out) {
        const rest = sized.filter((_, at) => at !== from)
        const bounds = placed(widthsFor(rest, room))
        for (const [at, one] of rest.entries()) boxes[one.id] = bounds[at] ?? own
        boxes[carried] = own
        return { boxes, end: endOf(bounds) }
      }

      const order = moved(sized, from, drag.slot)
      const bounds = placed(moved(widths, from, drag.slot))
      for (const [at, one] of order.entries()) {
        boxes[one.id] = one.id === carried ? own : (bounds[at] ?? own)
      }
      return { boxes, end: endOf(bounds) }
    }

    if (incoming !== null) {
      const withGap = [
        ...sized.slice(0, incoming).map(behind),
        { id: '', icon: false, active: true, fit: arriving },
        ...sized.slice(incoming).map(behind),
      ]
      const bounds = placed(widthsFor(withGap, room))
      for (const [at, one] of withGap.entries()) {
        if (one.id) boxes[one.id] = bounds[at] ?? { x: 0, width: 0 }
      }
      return { boxes, end: endOf(bounds) }
    }

    for (const [at, one] of sized.entries()) boxes[one.id] = base[at] ?? { x: 0, width: 0 }
    return { boxes, end: endOf(base) }
  })

  const span = $derived(lead + layout.end + (viewport.touch ? 0 : PLUS))
  let shrinking = $state(false)
  let spanWas = 0
  $effect.pre(() => {
    shrinking = span < spanWas
    spanWas = span
  })

  const lines = $derived.by(() => {
    const ids =
      drag.on && !drag.out
        ? (block?.order(drag) ?? moved(sized, drag.from, drag.slot).map((one) => one.id))
        : sized.filter((one) => !(drag.out && lifted.includes(one.id))).map((one) => one.id)
    if (incoming !== null) ids.splice(incoming, 0, '')
    const filled = new Set([...lifted, ...picked, '', activeId ?? '', hovered ?? ''])

    return separated(ids, filled)
  })

  const quiet = $derived(!focused && !alone)
  const bare = $derived(!sized.some((one) => one.active && !(drag.out && lifted.includes(one.id))))

  function alongOf(clientX: number): number {
    if (!strip) return 0

    const box = strip.getBoundingClientRect()
    return i18n.factor > 0
      ? clientX - box.left - lead + strip.scrollLeft
      : box.right - lead - clientX - strip.scrollLeft
  }

  $effect(() =>
    register(paneId, {
      slotAt: (clientX) => slotAt(base, alongOf(clientX)),
      top: () => (strip?.getBoundingClientRect().top ?? 0) + TOP,
    }),
  )

  $effect(() => {
    closing?.still(sized.map((one) => one.id))
  })

  $effect.pre(() => {
    if (stripWidth <= 0) return
    if (!untrack(() => live)) {
      requestAnimationFrame(() => (live = true))
      return
    }

    resizing = true
    const frame = requestAnimationFrame(() => (resizing = false))
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    const id = activeId
    const node = strip
    if (!id || !node || stripWidth <= 0) return

    untrack(() => {
      const box = layout.boxes[id]
      if (!box) return
      const at = node.scrollLeft * i18n.factor
      const to = revealed(at, stripWidth, span, box.x, box.x + box.width + lead + LEAD)
      if (Math.abs(to - at) < 1) return
      node.scrollTo({
        left: to * i18n.factor,
        behavior: stillness() || resizing ? 'instant' : 'smooth',
      })
    })
  })

  function closeTab(tab: Tab, by: 'mouse' | 'touch' | null) {
    if (by && worthKeeping(sized, room)) {
      closing?.hold(
        new Map(sized.map((one, at) => [one.id, widths[at] ?? 0])),
        sized.map((one) => one.id),
        by,
        () => strip?.getBoundingClientRect() ?? null,
        () => i18n.factor,
      )
    }

    void (by ? workspace.closeAsking(tab.id) : closeByKey(tab.id))
  }

  async function closeByKey(id: string) {
    await workspace.closeAsking(id)
    await tick()
    if (workspace.tabs.some((one) => one.id === id)) return
    const next = strip?.querySelector<HTMLElement>(`.pick[data-tab="${activeId}"]`)
    next?.focus()
    if (next) staysOn(next)
  }

  function pointerOf(event: MouseEvent): 'mouse' | 'touch' | null {
    if (event.detail === 0) return null
    return 'pointerType' in event && event.pointerType === 'touch' ? 'touch' : 'mouse'
  }

  function unfollow() {
    workspace.panes.landing = null
    workspace.panes.dragging = null
  }

  const chip = $derived.by(() => {
    if (!drag.out) return null
    const press = drag.pressing
    if (!press) return null

    const width = widths[sized.findIndex((one) => one.id === drag.tabId)] ?? 0
    const grab = press.grab - (block?.strip.before ?? 0)
    const left = i18n.factor > 0 ? drag.pointer.x - grab : drag.pointer.x + grab - width
    const target = landing?.kind === 'strip' ? stripOf(landing.paneId) : undefined

    return { left, top: target ? target.top() : drag.pointer.y - grabY, width }
  })

  const carriedTab = $derived(tabs.find((one) => one.id === drag.tabId) ?? null)
  let Chip = $state<typeof import('./tab-strip/TabChip.svelte').default | null>(null)
  let carry: typeof import('./tab-strip/carrying') | null = null

  function capture(node: HTMLElement, pointerId: number) {
    try {
      node.setPointerCapture(pointerId)
    } catch {
      // Nothing to hold on to, and nothing that needs holding.
    }
  }

  function pressed(event: PointerEvent, tab: Tab, at: number) {
    if (event.button === 1) {
      event.preventDefault()
      return
    }
    if (event.button !== 0 || drag.pressing) return
    if (!Chip) void here(import('./tab-strip/TabChip.svelte')).then((one) => (Chip = one.default))
    if (!carry) {
      void here(import('./tab-strip/carrying')).then((one) => {
        carry = one
        if (drag.on) one.follow(drag, paneId)
      })
    }
    if (!picks.loaded) void loadPicking()

    const finger = event.pointerType === 'touch'
    if (!finger && picksWith(event)) {
      event.preventDefault()
      const loaded = picks.loaded
      if (!loaded) {
        void loadPicking().then((one) => pickWith(one, event, tab))
        return
      }
      if (pickWith(loaded, event, tab) !== tab.id) return
      plainOnPick = false
    } else {
      plainOnPick = picked.has(tab.id)
      if (!finger && !plainOnPick) picking?.chosen.clear()
      if (!finger) workspace.activate(tab.id)
    }
    block = finger ? null : (picking?.Block.of(paneId, tab, sized, widths) ?? null)

    const node = event.currentTarget as HTMLElement
    const top = node.closest('.tab')?.getBoundingClientRect().top ?? event.clientY
    const along = alongOf(event.clientX)

    grabY = event.clientY - (top + TOP)
    drag.down({
      tabId: tab.id,
      from: block?.strip.from ?? at,
      along,
      x: event.clientX,
      y: event.clientY,
      grab: along - (base[at]?.x ?? 0) + (block?.strip.before ?? 0),
      finger,
    })

    if (!finger) capture(node, event.pointerId)
  }

  function movedTo(event: PointerEvent) {
    const press = drag.pressing
    if (!press || !strip) return

    const lifting = !drag.on
    const up = drag.move(
      alongOf(event.clientX),
      event.clientX,
      event.clientY,
      holds(
        strip.getBoundingClientRect(),
        event.clientX,
        event.clientY,
        press.finger ? MAGNETISM.touch : MAGNETISM.mouse,
      ),
      block?.frame(room ?? endOf(base)) ?? { widths, room: room ?? endOf(base) },
    )
    if (!up) return

    event.preventDefault()
    if (lifting) {
      closing?.letGo()
      ;(event.currentTarget as HTMLElement).dispatchEvent(new CustomEvent('orden-took-over'))
    }
    carry?.follow(drag, paneId)
  }

  function settle(tabId: string) {
    settling = tabId
    setTimeout(() => {
      if (settling === tabId) settling = null
    }, dur(210))
  }

  function released(event: PointerEvent) {
    if (!drag.pressing) return

    const from = chip
    const where = workspace.panes.landing
    const carried = block
    block = null
    const ending = drag.release()
    unfollow()
    if (ending.kind === 'click') {
      if (plainOnPick) picking?.chosen.clear()
      return
    }

    event.preventDefault()
    settle(ending.tabId)

    if (ending.kind === 'moved') {
      if (carried) carried.moved(paneId, ending.from, ending.to)
      else if (ending.to !== ending.from) workspace.moveTab(ending.tabId, paneId, ending.to)
      return
    }

    if (where) {
      if (from) handOver(ending.tabId, from.left, from.top)
      if (carried) carried.dropped(where)
      else workspace.dropTab(ending.tabId, where)
    } else {
      carry?.droppedOnList(ending.tabId)
      if (from) flyHome(ending.tabId, from)
    }
  }

  function flyHome(tabId: string, from: { left: number; top: number }) {
    carry?.flyHome(
      () => [
        strip?.querySelector<HTMLElement>(`[data-box="${CSS.escape(tabId)}"]`),
        layout.boxes[tabId],
      ],
      from,
      TOP,
    )
  }

  function giveUp() {
    const tabId = drag.tabId
    const from = chip
    block = null
    drag.cancel()
    unfollow()
    if (!tabId) return
    carry?.overList(tabId, null)

    settle(tabId)
    if (from) flyHome(tabId, from)
  }

  function keyed(event: KeyboardEvent) {
    if (!drag.on || event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    giveUp()
  }

  onDestroy(() => {
    if (drag.on) unfollow()
    closing?.letGo()
  })

  const widthOf = (node: HTMLElement) => parseFloat(node.style.width) || 0

  function arrive(node: HTMLElement, { id, x }: { id: string; x: number }) {
    const from = arrival(id)
    const duration = dur(210)

    if (workspace.panes.swapping) return risen(x)

    if (from) {
      const rect = node.getBoundingClientRect()
      const dx = from.left - rect.left
      const dy = from.top - TOP - rect.top
      return {
        duration,
        easing: quintOut,
        css: (_t: number, u: number) => `transform: translate(${x + dx * u}px, ${dy * u}px)`,
      }
    }

    const width = widthOf(node)
    const before = node.previousElementSibling
    const dx = before?.classList.contains('tab')
      ? before.getBoundingClientRect().right - node.getBoundingClientRect().left
      : 0

    return {
      duration,
      easing: quintOut,
      css: (t: number, u: number) =>
        `width: ${t * width}px; transform: translateX(${x + dx * u}px)`,
    }
  }

  const risen = (x = 0) => ({
    duration: dur(150),
    easing: quintOut,
    css: (t: number, u: number) => `opacity: ${t}; transform: translate(${x}px, ${u * 4}px)`,
  })

  const together = (_node: Element) => (workspace.panes.swapping ? risen() : { duration: dur(0) })

  function leave(node: HTMLElement) {
    node.classList.remove('active', 'chosen', 'line')
    node.classList.add('leaving')
    const duration = workspace.panes.swapping ? 0 : dur(210)
    if (duration) node.style.width = '0px'
    return { duration }
  }

  const takes = (transfer: DataTransfer | null) =>
    isTreeDrag(transfer) || isBookmarkDrag(transfer) || mayCarryAddress(transfer?.types ?? [])

  function over(event: DragEvent) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()
    if (
      event.dataTransfer &&
      (isTreeDrag(event.dataTransfer) || isBookmarkDrag(event.dataTransfer))
    ) {
      event.dataTransfer.dropEffect = 'move'
    }

    const at = slotAt(base, alongOf(event.clientX))
    const where: Landing = { kind: 'strip', paneId, at }
    if (keyOf(workspace.panes.landing) !== keyOf(where)) workspace.panes.landing = where
  }

  function dropped(event: DragEvent) {
    const transfer = event.dataTransfer
    if (!takes(transfer)) return

    event.preventDefault()
    event.stopPropagation()

    const at = slotAt(base, alongOf(event.clientX))
    workspace.panes.landing = null
    workspace.panes.dropped()

    const mark = draggedBookmark(transfer)
    if (mark !== null) {
      void here(import('./tab-strip/essential-drop')).then(({ droppedEssential }) =>
        droppedEssential(mark, paneId, at),
      )
      return
    }

    if (!isTreeDrag(transfer)) {
      const held = new Map(
        ['text/uri-list', 'text/plain'].map((type) => [type, transfer?.getData(type) ?? '']),
      )
      void here(import('./tab-strip/dropped')).then(({ droppedAddress }) => {
        const address = droppedAddress((type) => held.get(type) ?? '')
        const from = workspace.panes.at(paneId)?.activeTabId ?? undefined
        const id = address === null ? null : workspace.openPage(address, 'plain', from)
        if (id !== null) workspace.moveTab(id, paneId, at)
      })
      return
    }

    const paths = dragged(transfer)
    if (paths.length) void workspace.dropNotes(paths, { kind: 'strip', paneId, at })
  }

  $effect(() => {
    const node = strip
    if (!node) return

    const turned = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return
      const along = wheelAlong(event, node.clientWidth)
      if (along === 0) return

      event.preventDefault()
      node.scrollLeft += along * i18n.factor
    }

    node.addEventListener('wheel', turned, { passive: false })
    return () => node.removeEventListener('wheel', turned)
  })

  function renameKey(event: KeyboardEvent) {
    if (!shortcuts.pressed('tabs.rename', event) || !(event.target instanceof Element)) return

    const id = event.target.closest<HTMLElement>('.pick')?.dataset.tab
    const tab = tabs.find((one) => one.id === id)
    if (!tab || !workspace.canRenameFromTab(tab)) return

    event.preventDefault()
    rename(tab.id)
  }

  const rename = (id: string) =>
    void here(import('./tab-strip/ops')).then((ops) => ops.renameFromTab(id))

  function doubled(tab: Tab) {
    if (tab.kind === 'terminal') rename(tab.id)
    else workspace.keep(tab.id)
  }

  const picksWith = (event: MouseEvent) =>
    event.shiftKey || (shortcuts.platform === 'mac' ? event.metaKey : event.ctrlKey)

  const loadPicking = () =>
    here(import('./tab-strip/picking.svelte')).then((one) => (picks.loaded ??= one))

  function pickWith(loaded: NonNullable<typeof picks.loaded>, event: MouseEvent, tab: Tab) {
    const how = loaded.pickingOf(event, shortcuts.platform === 'mac')
    const front = how && loaded.pick(paneId, tab.id, how)
    if (front) workspace.activate(front)
    return front
  }

  let cards: Promise<typeof import('./tab-strip/hover-card.svelte')> | undefined
  const card = (tab: Tab, node: Element | null, focused = false) =>
    void (cards ??= here(import('./tab-strip/hover-card.svelte'))).then(({ hovering }) =>
      node ? hovering.restOn(tab, node, focused) : hovering.leave(tab.id),
    )
</script>

<svelte:window onkeydowncapture={keyed} />

<div class="strip" in:together|global>
  {#if walked && walking}
    <div class="steps">
      <button
        class="step"
        title={shortcuts.tooltip(t('Back'), 'app.back')}
        aria-label={t('Back')}
        disabled={!walking.canGoBack}
        onclick={(event) => workspace.goBack(walking.id, tabAsk(event))}
        use:middleOpens={(event) => workspace.goBack(walking.id, tabAsk(event))}
        oncontextmenu={(event) => showTrail(event, walking)}
        use:longPress={(event) => showTrail(event, walking)}
      >
        <svg class="orden-mirror" viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
      </button>
      <button
        class="step"
        title={shortcuts.tooltip(t('Forward'), 'app.forward')}
        aria-label={t('Forward')}
        disabled={!walking.canGoForward}
        onclick={(event) => workspace.goForward(walking.id, tabAsk(event))}
        use:middleOpens={(event) => workspace.goForward(walking.id, tabAsk(event))}
      >
        <svg class="orden-mirror" viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
      </button>
    </div>
  {/if}

  <span class="reach" class:quiet aria-hidden="true"></span>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tabs"
    data-region="tabs"
    data-strip={paneId}
    data-tauri-drag-region={caption ? '' : undefined}
    bind:this={strip}
    bind:clientWidth={stripWidth}
    style:--lead="{lead}px"
    style:--tab-top="{TOP}px"
    use:roving={{
      across: true,
      rows: '.pick',
      current: '.active > .pick',
      wrap: true,
      quiet: '.shut',
      open: (row) => {
        const inFront = row.dataset.tab === activeId
        row.click()
        const showing = workspace.showing(paneId)
        if (inFront && showing?.kind === 'note' && !showing.reading) views.of(paneId)?.focus()
      },
      peek: (row) => row.click(),
      remove: (row) => void closeByKey(row.dataset.tab ?? ''),
      menu: (row, at) => row.dispatchEvent(at),
    }}
    class:quiet
    class:live={live && !resizing}
    class:moving={drag.on}
    class:bare
    class:flush
    use:dropOver={over}
    ondragleave={(event) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (incoming === null || inside(box, event.clientX, event.clientY)) return

      workspace.panes.landing = null
    }}
    ondrop={dropped}
    onkeydown={renameKey}
    oncontextmenu={showStripMenu}
    use:longPress={showStripMenu}
  >
    <span class="measure" aria-hidden="true" bind:this={measurer}></span>
    <div class="lane" class:shrinking style:width="max(100%, {span}px)">
      {#each tabs as tab, at (tab.id)}
        {@const seen = rooms.seen[tab.note.key]}
        {@const faces = seen?.people.slice(0, 3) ?? []}
        {@const elsewhere = Math.min(seen?.mine ?? rooms.present[tab.note.key] ?? 0, 3)}
        {@const box = layout.boxes[tab.id] ?? { x: 0, width: 0 }}
        {@const icon = icons && tab.id !== activeId && tab.id !== opened}
        {@const parts = partsFor(box.width, { icon, active: tab.id === activeId }, viewport.touch)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tab"
          data-box={tab.id}
          class:active={tab.id === activeId}
          class:first={at === 0 && box.x <= 0}
          class:icon
          class:preview={tab.id === workspace.previewTabId}
          class:line={lines.has(tab.id)}
          class:closable={parts.close}
          class:chosen={picked.has(tab.id)}
          class:carried={lifted.includes(tab.id) && !drag.out}
          class:gone={lifted.includes(tab.id) && drag.out}
          class:away={tabOverview.out.includes(tab.id)}
          class:settling={settling === tab.id}
          class:onbar={tab.kind === 'web'}
          class:onterminal={tab.kind === 'terminal'}
          data-theme={tab.id === activeId ? chrome.tabTheme(tab.id) : undefined}
          style:--web-ground={chrome.barOf(tab.id)?.colour}
          style:--terminal-paper={tab.kind === 'terminal' ? chrome.terminal : null}
          style:width="{box.width}px"
          style:transform="translateX({box.x * i18n.factor}px)"
          style:--w="{box.width}px"
          onpointerenter={(event) => {
            if (event.pointerType !== 'mouse') return
            hovered = tab.id
            card(tab, event.currentTarget)
          }}
          onpointerleave={() => {
            if (hovered === tab.id) hovered = null
            card(tab, null)
          }}
          in:arrive={{ id: tab.id, x: box.x * i18n.factor }}
          out:leave
        >
          <span class="fill" aria-hidden="true"></span>
          <span class="edge" aria-hidden="true"></span>
          <button
            class="pick"
            class:centred={parts.centred}
            data-tab={tab.id}
            aria-label={tab.shown}
            aria-current={tab.id === activeId ? 'page' : undefined}
            onfocus={(event) => {
              if (event.currentTarget.matches(':focus-visible'))
                card(tab, event.currentTarget, true)
            }}
            onblur={() => card(tab, null)}
            onclick={(event) => {
              resumes(tab.id)
              if (event.detail > 0 && picksWith(event)) return
              workspace.activate(tab.id)
              if (event.target instanceof Element && event.target.closest('.orden-unsaved')) {
                askPlace(tab.id)
              }
            }}
            ondblclick={() => doubled(tab)}
            oncontextmenu={(event) => showMenu(event, tab)}
            onauxclick={(event) => {
              if (event.button === 1) closeTab(tab, 'mouse')
            }}
            onpointerdown={(event) => {
              onMark = event.target instanceof Element && !!event.target.closest('.face')
              pressed(event, tab, at)
            }}
            onpointermove={movedTo}
            onpointerup={released}
            onpointercancel={giveUp}
            onlostpointercapture={() => {
              if (drag.on) giveUp()
            }}
            use:longPress={(event) => showMenu(event, tab)}
          >
            <span class="face" class:hidden={!parts.mark} class:unloaded={tab.unloaded}
              ><TabMark {tab} />{#if icon && lettered.has(tab.id)}<span
                  class="letter"
                  aria-hidden="true">{initialOf(tab.shown)}</span
                >{/if}{#if isDraft(tab.note) && (icon || !parts.title)}<UnsavedDot
                  corner
                  pressable
                />{/if}</span
            >
            {#if tab.reading}
              <svg
                class="reading"
                class:hidden={!parts.title}
                viewBox="0 0 14 12"
                role="img"
                aria-label={t('Reading')}
                transition:fade={{ duration: dur(140) }}
              >
                <path d="M7 3.2v7.3M7 3.2C5.6 2 3.9 1.6 1.5 1.6v7.3c2.4 0 4.1.4 5.5 1.6" />
                <path d="M7 3.2c1.4-1.2 3.1-1.6 5.5-1.6v7.3c-2.4 0-4.1.4-5.5 1.6" />
              </svg>
            {/if}
            <span
              class="label"
              class:whole={(fits[tab.id] ?? Infinity) <= box.width}
              class:hidden={!parts.title && !icon}
              class:quiet={icon}
              class:naming={tab.naming}><bdi>{tab.shown}</bdi></span
            >
            {#if isDraft(tab.note) && !icon && parts.title}
              <UnsavedDot pressable />
            {/if}
            <Door open={tab.inPrivate} load={() => privateMark()}>
              {#snippet children(Private)}<Private />{/snippet}
            </Door>
            {#if tab.kind === 'web' && parts.title}
              {@const heard = pages.of(tab.id)}
              <Door open={heard.playing} load={() => soundMark()}>
                {#snippet children(Sound)}<Sound muted={heard.muted} />{/snippet}
              </Door>
            {/if}
            {#if tab.note.shared && parts.title}
              <SharedMark label={t('Shared with you')} />
            {/if}
            {#if syncMark.asked && parts.title}
              {#await syncMark.asked then Held}<Held path={tab.path} />{/await}
            {/if}
            {#if (elsewhere || faces.length) && parts.title}
              <span
                class="here"
                role="img"
                aria-label={t('Also open elsewhere')}
                title={t('Also open elsewhere')}
              >
                {#each faces as one (one.key)}
                  <span
                    class="who face"
                    style:--fill={one.fill}
                    style:background-image={one.face && `url("${one.face}")`}
                    transition:fade={{ duration: dur(190) }}
                    >{one.face ? '' : initial(one.name)}</span
                  >
                {/each}
                {#each { length: elsewhere } as _, at (at)}
                  <span class="who" transition:fade={{ duration: dur(190) }}></span>
                {/each}
              </span>
            {/if}
          </button>
          {#if tab.naming && parts.title}
            {#await tabNameField() then Field}<Field {tab} />{/await}
          {/if}
          {#if !icon}
            <button
              class="shut"
              class:hidden={!parts.close || !crossTakes(tab.id, opened, settledOpen)}
              title={shortcuts.tooltip(t('Close'), 'app.close')}
              aria-label={t('Close')}
              onclick={(event) => closeTab(tab, pointerOf(event))}
            >
              <Cross small />
            </button>
          {/if}
        </div>
      {/each}

      {#if !viewport.touch}
        <button
          class="new"
          title={shortcuts.tooltip(t('New tab'), 'app.new-kind')}
          aria-label={t('New tab')}
          style:transform="translateX({(layout.end + PLUS_GAP) * i18n.factor}px)"
          onclick={() => workspace.newTab(paneId)}
        >
          <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg>
        </button>
      {/if}
    </div>
  </div>
  <span class="reach" class:quiet aria-hidden="true"></span>

  {#if caption}
    <div class="drag" data-tauri-drag-region></div>
  {/if}

  {#if twinned}
    <button
      class="link"
      class:on={pane?.linked}
      title={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-label={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-pressed={!!pane?.linked}
      onclick={() => workspace.toggleLink(paneId)}
    >
      <svg viewBox="0 0 14 14">
        <path
          d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
        />
      </svg>
    </button>
  {/if}

  {#if walking?.kind === 'note'}
    <button
      class="orden-glyph more"
      title={t('More')}
      aria-label={t('More')}
      aria-haspopup="menu"
      onclick={showNoteMenu}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h0M8 8h0M13 8h0" /></svg>
    </button>
  {/if}
</div>

{#if chip && carriedTab && Chip}
  <Chip tab={carriedTab} {...chip} />
{/if}

<style>
  .strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1 1 0;
    --tab-line: var(--strip-line, var(--tab-edge));
  }

  .tabs {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    --tab-paper: var(--paper, var(--bg));
    --tab-ground: var(--tab-paper);
    --tab-hover: var(--glass-tab-hover, color-mix(in srgb, var(--text) 8%, transparent));
    --tab-round: var(--radius-md);
    --tab-foot: var(--radius-md);
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .lane {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    overflow: clip;
    pointer-events: none;
  }

  .tabs.live .lane.shrinking {
    transition: width var(--dur-base) var(--ease-out);
  }

  .reach {
    position: relative;
    flex: none;
  }

  .reach::after {
    content: '';
    position: absolute;
    bottom: 0;
    inset-inline-end: 0;
    width: 100vw;
    height: 1px;
    background: var(--tab-line);
  }

  .tabs + .reach::after {
    inset-inline: 0 auto;
  }

  .tabs.bare {
    box-shadow: inset 0 -1px var(--tab-line);
  }

  .tabs,
  .reach {
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .quiet {
    opacity: 0.55;
  }

  .tab {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: var(--lead);
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    --round: clamp(0px, (var(--w) - 6px - 2 * var(--tab-round)) / 3, var(--tab-round));
  }

  .tabs.live .tab,
  .tabs.live .new {
    transition:
      transform var(--dur-base) var(--ease-out),
      width var(--dur-base) var(--ease-out);
  }

  .tabs.live .tab.carried {
    transition: none;
  }

  .tab.active {
    z-index: var(--z-raised);
  }

  .tab.carried,
  .tab.settling {
    z-index: var(--z-lifted);
  }

  .tab.gone {
    opacity: 0;
  }

  .tab.away {
    visibility: hidden;
  }

  .tabs.moving .tab:not(.carried) {
    pointer-events: none;
  }

  .tab.onbar {
    --tab-ground: var(--web-ground, var(--surface));
  }

  .tab.onterminal {
    --tab-ground: var(--terminal-paper, var(--terminal-ground, var(--tab-paper)));
  }

  .fill {
    position: absolute;
    inset: var(--tab-top) 3px 0;
    border-radius: var(--round) var(--round) 0 0;
    pointer-events: none;
  }

  .fill {
    opacity: 0;
  }

  .tab.active .fill {
    opacity: 1;
    background: var(--tab-ground);
    transition:
      --tab-ground var(--dur-slow) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .tab.chosen:not(.active)::before {
    opacity: 1;
    background: var(--surface-picked);
  }

  .tab.active .fill::before,
  .tab.active .fill::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: var(--tab-foot);
    height: var(--tab-foot);
    --rise:
      transparent calc(var(--tab-foot) - 1.5px),
      var(--tab-line) calc(var(--tab-foot) - 1px) calc(var(--tab-foot) - 0.5px),
      var(--tab-ground) var(--tab-foot);
  }

  .tab.active .fill::before {
    right: 100%;
    background: radial-gradient(circle at 0 0, var(--rise));
  }

  .tab.active .fill::after {
    left: 100%;
    background: radial-gradient(circle at 100% 0, var(--rise));
  }

  .edge {
    position: absolute;
    inset: calc(var(--tab-top) - 1px) 2px var(--tab-foot);
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: calc(var(--round) + 1px) calc(var(--round) + 1px) 0 0;
    pointer-events: none;
  }

  .tab.active .edge {
    border-color: var(--tab-line);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .tab.active .edge::before,
  .tab.active .edge::after {
    content: '';
    position: absolute;
    bottom: calc(-1 * var(--tab-foot));
    width: 100vw;
    height: 1px;
    background: var(--tab-line);
  }

  .tab.active .edge::before {
    right: calc(100% + var(--tab-foot));
  }

  .tab.active .edge::after {
    left: calc(100% + var(--tab-foot));
  }

  .tabs.flush .tab.first .fill {
    inset-inline-start: 0;
  }

  .tabs.flush .tab.first .edge {
    inset-inline-start: -1px;
  }

  :global(:root:not([dir='rtl'])) .tabs.flush .tab.first.active .fill::before,
  :global(:root[dir='rtl']) .tabs.flush .tab.first.active .fill::after {
    display: none;
  }

  :global(:root:not([dir='rtl'])) .tabs.flush .tab.first.active .edge::before {
    right: auto;
    left: -1px;
    width: 1px;
    height: var(--tab-foot);
  }

  :global(:root[dir='rtl']) .tabs.flush .tab.first.active .edge::after {
    left: auto;
    right: -1px;
    width: 1px;
    height: var(--tab-foot);
  }

  .tab::before {
    content: '';
    position: absolute;
    inset: var(--tab-top) 3px;
    border-radius: var(--round);
    background: var(--tab-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .tab:not(.active):hover::before {
      opacity: 1;
    }
  }

  .tab::after {
    content: '';
    position: absolute;
    inset-inline-end: -0.5px;
    top: calc(50% - 8px);
    width: 1px;
    height: 16px;
    background: var(--line-strong);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .tab.line::after {
    opacity: 1;
  }

  .tab:global(.leaving) {
    pointer-events: none;
  }

  .tab:global(.leaving):hover::before,
  .tab:global(.leaving) .shut {
    opacity: 0;
  }

  button {
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .pick {
    position: absolute;
    inset: 0 3px;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: var(--tab-top) 8px;
    overflow: hidden;
    white-space: nowrap;
    text-align: start;
    touch-action: none;
  }

  .tab.closable .pick {
    padding-inline-end: calc(8px + 16px + 4px);
  }

  .pick.centred {
    justify-content: center;
    padding-inline: 0;
  }

  .tab:hover .pick {
    color: var(--text);
  }

  .tab.active .pick {
    color: var(--text-strong);
  }

  .face {
    position: relative;
    display: flex;
    flex: none;
  }

  .face.unloaded {
    opacity: 0.45;
  }

  .letter {
    position: absolute;
    inset-inline-end: -6px;
    bottom: -4px;
    min-width: 11px;
    padding: 0 2px;
    border-radius: 3px;
    background: var(--tab-ground);
    color: var(--text-strong);
    font-size: 9px;
    font-weight: var(--weight-strong);
    line-height: 11px;
    text-align: center;
  }

  .hidden {
    display: none;
  }

  .reading,
  .label,
  .here,
  .tab :global(.sound) {
    margin-inline-start: 6px;
  }

  .label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    unicode-bidi: isolate;
    --fade: min(24px, 33%);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
  }

  :global(:root[dir='rtl']) .label {
    mask-image: linear-gradient(to left, #000 calc(100% - var(--fade)), transparent);
  }

  .label {
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .label.quiet {
    opacity: 0;
  }

  .label.whole,
  :global(:root[dir='rtl']) .label.whole {
    mask-image: none;
  }

  .measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .label.naming {
    visibility: hidden;
  }

  .tab.preview .pick {
    font-style: italic;
  }

  .reading {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  .here {
    display: flex;
    flex: none;
    align-items: center;
    margin-inline-end: -2px;
  }

  .who {
    width: 5px;
    height: 5px;
    flex: none;
    margin-inline-end: -2px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .who.face {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    background: var(--fill) center / cover;
    color: var(--accent-ink);
    font: var(--weight-strong) 9px var(--font-ui);
  }

  .shut {
    position: absolute;
    inset-inline-end: calc(3px + 8px);
    top: calc(50% - 8px);
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    flex: none;
    padding: 0;
    border-radius: 50%;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .shut::after {
    content: '';
    position: absolute;
    inset: -4px;
  }

  .shut.hidden {
    display: none;
  }

  .shut:hover {
    color: var(--danger);
    background: var(--surface-hover);
  }

  .shut:active {
    color: color-mix(in srgb, var(--danger) 78%, var(--text-strong));
    background: var(--surface-press);
  }

  .shut :global(svg) {
    width: 8px;
    height: 8px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .new {
    position: absolute;
    inset-inline-start: var(--lead);
    top: calc(50% - var(--row-height) / 2);
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: var(--radius-row);
    color: var(--muted);
    pointer-events: auto;
  }

  .new:hover {
    background: var(--tab-hover);
    color: var(--text-strong);
  }

  .new:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .new svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .steps {
    display: flex;
    align-items: center;
    flex: none;
    padding-inline-start: var(--space-1);
  }

  .step {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    display: grid;
    place-items: center;
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .step:hover:not(:disabled) {
    background: var(--tab-hover);
    color: var(--text-strong);
  }

  .step:active:not(:disabled) {
    background: var(--surface-press);
  }

  .step svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .drag {
    flex: none;
    width: var(--space-5);
  }

  .link {
    flex: none;
    align-self: center;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    margin-inline-start: var(--space-1);
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .link:hover {
    background: var(--tab-hover);
    color: var(--text-strong);
  }

  .link:active {
    background: var(--surface-press);
  }

  .link.on {
    color: var(--accent);
    background: var(--surface-selected);
  }

  .more {
    align-self: center;
  }

  .more svg {
    stroke-width: 2.6;
  }

  .link svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }
</style>
