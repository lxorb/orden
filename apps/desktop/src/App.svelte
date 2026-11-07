<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { t } from './lib/i18n.svelte'
  import { scanHeadings } from './lib/outline'
  import { moveSection } from './lib/sections'
  import { pageHeight, scrollerOf, showField, viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import { keyboardStays, takesCaret } from './lib/caret'
  import { EditorView, landed, setVimCommands, showLine, topLine } from '@orden/editor'
  import { iconChoice } from './lib/icon-choice.svelte'
  import { currentPlatform } from './lib/keys'
  import { menu, textFieldOf } from './lib/menu.svelte'
  import { overlays } from './lib/overlays'
  import PaneTree from './lib/PaneTree.svelte'
  import FirstScreen from './lib/FirstScreen.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import { present } from './lib/slides/present.svelte'
  import SizeBadge from './lib/SizeBadge.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import { watchTextSize } from './lib/text-size'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { renamed } from './lib/renamed.svelte'
  import { account } from './lib/account.svelte'
  import { joining } from './lib/joining.svelte'
  import { arriving } from './lib/arriving.svelte'
  import { busy } from './lib/busy.svelte'
  import FirstSync from './lib/FirstSync.svelte'
  import Progress from './lib/Progress.svelte'
  import { drawer, rightDrawer } from './lib/drawer.svelte'
  import { swipeOpens } from './lib/swipe-opens'
  import { escapeLeaves, fullscreen } from './lib/fullscreen.svelte'
  import { alone } from './lib/alone.svelte'
  import { chrome } from './lib/glass/chrome.svelte'
  import { paintCodePalette } from './lib/highlight'
  import { linkScroll, type ScrollEnd } from './lib/linked-scroll'
  import { recovery } from './lib/recovery.svelte'
  import { reloading } from './lib/reloading.svelte'
  import { hasStatusBar } from './lib/regions'
  import { pages } from './lib/pages/showing.svelte'
  import { inRooms, rooms } from './lib/rooms.svelte'
  import { said } from './lib/said.svelte'
  import { search } from './lib/search.svelte'
  import { prompt } from './lib/prompt.svelte'
  import { hiddenKinds, settings } from './lib/settings.svelte'
  import {
    contextMenu,
    fillBar,
    formatBar as formatBarDoor,
    fullscreenWayOut,
    guestCorner,
    historySheet,
    iconPicker,
    joinSheet,
    feedbackSheet,
    importSheet,
    spacePickerDialog,
    tabOverview,
    tabOverviewLayer,
    hostPickerDialog,
    paletteDoor,
    paletteWords,
    promptSheet,
    publishSheet,
    quickAddSheet,
    quickSheet,
    recordingPill,
    renameNotice,
    joinPending,
    rewriteSheet,
    settingsSheet,
    shareSheet,
    signInSheet,
    slidesStage,
    firstSpaceDoor,
    menuBarDoor,
    undoToastNotice,
    keysMovedNotice,
    outsideNotice,
    crashAsk,
    crashAskDue,
    OUTSIDE,
  } from './lib/surfaces.svelte'
  import { canWriteIn, share, sharedWithYou } from './lib/sharing.svelte'
  import { start } from './lib/start'
  import { startup } from './lib/startup.svelte'
  import { sync } from './lib/sync.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import { paneCorners } from './lib/pane-corners.svelte'
  import Titlebar from './lib/Titlebar.svelte'
  import { modes } from './lib/modes.svelte'
  import { links } from './lib/link-index.svelte'
  import { updates } from './lib/updates.svelte'
  import { usage } from './lib/usage.svelte'
  import { invoke, isDesktop, isNative, platform } from './lib/tauri'
  import { storedText } from './lib/stored'
  import { theme } from './lib/theme.svelte'
  import { type ShownTab, views, viewShowing, WhenShown } from './lib/views.svelte'
  import { workspace } from './lib/workspace.svelte'
  import { sidebarKey, used } from './lib/workspace/undo.svelte'
  import { saveFront } from './lib/save-place/door'
  import PadColumn from './lib/scratchpad/PadColumn.svelte'
  import { shown as pad } from './lib/scratchpad/is.svelte'
  import { isDraft } from './lib/workspace/drafts'
  import { type TabKind, TAB_KINDS } from './lib/workspace/tab-kinds'
  import { shortcuts } from './lib/shortcuts.svelte'
  import { toolbar } from './lib/toolbar.svelte'
  import { pull } from './lib/pull.svelte'
  import PullMark from './lib/PullMark.svelte'
  import { type AppContext, runEntry } from './lib/shortcuts/registry'
  import { writeNew } from './lib/write-new'

  if (renamed.showing) void renameNotice.ask()
  if (isDesktop && !__EVEN_PLUGIN__) {
    setTimeout(() => {
      void import('./lib/ai/keys-moved.svelte')
        .then(({ keysMoved }) => keysMoved.check())
        .then((say) => (say ? keysMovedNotice.ask() : undefined))
    }, 3000)
  }

  if (isDesktop && !__EVEN_PLUGIN__ && storedText(OUTSIDE) !== null) void outsideNotice.ask()

  if (isDesktop && !__EVEN_PLUGIN__ && crashAskDue()) {
    void startup.turn('rooms').then(() => crashAsk.ask())
  }

  $effect(() => {
    if (!isDesktop || __EVEN_PLUGIN__ || !modes.coder || !account.accountToken) return
    let stop: (() => void) | null = null
    let gone = false
    void import('./lib/apps/host.svelte').then(({ hostApps }) => {
      if (!gone) stop = hostApps()
    })
    return () => {
      gone = true
      stop?.()
    }
  })

  const view = $derived(views.of(workspace.panes.focusedId))

  const padOver = $derived(viewport.touch && pad.on)

  const writingIn = $derived(padOver ? (pad.view ?? view) : view)

  const fabLabel = $derived(hiddenKinds.offers('note') ? t('New note') : t('New tab'))

  let keepsSystemMenu: typeof import('./lib/system-menu').keepsSystemMenu = () => false
  let macMenuKey: typeof import('./lib/system-menu').macMenuKey = () => false
  if (currentPlatform() === 'mac') {
    void import('./lib/system-menu').then((one) => {
      keepsSystemMenu = one.keepsSystemMenu
      macMenuKey = one.macMenuKey
    })
  }
  const presenting = $derived(workspace.tabs.find((tab) => tab.id === present.tabId) ?? null)
  const canWriteHere = $derived(canWriteIn(workspace.active?.note))
  const filled = $derived(workspace.panes.fills !== null)
  const bare = $derived(fullscreen.on || alone.on)
  const flush = $derived(bare || filled)
  const built = { left: false, right: false }
  const keptLeft = $derived((built.left ||= workspace.panel !== null || startup.reached('left')))
  const padDocked = $derived(!viewport.touch && !__EVEN_PLUGIN__)
  const rightOpen = $derived(
    padDocked ? workspace.rightShows !== null : workspace.openOn('right') !== null,
  )
  const docked = $derived(
    viewport.drawer || bare || filled
      ? 0
      : (workspace.panel !== null ? 1 : 0) + (rightOpen ? 1 : 0),
  )
  const keptRight = $derived(
    (built.right ||=
      workspace.rightPanel !== null ||
      (padDocked && pad.on) ||
      (startup.reached('right') && (workspace.nextRight !== null || padDocked))),
  )
  const NOTICE_ROOM = 360
  let panesWide = $state(0)
  const noticesOver = $derived(viewport.drawer || (panesWide > 0 && panesWide < NOTICE_ROOM))
  let palette = $state(false)
  let paletteScreen = $state<{ showCommands(): void; dismiss(): void }>()
  let formatBar = $state<{ follow(view: EditorView): void }>()
  let middle = $state<HTMLElement>()

  $effect(() => {
    if (settings.open) void settingsSheet.ask()
    if (settings.historyOpen) void historySheet.ask()
    if (share.open) void shareSheet.ask()
    if (iconChoice.target) void iconPicker.ask()
    if (menu.open) void contextMenu.ask()
    if (account.open) void signInSheet.ask()
    if (joining.step) void joinSheet.ask()
    if (joining.aside) void joinPending.ask()
    if (viewport.touch && viewport.typing) void formatBarDoor.ask()
  })

  onDestroy(start())

  setVimCommands({
    write: saveFront,
    quit: () => void workspace.closeActive(),
    edit: () => {
      palette = true
    },
  })

  const onMac = platform() === 'macos'

  $effect(() => {
    const active = workspace.active
    const facts = active && { shown: active.shown, path: active.path, draft: isDraft(active.note) }
    void import('./lib/window-document').then(({ windowDocument }) => {
      const inWindow = windowDocument(facts, onMac)
      document.title = inWindow.title
      if (isDesktop) void invoke('show_document', { ...inWindow }).catch(() => undefined)
    })
  })

  $effect(() => {
    const token = account.accountToken
    if (token) {
      void modes.adopt(token).then((remote) => {
        if (!remote) return

        shortcuts.receive(remote)
        toolbar.receive(remote)
        pull.receive(remote)
        void import('./lib/kind-choice').then((one) => one.receive(remote))
        recovery.receive(remote)
        void import('./lib/space-archive').then((one) => one.receive(remote))
        if (!__EVEN_PLUGIN__)
          void import('./lib/chats/hush.svelte').then(({ hush }) => hush.receive(remote))
      })
    }
  })

  async function followWhenLanded(current: EditorView) {
    await formatBarDoor.ask()
    await tick()
    formatBar?.follow(current)
  }

  $effect(() => {
    views.onSelection = (current: EditorView) => {
      if (formatBar) formatBar.follow(current)
      else if (!current.state.selection.main.empty) void followWhenLanded(current)
    }
    return () => {
      views.onSelection = null
    }
  })

  $effect(() => {
    if (__EVEN_PLUGIN__ || !workspace.restored || workspace.spaces.length) return
    const now = {
      native: isNative,
      plugin: false,
      restored: true,
      spaces: 0,
      restoring: account.restoring,
      signedIn: account.signedIn,
      invited: joining.invitation !== null || joining.step !== null,
      tabs: workspace.tabs.length,
    }
    void firstSpaceDoor().then(({ firstSpace }) => firstSpace.start(now))
  })

  $effect(() => watchTextSize())

  $effect(() => {
    pull.runs = () => void runEntry(pull.id, appContext())
    return () => {
      pull.runs = null
    }
  })

  $effect(() => workspace.oneDocument())

  $effect(() => {
    const who = account.user?.id
    if (!who) return

    for (const space of workspace.spaces) {
      const id = sync.remoteIdFor(space.root)
      const remote = id === null ? undefined : account.spaces.find((one) => one.id === id)
      if (!remote) continue

      workspace.folderIcons.adopt(space.root, remote.icons, remote.tints, who)
      void workspace.arranged.adopt(space.root, remote.arranged, who)
      workspace.graphSettings.adopt(space.root, remote.graph, who)
      workspace.sorting.adopt(space.root, remote.sort, who)
      workspace.excluded.adopt(space.root, remote.excluded, who)
      void workspace.archive.adopt(space.root, remote.archived, who)
    }
  })

  $effect(() => {
    const [height, panned] = [viewport.height, viewport.panned]
    if (!viewport.typing || !height || panned < 0) return

    const field = document.activeElement
    if (field instanceof HTMLElement && field !== view?.contentDOM) {
      const scroller = view?.contentDOM.contains(field) ? view.scrollDOM : scrollerOf(field)
      if (scroller) showField(field, scroller, height - viewport.covered)
      return
    }
    if (!view) return

    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, {
        y: 'nearest',
        yMargin: 24,
      }),
    })
  })

  $effect(() => {
    if (present.on && !presenting) present.stop()
  })

  $effect(() => paintCodePalette(modes.codeTheme))

  $effect(() => {
    const panes = workspace.panes.all.filter((pane) => pane.linked)
    const stops = pairs(panes.map((pane) => pane.id))
      .filter(([one, other]) => workspace.twins(one).includes(other))
      .flatMap(([one, other]) => {
        const first = views.of(one)
        const second = views.of(other)
        return first && second ? [linkScroll(scrollEnd(first), scrollEnd(second))] : []
      })

    return () => {
      for (const stop of stops) stop()
    }
  })

  $effect(() =>
    viewport.drawer && workspace.panel ? overlays.show(() => workspace.closePanel()) : undefined,
  )

  $effect(() =>
    viewport.drawer && rightOpen ? overlays.show(() => workspace.closeRight()) : undefined,
  )

  const covered = $derived(!!workspace.panel)
  const coveredRight = $derived(rightOpen)

  $effect(() => closeOnBack(covered, () => workspace.closePanel()))
  $effect(() => closeOnBack(coveredRight, () => workspace.closeRight()))
  $effect(() =>
    closeOnBack(palette, () => {
      palette = false
    }),
  )
  $effect(() => {
    if (palette) void paletteDoor.ask()
  })
  $effect(() => {
    if (paletteWords.words !== null) palette = true
  })
  $effect(() => {
    if (prompt.open) void promptSheet.ask()
  })
  $effect(() => closeOnBack(menu.open, () => menu.hide()))

  $effect(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))

  $effect(() => fullscreen.follow())

  $effect(() => {
    const host = middle
    if (!host || !swipeOpens()) return

    let stop: (() => void) | null = null
    let live = true
    void import('./lib/drawer-follow').then((one) => {
      if (live) stop = one.followDrawers(host)
    })

    return () => {
      live = false
      stop?.()
    }
  })

  const syncing = $derived(
    account.syncable ? `${account.user?.id ?? ''}:${account.user?.syncVersion === 2}` : null,
  )
  $effect(() => {
    if (syncing !== null) {
      untrack(() => {
        sync.start()
        if (account.user) void usage.refresh()
      })
    } else {
      untrack(() => {
        sync.stop()
        rooms.clear()
      })
    }
  })

  $effect(() => rooms.rename(account.name ?? undefined))

  $effect(() => {
    const open = account.syncable && startup.reached('rooms') ? workspace.openNotes : []
    rooms.follow(inRooms(open, sync.version === 1 ? (path) => sync.tracked(path) : null))
  })

  $effect(() => {
    rooms.repaint(theme.current)
  })

  if (__DRIVEABLE__) {
    Object.assign(window, {
      ordenApp: {
        account,
        arriving,
        busy,
        fullscreen,
        iconChoice,
        overlays,
        present,
        pages,
        rooms,
        share,
        sharedWithYou,
        sync,
        updates,
        prompt,
        workspace,
        search,
        settings,
        modes,
        shortcuts,
        theme,
        toolbar,
        pull,
        viewport,
        links,
        views,
      },
    })
    Object.assign(window, { nibApp: (window as unknown as { ordenApp: object }).ordenApp })

    void Promise.all([
      import('./lib/importing.svelte'),
      import('./lib/publishing.svelte'),
      import('./lib/ai/store.svelte'),
      import('./lib/ai/rewriting.svelte'),
      import('./lib/sync2/fake-engine.svelte'),
      import('./lib/agents/settings/fake'),
      import('./lib/wallpaper/wallpaper.svelte'),
      import('./lib/themes/store.svelte'),
    ]).then(
      ([
        { importing },
        { publish },
        { ai },
        { rewriting },
        sync2,
        { standIn },
        { wallpaper },
        { store },
      ]) => {
        Object.assign((window as unknown as { ordenApp: object }).ordenApp, {
          tasks: () =>
            Promise.all([
              import('./lib/rows/rows.svelte'),
              import('./lib/views/open'),
              import('./lib/workspace/write-file'),
              import('./lib/rows/todo-lists'),
            ]).then(([{ rows }, views, { writeFile }, { makeList }]) => ({
              rows,
              ...views,
              writeFile,
              makeList,
            })),
          chats: () =>
            __EVEN_PLUGIN__
              ? Promise.reject(new Error('no chats in the Even Realities plugin'))
              : Promise.all([
                  import('./lib/chats/store.svelte'),
                  import('./lib/chats/view/open'),
                ]).then(([{ chats }, open]) => ({ chats, ...open })),
          linked: () =>
            __EVEN_PLUGIN__
              ? Promise.reject(new Error('no chats in the Even Realities plugin'))
              : Promise.all([
                  import('./lib/chats/linked'),
                  import('./lib/chats/connected.svelte'),
                  import('./lib/chats/providers/host'),
                ]).then(([linked, { connected }, { host }]) => ({ ...linked, connected, host })),
          time: () =>
            __EVEN_PLUGIN__
              ? Promise.reject(new Error('no time tracker in the Even Realities plugin'))
              : import('./lib/time/time.svelte').then(({ time }) => time),
          agents: { standIn },
          ai,
          aiChats: () =>
            __EVEN_PLUGIN__
              ? Promise.reject(new Error('no AI panel in the Even Realities plugin'))
              : import('./lib/ai/sidebar/chat.svelte').then(({ chat }) => chat),
          aiVault: () =>
            __EVEN_PLUGIN__
              ? Promise.reject(new Error('no AI vault in the Even Realities plugin'))
              : Promise.all([import('./lib/ai/vault/start.svelte'), import('./lib/ai/keys')]).then(
                  ([{ vault }, keys]) => ({
                    vault,
                    writeKey: keys.writeKey,
                    readSecret: keys.readSecret,
                  }),
                ),
          importing,
          publish,
          rewriting,
          sync2,
          wallpaper,
          themeStore: store,
          downloads: () => import('./lib/web-tab/downloads.svelte').then((one) => one.downloads),
        })
      },
    )
  }

  const ownBar = (kind: TabKind | undefined) => kind !== undefined && TAB_KINDS[kind].ownBar

  $effect(() => {
    paneCorners.draw = corners
    return () => {
      paneCorners.draw = null
    }
  })

  function pairs(ids: string[]): [string, string][] {
    const out: [string, string][] = []
    for (const [at, one] of ids.entries()) {
      for (const other of ids.slice(at + 1)) out.push([one, other])
    }

    return out
  }

  function scrollEnd(current: EditorView): ScrollEnd {
    return {
      top: () => topLine(current),
      show: (position: number) => showLine(current, position),
      onScroll: (run: () => void) => {
        current.scrollDOM.addEventListener('scroll', run, { passive: true })
        return () => current.scrollDOM.removeEventListener('scroll', run)
      },
    }
  }

  function onFieldMenu(event: MouseEvent) {
    const field = viewport.touch ? null : textFieldOf(event.target)
    if (!field) return

    event.preventDefault()
    event.stopPropagation()
    if (!__EVEN_PLUGIN__) {
      void import('./lib/field-menu').then((one) => one.showFieldMenu(event, field))
    }
  }

  function onMouse(event: MouseEvent) {
    if (event.button !== 3 && event.button !== 4) return

    event.preventDefault()
    if (event.button === 3) workspace.goBack()
    else workspace.goForward()
  }

  const shown = new WhenShown(
    (id) => workspace.tabs.find((tab) => tab.id === id),
    (paneId) => views.of(paneId),
  )

  let settling = $state(false)

  function onNote(tab: ShownTab, act: (on: EditorView) => void) {
    if (tab.id !== workspace.activeTabId) workspace.activate(tab.id)
    if (!shown.run(tab, act)) settling = true
  }

  function goto(line: number) {
    const tab = workspace.active
    if (tab && view && !viewShowing(tab, () => view)) {
      onNote(tab, (on) => land(on, line))
      return
    }

    if (view) land(view, line)
  }

  function land(on: EditorView, line: number) {
    if (viewport.drawer) workspace.closePanel()

    const target = on.state.doc.line(Math.min(line + 1, on.state.doc.lines))
    on.dispatch({
      selection: { anchor: target.from },
      effects: [
        EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 72 }),
        landed.of(target.from),
      ],
    })
    on.focus()
  }

  function moveSectionTo(from: number, to: number) {
    const tab = workspace.panelTab
    if (!tab) return

    onNote(tab, (on) => {
      if (on.state.readOnly) return

      const text = on.state.doc.toString()
      const made = moveSection(text, scanHeadings(text), from, to, on.state.selection.main.head)
      if (!made) return

      on.dispatch({
        changes: made.changes,
        selection: { anchor: made.caret },
        scrollIntoView: true,
        userEvent: 'move.section',
      })
    })
  }

  $effect(() => {
    const asked = workspace.goto
    if (!asked || !view || workspace.active?.path !== asked.path || workspace.active.reading) return

    workspace.goto = null
    requestAnimationFrame(() => goto(asked.line))
  })

  $effect(() => {
    if (!settling) return

    settling = false
    requestAnimationFrame(() => shown.settle())
  })

  const showing = $derived(workspace.showing(workspace.panes.focusedId))

  $effect(() => {
    const current = view
    const reasons = [showing?.id, showing?.kind, showing?.reading, workspace.naming, palette]
    if (!current || !reasons.length) return

    const frame = requestAnimationFrame(() => {
      const may = takesCaret(showing ? { kind: showing.kind, reading: showing.reading } : null, {
        overlaid: overlays.depth > 0,
        renaming: workspace.naming !== null,
        presenting: present.on,
        touch: viewport.touch,
      })

      if (may && !keyboardStays()) current.focus()
    })

    return () => cancelAnimationFrame(frame)
  })

  function sidebarUndo(event: KeyboardEvent) {
    const own = sidebarKey(event, (id) => shortcuts.pressed(id, event))
    if (!own) return
    event.preventDefault()
    event.stopPropagation()
    void (own === 'undo' ? workspace.undoFileAction() : workspace.redoFileAction())
  }

  function onKeydown(event: KeyboardEvent) {
    if (macMenuKey(event)) return

    if (event.key === 'Escape' && overlays.escape(event)) return

    if (event.key === 'Escape' && fullscreen.on) {
      const holder = document.activeElement
      queueMicrotask(() => {
        if (escapeLeaves(event.defaultPrevented, holder)) void fullscreen.leave()
      })
      return
    }

    if (present.on && !shortcuts.pressed('app.present', event)) return

    if (!shortcuts.handle(event, appContext())) shortcuts.writeKey(event)
  }

  let untap: (() => void) | undefined
  void startup
    .turn('doors')
    .then(() => import('./lib/tapped').then(({ hear }) => (untap = hear(appContext))))
  onDestroy(() => untap?.())

  async function showCommands() {
    await paletteDoor.ask()
    await tick()
    paletteScreen?.showCommands()
  }

  function appContext(): AppContext {
    return {
      view: writingIn,
      palette: (mode, again) => {
        if (again && palette) paletteScreen?.dismiss()
        else if (mode === 'commands') void showCommands()
        else palette = true
      },
      fullscreen: () => void fullscreen.toggle(workspace.panes),
    }
  }
  if (!__EVEN_PLUGIN__ && isDesktop && platform() === 'macos') {
    void startup
      .turn('doors')
      .then(menuBarDoor)
      .then(({ followMenuBar }) =>
        followMenuBar(() => ({
          view,
          onpalette: () => (palette = true),
          onhistory: () => (settings.historyOpen = true),
          app: appContext(),
        })),
      )
  }

  $effect(() => {
    const status = sync.status
    if (status === 'syncing') said.say(t('Syncing'))
    else if (status === 'error') said.say(sync.lastError ?? t('Sync failed'))
    else if (status === 'offline') said.say(t('Offline'))
  })
