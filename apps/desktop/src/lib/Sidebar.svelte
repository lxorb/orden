<script lang="ts">
  import {
    carried,
    carrySection,
    draggedSection,
    dropOver,
    isSectionDrag,
    landing,
  } from './drag-paths'
  import { dropOnList } from './list-landing.svelte'
  import { movesSection } from './sections'
  import { onMount, untrack } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { landsIn } from './move-targets'
  import { shortcuts } from './shortcuts.svelte'
  import { agentMarks } from './agent-marks.svelte'
  import { chatsUnread, lookAtLaunch } from './ai/unread.svelte'
  import UnreadDot from './ai/UnreadDot.svelte'
  import { account } from './account.svelte'
  import {
    ASK_MARK,
    CHATS_MARK,
    FILES_MARK,
    FOLD_MARK,
    GRAPH_MARK,
    LINKS_MARK,
    ORDER_MARK,
    OUTLINE_MARK,
    SCRATCHPAD_MARK,
    TASKS_MARK,
  } from './panel-marks'
  import { newSpace } from './space-actions'
  import { startup } from './startup.svelte'
  import { arriving } from './arriving.svelte'
  import { arrive, leave, segmented } from './slide'
  import { splitTabs, tabsShown } from './workspace/panels'
  import { headingAt, lineOf } from './outline'
  import { pdfOutlines } from './pdf/outline.svelte'
  import { pages } from './pages/showing.svelte'
  import {
    archiveSection,
    askPanel,
    chatsPanel,
    linksPanel,
    pagesNavigator,
    phoneTabsBar,
    phoneYou,
    scratchpadCard,
    searchPanel,
    tasksPanel,
  } from './surfaces.svelte'
  import { shown as pad } from './scratchpad/is.svelte'
  import { bookmarkEntry, DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { roving } from './roving'
  import type { Panel, PanelSide } from './workspace.svelte'
  import { pullable } from './pull.svelte'
  import { scrollbar } from './scrollbar'
  import { workspace } from './workspace.svelte'
  import { links } from './link-index.svelte'
  import { worthAGraph } from './graph'
  import { DEEPEST, SHALLOWEST } from './workspace/graph-settings.svelte'
  import { search } from './search.svelte'
  import { SidebarWidth } from './sidebar-width.svelte'
  import { viewport } from './viewport.svelte'
  import { edgePeek, endPeek } from './edge-peek.svelte'
  import { sideToggles } from './side-toggles.svelte'
  import { overlays } from './overlays'
  import { fullscreen } from './fullscreen.svelte'
  import { alone } from './alone.svelte'
  import { hiddenKinds } from './settings.svelte'
  import { canWriteAt } from './sharing.svelte'
  import Bookmarks from './Bookmarks.svelte'
  import SidebarFoot from './SidebarFoot.svelte'
  import SidebarToggle from './SidebarToggle.svelte'
  import { swipeOpens } from './swipe-opens'
  import SpaceSwitcher from './SpaceSwitcher.svelte'
  import { dropTarget } from './drop-target.svelte'
  import Tree from './Tree.svelte'
  import { dur } from './motion'

  const {
    side = 'left',
    ongoto,
    onmovesection,
  }: {
    side?: PanelSide
    ongoto?: (line: number) => void
    onmovesection?: (from: number, to: number) => void
  } = $props()

  const rootDrop = $derived.by(() => {
    const root = workspace.activeSpace?.root
    return root !== undefined && dropTarget.lit(root)
  })

  function overRoot(event: DragEvent) {
    const root = workspace.activeSpace?.root
    const how = landing(event, shortcuts.platform)
    if (!how || !root) return

    const paths = carried()
    if (paths.length && !landsIn(paths, root, how)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = how
    dropTarget.over(root)
  }

  function dropOnRoot(event: DragEvent) {
    event.preventDefault()
    dropTarget.clear()

    const root = workspace.activeSpace?.root
    if (root) dropOnList(event, root)
  }

  const HOLD_MARK = 'M4.6 2h4M6.6 2v3.2M4 5.2h5.2M6.6 5.2v5.6'

  const FRESH_MARK =
    'M6 2.5H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7M9.2 2.3l1.5 1.5-4.2 4.2-2 .5.5-2z'

  const THREADS_MARK =
    'M2 6.5a4.5 4.5 0 1 0 4.5-4.5 4.9 4.9 0 0 0-3.4 1.4L2 4.5M2 2v2.5h2.5M6.5 4v2.5l2 1'

  const MORE_MARK = 'M3 6.5h.1M6.5 6.5h.1M10 6.5h.1'

  const phoneTabs = $derived(side === 'left' && viewport.device === 'phone' && !__EVEN_PLUGIN__)

  const padHere = $derived(side === 'right' && !viewport.touch && !__EVEN_PLUGIN__)

  const open = $derived(
    side === 'right' ? workspace.rightShows !== null : workspace.openOn(side) !== null,
  )

  let lastShown: Panel = untrack(() => workspace.openOn(side)) ?? 'tree'
  const showing = $derived.by((): Panel | 'scratchpad' => {
    if (side === 'right' && padHere && pad.on) return 'scratchpad'
    const open = workspace.openOn(side)
    const chosen = open ?? (side === 'right' ? (workspace.nextRight ?? lastShown) : lastShown)
    if (open) lastShown = open
    if (workspace.fills(chosen)) return chosen
    return mine.find((one) => one.id !== 'scratchpad')?.id ?? chosen
  })

  let entered = $state(untrack(() => !startup.reached('index')))
  onMount(() => {
    if (entered) return
    const next = requestAnimationFrame(() => (entered = true))
    return () => cancelAnimationFrame(next)
  })
  const shut = $derived(!open || !entered)

  const peeker = $derived(side === 'left' ? edgePeek : endPeek)
  const peek = $derived(shut && peeker.out)
  let floating = $state(false)
  $effect(() => {
    if (peek) {
      floating = true
      return
    }
    if (!shut) {
      floating = false
      return
    }
    if (!untrack(() => floating)) return
    const settled = setTimeout(() => (floating = false), dur(130))
    return () => clearTimeout(settled)
  })

  let carrying = false

  let column = $state<HTMLElement>()

  $effect(() => {
    if (viewport.touch || (side === 'right' && !sideToggles.inside)) return
    const stop = peeker.watch({
      may: () =>
        (side === 'left' ? workspace.panel === null : workspace.rightShows === null) &&
        !viewport.drawer &&
        !fullscreen.on &&
        !alone.on &&
        workspace.panes.fills === null &&
        overlays.depth === 0,
      width: () => window.innerWidth,
      rtl: () => getComputedStyle(document.documentElement).direction === 'rtl',
      top: () => column?.getBoundingClientRect().top ?? 0,
      over: (x, y) => {
        const box = aside?.getBoundingClientRect()
        return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
      },
      busy: () => {
        const on = document.activeElement
        const typing =
          !!on &&
          !!aside?.contains(on) &&
          (on.matches('input, textarea') || on.closest('[contenteditable="true"]') !== null)
        return carrying || typing || overlays.depth > 1
      },
    })
    const moved = (event: PointerEvent) => peeker.moved(event)
    const out = (event: MouseEvent) => {
      if (event.relatedTarget === null) peeker.away()
    }
    const carried = (event: DragEvent) => {
      carrying = event.type === 'dragstart' && !!aside?.contains(event.target as Node)
    }
    window.addEventListener('pointermove', moved, { passive: true })
    document.addEventListener('mouseout', out)
    window.addEventListener('dragstart', carried, true)
    window.addEventListener('dragend', carried, true)
    return () => {
      stop()
      window.removeEventListener('pointermove', moved)
      document.removeEventListener('mouseout', out)
      window.removeEventListener('dragstart', carried, true)
      window.removeEventListener('dragend', carried, true)
    }
  })

  $effect(() =>
    peek
      ? overlays.show(
          () => peeker.hide(),
          () => [aside],
        )
      : undefined,
  )
  $effect(() => {
    if (!shut) untrack(() => peeker.hide())
  })

  let moving = $state(false)
  let wasShut = untrack(() => shut)
  $effect.pre(() => {
    if (shut === wasShut) return
    wasShut = shut
    moving = !viewport.touch && dur(1) > 0
  })

  function slid(event: TransitionEvent) {
    if (event.target === event.currentTarget && event.propertyName === 'width') moving = false
  }

  const PANELS: { id: Panel; label: string; path: string }[] = [
    { id: 'tree', label: t('Files'), path: FILES_MARK },
    { id: 'outline', label: t('Outline'), path: OUTLINE_MARK },
    ...(__EVEN_PLUGIN__
      ? []
      : [
          { id: 'tasks' as const, label: t('Tasks'), path: TASKS_MARK },
          { id: 'chats' as const, label: t('Chats'), path: CHATS_MARK },
        ]),
    { id: 'links', label: t('Links'), path: LINKS_MARK },
    { id: 'ask', label: t('Ask'), path: ASK_MARK },
  ]

  $effect(() => {
    void lookAtLaunch(workspace.spaces.map((one) => one.id))
  })

  const mine = $derived.by(() => {
    const held = workspace.panelsOn(
      side,
      PANELS.map((one) => one.id),
    )

    const pads: { id: Panel | 'scratchpad'; label: string; path: string }[] = padHere
      ? [{ id: 'scratchpad', label: t('Scratchpad'), path: SCRATCHPAD_MARK }]
      : []
    const panelsHere: { id: Panel | 'scratchpad'; label: string; path: string }[] = held.flatMap(
      (id) =>
        PANELS.filter(
          (one) =>
            one.id === id &&
            workspace.fills(id) &&
            (id !== 'chats' || !!account.accountToken) &&
            (id !== 'ask' || !__EVEN_PLUGIN__),
        ),
    )
    return [...panelsHere, ...pads]
  })

  const commandOf = (id: Panel | 'scratchpad') => `app.${id === 'tree' ? 'files' : id}`

  let firstPress: Panel | 'scratchpad' | null = null

  const choose = (id: Panel | 'scratchpad') =>
    id === 'scratchpad' ? workspace.showRight('scratchpad') : workspace.showPanel(id)

  let rowWidth = $state(0)
  let toolsWidth = $state(0)
  let markWidth = $state(0)
  let floorWidth = $state(0)
  let tablist = $state<HTMLElement>()
  $effect(() => {
    if (!rowWidth) return
    markWidth = tablist?.querySelector('svg')?.getBoundingClientRect().width ?? 0
    const tab = tablist?.querySelector('button')
    floorWidth = tab ? parseFloat(getComputedStyle(tab).minWidth) || 0 : 0
  })
  const strip = $derived.by(() => {
    const room = rowWidth - 8 - (toolsWidth ? toolsWidth + 4 : 0)
    const shown = tabsShown(mine.length, room, Math.max(markWidth + 8, floorWidth))
    return splitTabs(mine, shown, (item) => item.id === showing)
  })

  function showBehind(event: MouseEvent) {
    menu.show(
      event,
      strip.behind.map((item) => ({
        label: item.label,
        hint: shortcuts.hint(commandOf(item.id)),
        run: () => choose(item.id),
      })),
      { title: t('More') },
    )
  }

  let graphing = $state(false)
  const depth = $derived(workspace.graphSettings.here.depth)

  const listing = $derived(workspace.shownTree)

  function showOrder(event: MouseEvent) {
    event.preventDefault()
    void import('./order-menu').then(({ orderMenu, orderTitle }) =>
      menu.show(event, orderMenu(), { title: orderTitle() }),
    )
  }

  function showTabMenu(event: MouseEvent, id: Panel, label: string) {
    event.preventDefault()
    const own = import('./panel-menu')
    const shown = (rows: MenuEntry[]) => menu.show(event, rows, { title: label })
    if (id !== 'tree') {
      void own.then(({ panelMenu }) => shown(panelMenu(id, side)))
      return
    }

    void Promise.all([import('./order-menu'), import('./row-menu'), own]).then(
      ([{ orderMenu }, { newFileRows }, { panelMenu }]) =>
        shown([...orderMenu(), DIVIDER, ...panelMenu(id, side, newFileRows())]),
    )
  }

  function showSpaceMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    void import('./row-menu').then(({ newFileRows }) =>
      menu.show(event, newFileRows(), titleOfSpace()),
    )
  }

  function titleOfSpace(): { title?: string } {
    const name = workspace.activeSpace?.name
    return name === undefined ? {} : { title: name }
  }

  function runBookmarked(text: string) {
    workspace.showPanel('search')
    search.ask(text)
  }

  $effect(() => {
    if (showing === 'search') void workspace.loadTags()
  })

  const held = $derived(workspace.held)
  const holdable = $derived(showing !== 'scratchpad' && workspace.holdable(showing))

  const paletteKey = $derived(shortcuts.hint('app.palette'))

  function jump(line: number) {
    const tab = workspace.panelTab
    if (tab && tab.id !== workspace.activeTabId) workspace.activate(tab.id)
    ongoto?.(line)
  }

  const contents = $derived.by(() => {
    const tab = workspace.panelTab
    return tab?.kind === 'pdf' ? (pdfOutlines.get(tab.id) ?? []) : []
  })

  function toPage(page: number) {
    const tab = workspace.panelTab
    if (!tab?.path) return
    if (tab.id !== workspace.activeTabId) workspace.activate(tab.id)
    workspace.gotoPage = { path: tab.path, page }
  }

  const shallowest = $derived(
    workspace.headings.reduce((least, heading) => Math.min(least, heading.level), 6),
  )

  const current = $derived.by(() => {
    if (showing !== 'outline') return -1

    const tab = workspace.panelTab
    const headings = workspace.headings
    if (!tab || !headings.length) return -1

    const line = tab.line ?? lineOf(tab.doc, tab.cursor ?? 0)
    return headingAt(headings, line)
  })

  let outline = $state<HTMLElement>()

  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)
  let dragging = $state<number | null>(null)

  function startSection(event: DragEvent, at: number) {
    carrySection(event.dataTransfer, at)
    dragging = at
  }

  function endSection() {
    dropAt = null
    dragging = null
  }

  function overSection(event: DragEvent, at: number) {
    if (!isSectionDrag(event.dataTransfer)) return
    if (dragging !== null && !movesSection(workspace.headings, dragging, at)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    dropAt = at
    dropAbove = dragging !== null && dragging > at
  }

  function dropSection(event: DragEvent, at: number) {
    event.preventDefault()

    const from = draggedSection(event.dataTransfer)
    endSection()
    if (from !== null) onmovesection?.(from, at)
  }

  function headingMenu(at: number, text: string): MenuEntry[] {
    return [
      ...bookmarkEntry(workspace.bookmarks.forHeading(workspace.panelNote, text)),
      ...moveSectionEntries(at),
    ]
  }

  function moveSectionEntries(at: number): MenuEntry[] {
    if (!viewport.touch) return []

    const targets = workspace.headings
      .map((heading, index) => ({ id: String(index), label: heading.text, index }))
      .filter((one) => movesSection(workspace.headings, at, one.index))
    if (!targets.length) return []

    return [
      {
        label: t('Move'),
        run: () => {
          void (async () => {
            const { prompt } = await import('./prompt.svelte')
            const to = await prompt.find({
              title: t('Move after'),
              options: targets.map((one) => ({ id: one.id, label: one.label })),
              placeholder: t('Heading'),
            })
            if (to !== null) onmovesection?.(at, Number(to))
          })()
        },
      },
    ]
  }

  $effect(() => {
    const list = outline
    if (!list || current < 0) return
    list.querySelector('.row.is-on')?.scrollIntoView({ block: 'nearest' })
  })

  const place = $derived(
    workspace.shownSpaces.findIndex((one) => one.id === workspace.activeSpaceId),
  )
  let direction = $state(1)
  let lastPlace = -1

  $effect.pre(() => {
    direction = place >= lastPlace ? 1 : -1
    lastPlace = place
  })

  let stack = $state<HTMLElement>()

  let arrived = untrack(() => workspace.activeSpaceId)

  $effect(() => {
    const id = workspace.activeSpaceId
    if (id === arrived) return
    arrived = id

    untrack(() => stack)?.animate(
      [
        { transform: `translateY(${16 * untrack(() => direction)}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: dur(220), easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)' },
    )
  })

  const size = new SidebarWidth(() => side)
  let aside = $state<HTMLElement>()
  let asideWidth = $state(0)

  $effect(() => () => size.release())

  function onEdgeKey(event: KeyboardEvent) {
    if (viewport.touch) return
    if (size.step(event.key, aside)) event.preventDefault()
  }
</script>

<div
  bind:this={column}
  class="column"
  class:right={side === 'right'}
  class:shut
  class:floating
  class:peek
  class:moving
  class:resizing={size.dragging}
  ontransitionend={slid}
  ontransitioncancel={slid}
  inert={shut && !peek && !viewport.drawer}
  style:--panel-width={size.pixels !== null && !viewport.touch ? `${size.pixels}px` : undefined}
>
  <aside
    bind:this={aside}
    bind:clientWidth={asideWidth}
    data-region={side === 'right' ? 'right' : undefined}
    data-sidebar
    aria-label={side === 'right'
      ? t('Right sidebar')
      : t('{space} panel', { space: workspace.activeSpace?.name ?? t('Space') })}
    class:resizing={size.dragging}
    class:right={side === 'right'}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="edge"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Panel width')}
      aria-valuemin={size.narrowest}
      aria-valuemax={size.widest}
      aria-valuenow={Math.round(size.pixels ?? asideWidth) || size.narrowest}
      tabindex="0"
      title={t('Drag to resize')}
      onpointerdown={(event) => size.start(event, aside)}
      ondblclick={() => size.reset()}
      onkeydown={onEdgeKey}
    ></div>

    {#if side === 'left'}
      <div class="head" data-region="space">
        {#if viewport.drawer || (!viewport.touch && sideToggles.inside)}
          <SidebarToggle unseen={swipeOpens()} />
        {/if}

        <SpaceSwitcher />
        {#if phoneTabs}
          {#await phoneYou() then PhoneYou}
            <PhoneYou />
          {/await}
        {/if}
      </div>
    {/if}

    <div class="switch" bind:clientWidth={rowWidth}>
      {#if !phoneTabs}
        <div
          bind:this={tablist}
          class="nib-segmented panels"
          data-region={side === 'left' ? 'panels' : undefined}
          use:roving={{
            across: true,
            rows: '[role=tab]',
            current: '[aria-selected=true]',
            wrap: true,
            follow: (tab) => {
              if (!tab.classList.contains('behind')) tab.click()
            },
          }}
          role="tablist"
          aria-label={t('Panels')}
          use:segmented
        >
          {#each strip.drawn as item (item.id)}
            <button
              class:on={showing === item.id}
              data-tab={item.id}
              role="tab"
              title={shortcuts.tooltip(item.label, commandOf(item.id))}
              aria-label={item.id === 'ask' && chatsUnread.any
                ? t('{title}, unread', { title: item.label })
                : item.label}
              aria-selected={showing === item.id}
              onclick={(event) => {
                if (event.detail > 1) return
                firstPress = item.id
                choose(item.id)
              }}
              ondblclick={() => {
                const id = firstPress ?? item.id
                void import('./panel-tab').then(({ openAsTab }) => openAsTab(id))
              }}
              oncontextmenu={(event) => {
                if (item.id !== 'scratchpad') showTabMenu(event, item.id, item.label)
              }}
              use:longPress={(event) => {
                if (item.id !== 'scratchpad') showTabMenu(event, item.id, item.label)
              }}
            >
              <svg viewBox="0 0 13 13"><path d={item.path} /></svg>
              {#if item.id === 'ask' && agentMarks.waiting}
                <span class="waiting" transition:fade={{ duration: dur(140) }}>
                  {agentMarks.waiting}
                </span>
              {/if}
              {#if item.id === 'ask' && chatsUnread.any}
                <UnreadDot corner />
              {/if}
            </button>
          {/each}
          {#if strip.behind.length}
            <button
              class="behind"
              role="tab"
              aria-selected="false"
              aria-haspopup="menu"
              title={t('More')}
              aria-label={t('More')}
              onclick={showBehind}
            >
              <svg viewBox="0 0 13 13"><path d={MORE_MARK} /></svg>
            </button>
          {/if}
        </div>
      {/if}

      {#if !__EVEN_PLUGIN__ && side === 'left' && startup.settled}
        {#await import('./HintCard.svelte') then card}
          <card.default
            hint="graph"
            side="below"
            text={t('See how your notes connect.')}
            when={worthAGraph(links.graph)}
            onpress={() => workspace.openGraph()}
          />
        {/await}
      {/if}

      {#if !__EVEN_PLUGIN__ && side === 'left' && paletteKey && startup.settled}
        {#await import('./HintCard.svelte') then card}
          <card.default
            hint="palette"
            side="below"
            text={t('Press {key} to find anything, notes and commands alike.', {
              key: paletteKey,
            })}
            when={!viewport.touch}
          />
        {/await}
      {/if}

      <div class="tools" bind:clientWidth={toolsWidth}>
        {#if holdable || showing === 'links'}
          {#if holdable}
            <button
              class="nib-glyph tool"
              class:active={held}
              title={held ? t('Follow the open note') : t('Stay on this note')}
              aria-label={held ? t('Follow the open note') : t('Stay on this note')}
              aria-pressed={held}
              onclick={() => workspace.holdPanel(held ? null : (workspace.panelTab?.id ?? null))}
            >
              <svg viewBox="0 0 13 13"><path d={HOLD_MARK} /></svg>
            </button>
          {/if}
          {#if showing === 'links'}
            {#if graphing}
              <button
                class="nib-glyph depth"
                title={t('Depth')}
                aria-label={t('Depth')}
                onclick={() =>
                  workspace.graphSettings.set({
                    depth: depth >= DEEPEST ? SHALLOWEST : depth + 1,
                  })}
                transition:fly={{ x: 10, duration: dur(130), easing: cubicOut }}
              >
                {depth}
              </button>
            {/if}
            <button
              class="nib-glyph tool"
              class:active={graphing}
              title={t('Graph')}
              aria-label={t('Graph')}
              aria-pressed={graphing}
              onclick={() => (graphing = !graphing)}
            >
              <svg viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
            </button>
          {/if}
        {/if}
        {#if showing === 'tree' && listing}
          {#if workspace.unfolded}
            <button
              class="nib-glyph tool"
              title={shortcuts.tooltip(t('Collapse the file list'), 'app.fold-list')}
              aria-label={t('Collapse the file list')}
              onclick={() => workspace.foldList()}
              transition:fly={{ x: 10, duration: dur(130), easing: cubicOut }}
            >
              <svg viewBox="0 0 13 13"><path d={FOLD_MARK} /></svg>
            </button>
          {/if}
          <button
            class="nib-glyph tool"
            title={t('Order of the files')}
            aria-label={t('Order of the files')}
            aria-haspopup="menu"
            onclick={showOrder}
          >
            <svg viewBox="0 0 13 13"><path d={ORDER_MARK} /></svg>
          </button>
        {/if}
        {#if showing === 'search'}
          <button
            class="nib-glyph tool"
            title={t('Sort')}
            aria-label={t('Sort')}
            aria-haspopup="menu"
            onclick={(event) => showTabMenu(event, 'search', t('Search'))}
          >
            <svg viewBox="0 0 13 13"><path d={ORDER_MARK} /></svg>
          </button>
        {/if}
        {#if showing === 'ask'}
          <button
            class="nib-glyph tool fresh"
            title={t('New chat')}
            aria-label={t('New chat')}
            onclick={() => {
              if (!__EVEN_PLUGIN__)
                void import('./ai/sidebar/chat.svelte').then((one) => one.chat.newThread())
            }}
          >
            <svg viewBox="0 0 13 13"><path d={FRESH_MARK} /></svg>
          </button>
          <button
            class="nib-glyph tool"
            title={shortcuts.tooltip(t('Chats'), 'app.ask')}
            aria-label={t('Chats')}
            onclick={() => {
              if (!__EVEN_PLUGIN__)
                void import('./ai/sidebar/chat.svelte').then((one) => one.chat.showThreads())
            }}
          >
            <svg viewBox="0 0 13 13"><path d={THREADS_MARK} /></svg>
          </button>
        {/if}
        {#if side === 'right' && !viewport.touch && sideToggles.inside}
          <SidebarToggle side="right" />
        {/if}
      </div>
    </div>

    <div class="stack" bind:this={stack}>
      {#key showing}
        <div
          class="body"
          data-region={side === 'left' ? 'list' : undefined}
          data-panel={showing}
          use:scrollbar={showing}
          use:pullable
          in:arrive
          out:leave
        >
          {#if held && holdable}
            <p class="holding">{workspace.panelTab?.shown ?? ''}</p>
          {/if}

          {#if showing === 'tree'}
            {#if listing}
              <Bookmarks onsearch={runBookmarked} />

              <p class="nib-section">{t('Files')}</p>

              <Tree tree={listing} />

              {#if !workspace.files.length && !arriving.coming.size && hiddenKinds.offers('note') && canWriteAt(workspace.activeSpace?.root ?? '')}
                <button class="empty" onclick={() => workspace.createNote()}>{t('New note')}</button
                >
              {/if}

              {#if !__EVEN_PLUGIN__ && workspace.archive.any}
                {#await archiveSection() then Archive}
                  <Archive />
                {/await}
              {/if}

              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
              <div
                class="rest"
                data-space-rest
                class:dropping={rootDrop}
                oncontextmenu={showSpaceMenu}
                onclick={() => workspace.cancelNaming()}
                use:dropOver={overRoot}
                ondragleave={() => dropTarget.clear()}
                ondrop={dropOnRoot}
              ></div>
            {:else}
              <button class="empty" onclick={() => newSpace()}>{t('Create a space')}</button>
            {/if}
          {:else if showing === 'outline'}
            {#if pages.current}
              {#await pagesNavigator() then PagesNavigator}
                <PagesNavigator />
              {/await}
            {:else if workspace.headings.length}
              <ul
                bind:this={outline}
                use:roving={{
                  current: '.is-on',
                  open: (row) => jump(Number(row.dataset.line ?? 0)),
                  peek: (row) => {
                    jump(Number(row.dataset.line ?? 0))
                    row.focus()
                  },
                  menu: (row, at) => row.dispatchEvent(at),
                }}
              >
                {#each workspace.headings as heading, index (index)}
                  <li>
                    <button
                      class="nib-row is-short row heading"
                      class:is-on={index === current}
                      class:above={dropAt === index && dropAbove}
                      class:below={dropAt === index && !dropAbove}
                      data-line={heading.line}
                      style:--level={heading.level - shallowest}
                      draggable="true"
                      onclick={() => jump(heading.line)}
                      oncontextmenu={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      use:longPress={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      ondragstart={(event) => startSection(event, index)}
                      use:dropOver={(event) => overSection(event, index)}
                      ondragleave={() => (dropAt = null)}
                      ondragend={endSection}
                      ondrop={(event) => dropSection(event, index)}
                    >
                      <span class="nib-row-label">{heading.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if contents.length}
              <ul use:roving={{ rows: '.row', open: (row) => row.click() }}>
                {#each contents as part, index (index)}
                  <li>
                    <button
                      class="nib-row is-short row heading"
                      style:--level={part.level}
                      onclick={() => toPage(part.page)}
                    >
                      <span class="nib-row-label">{part.title}</span>
                      <span class="nib-row-meta">{part.page}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if workspace.footnotes.length}
              <p class="nib-section">{t('Footnotes')}<span>{workspace.footnotes.length}</span></p>
              <ul>
                {#each workspace.footnotes as note (note.id)}
                  <li>
                    <button
                      class="nib-row is-short row note"
                      class:is-quiet={!note.used}
                      onclick={() => jump(note.line)}
                    >
                      <span class="nib-row-mark note-id">{note.id}</span>
                      <span class="nib-row-label">{note.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if showing === 'tasks'}
            {#await tasksPanel() then TasksPanel}
              <TasksPanel {side} />
            {/await}
          {:else if showing === 'chats'}
            {#await chatsPanel() then ChatsPanel}
              <ChatsPanel />
            {/await}
          {:else if showing === 'ask'}
            {#await askPanel() then AskPanel}
              <AskPanel {ongoto} />
            {/await}
          {:else if showing === 'links'}
            {#await linksPanel() then Links}
              <Links {ongoto} graph={graphing} {depth} onlist={() => (graphing = false)} />
            {/await}
          {:else if showing === 'scratchpad'}
            {#await scratchpadCard() then Card}
              <Card docked />
            {/await}
          {:else if showing === 'search'}
            {#await searchPanel() then SearchPanel}
              <SearchPanel {ongoto} />
            {/await}
          {/if}
        </div>
      {/key}
    </div>

    {#if side === 'left' && !phoneTabs}
      <SidebarFoot />
    {/if}
    {#if phoneTabs}
      {#await phoneTabsBar() then PhoneTabs}
        <PhoneTabs />
      {/await}
    {/if}
  </aside>
</div>

<style>
  .column {
    flex: none;
    display: flex;
    min-height: 0;
    width: var(--panel-width, var(--sidebar-width));
    transition:
      width var(--dur-base) var(--ease-out),
      visibility 0s;
  }

  .column.right {
    justify-content: flex-end;
  }

  .column.shut {
    width: 0;
    visibility: hidden;
    transition:
      width var(--dur-base) var(--ease-out),
      visibility 0s var(--dur-base);
  }

  :global(:root:not([data-touch], [data-drawer])) .column.shut:not(.moving, .right, .peek) aside {
    transform: translateX(calc(var(--dir) * (-100% - var(--card-inset) - var(--space-6))));
  }

  :global(:root:not([data-touch], [data-drawer])) .column.right.shut:not(.moving, .peek) aside {
    transform: translateX(calc(var(--dir) * (100% + var(--card-inset) + var(--space-6))));
  }

  .column.shut.floating {
    position: relative;
    visibility: visible;
    overflow: visible;
    transition: none;
  }

  .column.shut.floating aside {
    position: absolute;
    inset-block: var(--card-inset);
    inset-inline-start: var(--card-inset);
    z-index: var(--z-drawer);
    border: 0;
    border-radius: var(--card-radius);
    background:
      linear-gradient(var(--side-ground), var(--side-ground)),
      linear-gradient(var(--chrome-ground), var(--chrome-ground)), var(--bg);
    box-shadow:
      var(--card-shadow),
      0 0 0 1px var(--card-edge),
      var(--shadow-lg);
    transition: transform var(--dur-fast) var(--ease-out) -16ms;
  }

  .column.right.shut.floating aside {
    inset-inline: auto var(--card-inset);
  }

  .column.shut.floating.peek aside {
    transform: none;
  }

  .column.moving,
  .column.shut {
    overflow: clip;
  }

  .column.resizing {
    transition: none;
  }

  :global([data-touch]) .column {
    display: contents;
  }

  :global([data-touch]:not([data-drawer])) .column.shut aside {
    display: none;
  }

  aside {
    position: relative;
    width: var(--panel-width, var(--sidebar-width));
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-inline-end: 1px solid var(--chrome-seam);
    background: var(--side-ground, var(--side-bar-bg-color));
  }

  aside.right {
    border-inline-end: 0;
    border-inline-start: 1px solid var(--chrome-seam);
  }

  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-end: -4px;
    width: 8px;
    z-index: var(--z-lifted);
    cursor: col-resize;
  }

  aside.right .edge {
    inset-inline-end: auto;
    inset-inline-start: -4px;
  }

  aside.right .edge::after {
    inset-inline-start: auto;
    inset-inline-end: 3px;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: 3px;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  aside.resizing .edge::after {
    background: var(--accent);
  }

  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
  }

  :global([data-lights]:not([dir='rtl'])) .head {
    padding-inline-start: var(--traffic-lights);
  }

  .switch {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1) var(--space-2);
  }

  aside.right .switch {
    padding-top: var(--space-2);
  }

  :global([data-drawer]) aside.right .switch {
    padding-top: calc(var(--space-2) + var(--inset-top));
  }

  .switch .nib-segmented {
    flex: 0 1 auto;
    min-width: 0;
  }

  .panels button {
    padding: 0 var(--space-2);
  }

  .switch .nib-segmented button {
    min-width: 0;
  }

  :global([data-touch]) .switch .nib-segmented button {
    min-width: var(--touch-target);
  }

  .switch .nib-segmented button svg {
    flex: none;
  }

  .waiting {
    position: absolute;
    top: 1px;
    inset-inline-end: 1px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: var(--weight-strong);
    line-height: 13px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .tools {
    flex: none;
    margin-inline-start: auto;
  }

  .holding {
    margin: 0;
    padding: 0 var(--row-pad) var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  .tools button {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .tools button.active {
    background: var(--surface-selected);
    color: var(--accent);
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  .stack {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .body {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-1) var(--space-4);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .heading {
    position: relative;
    padding-inline-start: calc(var(--row-pad) + var(--level) * var(--row-indent));
    opacity: calc(1 - var(--level) * 0.09);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .note-id {
    align-self: start;
    margin-top: 0.3em;
    color: var(--accent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .heading.above::before,
  .heading.below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .heading.above::before {
    top: -1px;
  }

  .heading.below::after {
    bottom: -1px;
  }

  .heading.is-on {
    opacity: 1;
  }

  @media (hover: hover) {
    .heading:hover {
      transform: translateX(calc(var(--dir) * 2px));
    }
  }

  .rest {
    flex: 1;
    min-height: var(--space-6);
  }

  .rest.dropping {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
  }

  .empty {
    width: 100%;
    min-height: var(--row-height);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      border-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .empty:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty:active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .switch svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }

  :global([data-drawer]) aside {
    width: min(78vw, 20rem);
  }

  :global([data-touch]) .edge {
    display: none;
  }

  :global([data-drawer][data-narrow]) aside {
    flex: 1;
    width: auto;
    min-width: 0;
    background: var(--bg);
  }

  :global([data-touch]:not([data-drawer])) aside {
    width: 20rem;
    animation: dock var(--dur-base) var(--ease-out);
  }

  @keyframes dock {
    from {
      opacity: 0;
      transform: translateX(calc(var(--dir) * -12px));
    }
  }

  :global([data-touch]) .head {
    padding-top: var(--inset-top);
  }

  :global([data-touch]) .body {
    padding-bottom: var(--space-4);
  }

  .body[data-panel='ask'] {
    overflow: hidden;
    padding: 0;
  }

  aside:has(:global(.ask.is-empty)) .fresh {
    display: none;
  }

  :global([data-touch]) .empty {
    font-size: var(--touch-text);
  }
</style>