</script>

<svelte:window
  onkeydown={onKeydown}
  onkeydowncapture={sidebarUndo}
  oncontextmenucapture={(event: MouseEvent) => {
    if (!event.isTrusted || !keepsSystemMenu(event.target, platform())) onFieldMenu(event)
  }}
  oncontextmenu={(event: MouseEvent) => {
    if (!keepsSystemMenu(event.target, platform())) event.preventDefault()
  }}
  onmousedown={onMouse}
  onpointerdowncapture={(event: PointerEvent) => {
    overlays.pressed(event)
    used(event.target)
  }}
  onclickcapture={(event: MouseEvent) => overlays.clicked(event)}
  onblur={() => overlays.away()}
  onpointermove={() => fullscreen.stir()}
  onpointerdown={() => fullscreen.stir()}
/>

<h1 class="orden-said">{workspace.active?.shown ?? 'Orden'}</h1>

<p class="orden-said" role="status" aria-live="polite">{said.words}</p>

<main
  class:focus={modes.focus}
  class:full={bare}
  class:flush
  class:tabbed={viewport.device === 'phone' && !!workspace.panel && !bare && !__EVEN_PLUGIN__}
  inert={workspace.nothingToShow}
  style:height={pageHeight()}
  style:--panel-room={docked
    ? `max(var(--panel-narrowest), (100vw - var(--panes-floor)) / ${docked})`
    : undefined}
>
  <div class="middle" bind:this={middle}>
    {#if !bare && !filled}
      <div
        class="panels"
        data-chrome="start"
        data-theme={chrome.theme}
        inert={viewport.drawer && !workspace.panel}
        class:open={!!workspace.panel}
        class:held={drawer.held}
        class:dragging={drawer.at !== null}
        class:settling={drawer.settle !== null}
        style:transform={drawer.at === null || viewport.narrow
          ? undefined
          : `translateX(calc(var(--dir) * ${drawer.at - drawer.width}px))`}
        style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
        ontransitionend={(event) => drawer.arrived(event)}
      >
        {#if keptLeft}
          <Sidebar ongoto={goto} onmovesection={moveSectionTo} />
        {/if}
      </div>
    {/if}

    <div
      class="document"
      inert={viewport.narrow && viewport.drawer && !!workspace.panel && !bare}
      class:open={!!workspace.panel}
      class:held={drawer.held}
      class:dragging={drawer.at !== null}
      class:settling={drawer.settle !== null}
      style:transform={drawer.at === null || !viewport.narrow
        ? undefined
        : `translateX(calc(var(--dir) * ${drawer.at}px))`}
      style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
      style:--shade={drawer.progress === null ? undefined : 1 - drawer.progress}
      ontransitionend={(event) => drawer.arrived(event)}
    >
      {#if (workspace.panel !== null || rightOpen) && !bare}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="scrim"
          class:over={rightOpen}
          class:held={drawer.held || rightDrawer.held}
          class:dragging={drawer.at !== null || rightDrawer.at !== null}
          style:opacity={drawer.progress ?? rightDrawer.progress ?? undefined}
          onclick={() => {
            workspace.closePanel()
            workspace.closeRight()
          }}
        ></div>
      {/if}

      {#if !bare}
        {#if filled}
          {#await fillBar() then FillBar}
            <FillBar>{@render bar()}</FillBar>
          {/await}
        {:else}
          {@render bar()}
        {/if}
      {/if}

      <div class="body">
        <div
          class="panes"
          data-panes
          class:under-pad={padOver}
          class:grounded={modes.flushBottom}
          inert={padOver}
          bind:clientWidth={panesWide}
        >
          <Progress />
          {#if !noticesOver}
            {@render notices()}
          {/if}
          <PaneTree frame={workspace.panes.frame} />
          {#if !__EVEN_PLUGIN__}
            <FirstScreen />
          {/if}
        </div>

        {#if !bare && !filled && !__EVEN_PLUGIN__ && viewport.touch}
          <PadColumn />
        {/if}

        {#if (workspace.right.length || padDocked) && !bare && !filled}
          <div
            class="panels right"
            data-chrome="end"
            data-theme={chrome.theme}
            inert={viewport.drawer && !rightOpen}
            class:open={rightOpen}
            class:held={rightDrawer.held}
            class:dragging={rightDrawer.at !== null}
            class:settling={rightDrawer.settle !== null}
            style:transform={rightDrawer.at === null
              ? undefined
              : `translateX(calc(var(--dir) * ${rightDrawer.width - rightDrawer.at}px))`}
            style:--settle={rightDrawer.settle === null ? undefined : `${rightDrawer.settle}ms`}
            ontransitionend={(event) => rightDrawer.arrived(event)}
          >
            {#if keptRight}
              <Sidebar side="right" ongoto={goto} onmovesection={moveSectionTo} />
            {/if}
          </div>
        {/if}
      </div>

      {#if fullscreen.on && workspace.active?.kind !== 'web'}
        {#await fullscreenWayOut() then WayOut}
          <WayOut />
        {/await}
      {:else if alone.on && account.guest}
        {#await guestCorner() then Corner}
          <Corner />
        {/await}
      {/if}
    </div>
  </div>

  {#if noticesOver}
    {@render notices()}
  {/if}
</main>

{#snippet corners()}
  {#if hasStatusBar(workspace.active?.kind) && !bare && !filled}
    <StatusBar
      doc={workspace.active?.doc ?? ''}
      reading={modes.readOnly || !canWriteHere}
      vimMode={modes.vimModeOf(view)}
    />
  {/if}

  {#if viewport.touch && !workspace.panel && !viewport.typing && !ownBar(workspace.active?.kind) && !bare}
    <button class="fab" aria-label={fabLabel} onclick={writeNew}>
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  {/if}
{/snippet}

{#snippet notices()}
  <div
    class="notices"
    data-notices
    data-region="notices"
    class:over={noticesOver}
    class:above={tabOverview.open}
  >
    <StorageWarning />
    {#if undoToastNotice.asked}
      {#await undoToastNotice.asked then UndoToast}
        <UndoToast />
      {/await}
    {/if}
    {#if recordingPill.asked}
      {#await recordingPill.asked then RecordingPill}
        <RecordingPill />
      {/await}
    {/if}
    {#if joining.aside && joinPending.asked}
      {#await joinPending.asked then JoinPending}
        <JoinPending />
      {/await}
    {/if}
    {#if keysMovedNotice.asked}
      {#await keysMovedNotice.asked then KeysMoved}
        <KeysMoved />
      {/await}
    {/if}
    {#if outsideNotice.asked}
      {#await outsideNotice.asked then OutsideFolder}
        <OutsideFolder />
      {/await}
    {/if}
    {#if renamed.showing && renameNotice.asked}
      {#await renameNotice.asked then RenameNotice}
        <RenameNotice />
      {/await}
    {/if}
    {#if !__EVEN_PLUGIN__ && settings.setup !== null}
      {#await import('./lib/Personalize.svelte') then Personalize}
        <Personalize.default />
      {/await}
    {/if}
    {#if updates.ready}
      <UpdateNotice
        version={updates.ready}
        managed={updates.managed}
        system={updates.system}
        channel={updates.channel}
        ondismiss={() => updates.dismiss()}
      />
    {/if}
    {#if reloading.offered}
      <div class="reload" role="alert">
        <button class="orden-button" onclick={() => location.reload()}>{t('Reload')}</button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet bar()}
  <Titlebar
    panes={panesWide}
    onpalette={() => {
      palette = true
    }}
  />
{/snippet}

{#if presenting}
  {#await slidesStage() then Slides}
    <Slides tab={presenting} />
  {/await}
{/if}

<PullMark />

<SizeBadge />

{#if paletteDoor.asked}
  {#await paletteDoor.asked then Palette}
    <Palette bind:this={paletteScreen} bind:open={palette} {view} ongoto={goto} />
  {/await}
{/if}
{#if quickAddSheet.asked}
  {#await quickAddSheet.asked then QuickAddSheet}
    <QuickAddSheet />
  {/await}
{/if}
{#if signInSheet.asked}
  {#await signInSheet.asked then SignIn}
    <SignIn />
  {/await}
{/if}
{#if joinSheet.asked}
  {#await joinSheet.asked then JoinSheet}
    <JoinSheet />
  {/await}
{/if}
{#if feedbackSheet.asked}
  {#await feedbackSheet.asked then FeedbackSheet}
    <FeedbackSheet />
  {/await}
{/if}
{#if settingsSheet.asked}
  {#await settingsSheet.asked then SettingsPanel}
    <SettingsPanel {view} />
  {/await}
{/if}
{#if formatBarDoor.asked}
  {#await formatBarDoor.asked then FormatBar}
    <FormatBar bind:this={formatBar} view={writingIn} context={appContext} />
  {/await}
{/if}
{#if historySheet.asked}
  {#await historySheet.asked then History}
    <History bind:open={settings.historyOpen} />
  {/await}
{/if}
{#if shareSheet.asked}
  {#await shareSheet.asked then ShareSheet}
    <ShareSheet />
  {/await}
{/if}
{#if publishSheet.asked}
  {#await publishSheet.asked then PublishSheet}
    <PublishSheet />
  {/await}
{/if}
{#if importSheet.asked}
  {#await importSheet.asked then ImportSheet}
    <ImportSheet />
  {/await}
{/if}
{#if rewriteSheet.asked}
  {#await rewriteSheet.asked then RewriteSheet}
    <RewriteSheet />
  {/await}
{/if}
{#if quickSheet.asked}
  {#await quickSheet.asked then QuickQuestion}
    <QuickQuestion />
  {/await}
{/if}
{#if crashAsk.asked}
  {#await crashAsk.asked then CrashAsk}
    <CrashAsk />
  {/await}
{/if}
{#if promptSheet.asked}
  {#await promptSheet.asked then PromptSheet}
    <PromptSheet />
  {/await}
{/if}
{#if spacePickerDialog.asked}
  {#await spacePickerDialog.asked then SpacePicker}
    <SpacePicker />
  {/await}
{/if}
{#if tabOverviewLayer.asked}
  {#await tabOverviewLayer.asked then Overview}
    <Overview />
  {/await}
{/if}
{#if hostPickerDialog.asked}
  {#await hostPickerDialog.asked then HostPicker}
    <HostPicker />
  {/await}
{/if}
{#if contextMenu.asked}
  {#await contextMenu.asked then ContextMenu}
    <ContextMenu />
  {/await}
{/if}
{#if iconPicker.asked}
  {#await iconPicker.asked then IconPicker}
    <IconPicker />
  {/await}
{/if}
<FirstSync />

<style>
  main {
    --leave-size: 30px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    background: var(--shell-ground);
    transition: background var(--dur-slow) var(--ease-out);
  }

  .middle {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--chrome-ground);
  }

  .panels {
    display: flex;
    min-height: 0;
  }

  .scrim {
    display: none;
  }

  .document {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .panes {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    padding: 0 var(--card-inset) var(--card-inset);
  }

  .panes.under-pad {
    visibility: hidden;
  }

  .panes.grounded {
    padding-bottom: 0;
  }

  .notices {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    z-index: var(--z-notice);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    gap: var(--space-2);
    pointer-events: none;
  }

  .notices > :global(*) {
    pointer-events: auto;
  }

  :global([data-touch]) .notices {
    grid-template-columns: 1fr;
  }

  .reload {
    grid-column: 2;
    justify-self: center;
  }

  :global([data-touch]) .reload {
    grid-column: 1;
  }

  .notices.over {
    position: fixed;
  }

  .notices.above {
    position: fixed;
    z-index: var(--z-sheet);
  }

  .notices:has(> :global(*)) {
    padding: var(--space-2) max(var(--space-4), var(--inset-end))
      calc(var(--space-3) + var(--inset-bottom)) max(var(--space-4), var(--inset-start));
  }

  main.tabbed .notices:has(> :global(*)) {
    padding-bottom: calc(var(--space-3) + var(--inset-bottom) + var(--touch-row));
  }

  main:has(:global(.fab)) .notices:has(> :global(*)) {
    padding-inline-end: calc(
      max(var(--space-4), var(--inset-end)) + var(--touch-row) + var(--space-2)
    );
  }

  main.full .panes {
    padding: var(--inset-top) var(--inset-right) var(--inset-bottom) var(--inset-left);
  }

  main.flush,
  :global([data-touch]) main {
    --card-radius: 0px;
    --card-inset: 0px;
    --card-gap: 1px;
    --card-edge: transparent;
    --card-shadow: none;
    --chrome-seam: var(--line);
  }

  :global([data-touch]) main {
    --leave-size: var(--touch-target);
  }

  .fab {
    position: absolute;
    inset-inline-end: max(var(--space-4), var(--inset-end));
    bottom: calc(var(--space-4) + var(--inset-bottom));
    z-index: var(--z-float);
    width: var(--touch-row);
    height: var(--touch-row);
    display: grid;
    place-items: center;
    border: none;
    border-radius: calc(var(--touch-row) * var(--radius-third));
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--shadow-lg);
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .fab:active {
    transform: scale(0.92);
  }

  .fab svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  :global([data-touch]) .panels {
    padding-inline-start: var(--inset-start);
  }

  :global([data-drawer]) .panels {
    position: fixed;
    inset-block: 0 var(--keyboard, 0px);
    inset-inline: 0 auto;
    z-index: var(--z-drawer);
    transform: translateX(calc(var(--dir) * -100%));
    transition: transform var(--dur-base) var(--ease-out);
    box-shadow: var(--shadow-lg);
    background:
      linear-gradient(var(--side-ground), var(--side-ground)),
      linear-gradient(var(--chrome-ground), var(--chrome-ground)), var(--bg);
  }

  :global([data-drawer]) .panels.open {
    transform: none;
  }

  :global([data-drawer]) .panels.held,
  :global([data-drawer]) .document.held {
    will-change: transform;
  }

  :global([data-drawer]) .scrim.held {
    will-change: opacity;
  }

  :global([data-drawer]) .panels.dragging,
  :global([data-drawer]) .scrim.dragging {
    transition: none;
    animation: none;
  }

  :global([data-drawer]) .panels.settling:not(.dragging) {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  :global([data-drawer]) .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-drawer) - 1);
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    animation: scrim-in var(--dur-fast) var(--ease-out);
  }

  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }

  :global([data-drawer]) .panels.right {
    inset-block: 0;
    inset-inline: auto 0;
    transform: translateX(calc(var(--dir) * 100%));
  }

  :global([data-drawer]) .panels.right.open {
    transform: none;
  }

  :global([data-drawer][data-narrow]) .panels.right {
    width: min(86%, 20rem);
    z-index: var(--z-drawer);
    box-shadow: var(--shadow-lg);
    transition: transform var(--dur-base) var(--ease-out);
    transform: translateX(calc(var(--dir) * 100%));
  }

  :global([data-drawer][data-narrow]) .panels.right.open {
    transform: none;
  }

  :global([data-drawer]) .panels.right.dragging {
    transition: none;
    animation: none;
  }

  :global([data-drawer]) .panels.right.settling:not(.dragging) {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  :global([data-drawer][data-narrow]) .panels {
    width: 100%;
    z-index: var(--z-raised);
    transform: none;
    box-shadow: none;
    transition: none;
  }

  :global([data-drawer][data-narrow]) .document {
    position: relative;
    z-index: var(--z-lifted);
    background: var(--bg);
    box-shadow: calc(var(--dir) * -16px) 0 40px rgb(0 0 0 / calc(0.3 * var(--shade)));
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
    --shade: 1;
  }

  :global([data-drawer][data-narrow]) .document.open {
    transform: translateX(calc(var(--dir) * 100%));
    --shade: 0;
  }

  :global([data-drawer][data-narrow]) .document.dragging {
    transition: none;
  }

  :global([data-drawer][data-narrow]) .document.settling:not(.dragging) {
    transition:
      transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  :global([data-drawer][data-narrow]) .scrim:not(.over) {
    display: none;
  }
</style>
