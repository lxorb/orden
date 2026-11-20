<script lang="ts">
  import { whenLoaded, settingsWindow } from '@orden/contracts'
  import { dropOver, Cross, overlays, menu, fullscreen, Door, keyElsewhere } from '../../ui-kit/src/api'
  import { onMount, untrack } from 'svelte'
  import { agentMarks, workspace, tabAsk, type TabAsk } from '../../workspace/src/api'
  import { dur, fade, invoke, isDesktop, openExternal } from '../../platform/src/api'
  import { chrome, landed } from '../../theme/src/api'
  import { startup } from '../../launch/src/api'
  import { hiddenKinds, passOn } from '../../gates/src/api'
  import { canShareItem, shareThisFile } from '../../sharing/src/api'
  import { shortcuts } from '../../shortcuts/src/api'
  import { swiping } from '../../back-swipe/src/api'
  import { findBar, passFill, takeoverBar } from '../../surfaces/src/api'
  import type { Tab } from '../../documents/src/api'
  import { favicon, plainOrigin } from '@orden/scan/web-address'
  import { HISTORY_MARK, isOwnPage } from '@orden/scan/own-pages'
  import { searchEngine } from './search-engine.svelte'
  import { unopened, webAddress } from '@orden/scan/typed'
  import { upgradeOf } from './upgrade'
  import type { ZoomStep } from './bar-keys'
  import { clipPage } from './clip'
  import { droppedOnPage, leftPage, overPage } from './carry-in'
  import { filling } from './filling.svelte'
  import {
    ALL,
    boxOf,
    settled,
    cutOf,
    layersOver,
    hushArrivals,
    moving,
    noticeRows,
    strangerOver,
    watchArrivals,
    type Cut,
    type Layer,
  } from './covers'
  import { ALLOW, SANDBOX } from './frame'
  import { keepNow, keepPage } from './keep'
  import { trailSteps, webRows, zoomed, type WebActions } from './menu'
  import { mute, muteSite } from './mute'
  import { zoomTo as zoomPageTo } from './zoom'
  import { shownAddress } from '@orden/scan/visits'
  import { cardCorner, type Frame, pages, type Rect, siteMark, type Step } from './pages.svelte'
  import { glance } from './still'
  import { seek, shut, sought } from './seek'
  import { watchScale, watchShifts } from './shifts'
  import { siteOf } from './permissions.svelte'
  import { asideFor, isMuted, zoomOf } from './sites'
  import { movedOn } from './used'
  import { visited } from './visited'
  import { webData } from './web-data.svelte'
  import { apartOf } from '@orden/scan/shortcut'
  import { clearingAsked } from './clearing-asked.svelte'
  import { passBubbles } from '../../pass-sync/src/api'
  import WebBar from './WebBar.svelte'
  import WebDownloads from './WebDownloads.svelte'
  import WebExtensionPopup from './WebExtensionPopup.svelte'
  import WebExtensions from './WebExtensions.svelte'
  import { extensions, type Extension } from './extensions.svelte'
  import WebSite from './WebSite.svelte'
  import WebAsks from './WebAsks.svelte'
  import { NewHere } from '../../new-here/src/api'
  import { handAppKeys } from './app-keys.svelte'
  import { cameFromAfter, focusBeside, readLeft } from './keys'

  const { tab: given, focused, shown = true }: { tab: Tab; focused: boolean; shown?: boolean } = $props()
  const tab = untrack(() => given)
  const LEAVING = 300
  const OVERVIEW = '[data-opens="overview"], .orden-glyph.overview'
  const page = $derived(pages.of(tab.id))
  const pictured = $derived(page.shot !== null)
  let hole = $state<HTMLElement>()
  let marked = $state(true)
  $effect(() => {
    const slot = hole
    if (!slot) return
    slot.tabIndex = page.live ? 0 : -1
    const into = (event: FocusEvent) => {
      if (!slot.matches(':focus-visible')) return
      const last = cameFromAfter(slot, event.relatedTarget)
      void invoke('keyboard_into', { tab: tab.id, last }).catch(() => undefined)
    }
    slot.addEventListener('focus', into)
    return () => slot.removeEventListener('focus', into)
  })
  const worn = $derived(agentMarks.on[tab.id] ?? null)
  const FRAME = 2
  function rect(): Rect | null {
    if (page.filling) return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    const box = hole?.getBoundingClientRect()
    if (!box || box.width < 1 || box.height < 1) return null
    const inset = worn ? FRAME : 0
    return {
      x: box.x + inset,
      y: box.y + inset,
      width: box.width - inset * 2,
      height: box.height - inset * 2,
    }
  }
  function coverOf(box: Rect): { box: Rect; cut: Cut | null } {
    if (page.filling) return { box, cut: null }
    if (filling.by !== null || (workspace.panes.dragging?.tabId ?? null) !== null) return { box, cut: ALL }
    if (!hole) return { box, cut: null }
    if (strangerOver(hole)) return { box, cut: ALL }
    const layers = layersOver(hole)
    watchLayers(layers)
    return { box, cut: cutOf(box, layers) }
  }
  let watched: Element[] = []
  function watchLayers(layers: readonly Layer[]) {
    if (!watching) return
    const now = [...layers.flatMap((one) => (one.node ? [one.node] : [])), ...noticeRows()]
    for (const one of watched) if (!now.includes(one)) watching.unobserve(one)
    for (const one of now) if (!watched.includes(one)) watching.observe(one)
    watched = now
  }
  function frameOf(): Frame | null {
    const window = { width: innerWidth, height: innerHeight }
    if (page.filling) {
      const whole = { x: 0, y: 0, ...window }
      return { window, area: whole, pane: whole }
    }
    const area = hole?.closest('[data-panes]')
    const pane = hole?.closest('[data-pane]')
    return area && pane ? { window, area: boxOf(area), pane: boxOf(pane) } : null
  }
  let scheduled = 0
  let told = ''
  const NO_ROOM = 'no room'
  let last: Rect | null = null
  let ready = false
  let leaving = 0
  const watching = typeof ResizeObserver === 'function' ? new ResizeObserver(() => now()) : null
  $effect(() => {
    const room = hole
    if (!room || !watching) return
    watching.observe(room)
    const unshift = watchShifts(room, follow)
    untrack(() => follow())
    return () => {
      watching.unobserve(room)
      unshift()
    }
  })
  $effect(() => heldOrLet(pages.still, page.heldAt))
  $effect(() => hushArrivals(pages.still))
  $effect(() => {
    const on = shown
    untrack(() => {
      if (!isDesktop || !ready) return
      cancelAnimationFrame(scheduled)
      told = ''
      if (on) void look()
      else if (last) pages.hide(tab.id, last)
    })
  })
  function heldOrLet(..._now: unknown[]) {
    untrack(now)
  }
  function follow(_cause?: unknown) {
    if (!isDesktop || !ready) return
    cancelAnimationFrame(scheduled)
    scheduled = requestAnimationFrame(() => void look())
  }
  function now() {
    void lookNow()
  }
  function lookNow(): Promise<void> | undefined {
    if (!isDesktop || !ready) return
    cancelAnimationFrame(scheduled)
    return look()
  }
  function look(): Promise<void> | undefined {
    if (!isDesktop || !ready || own || !shown) return
    if (page.heldAt || (pages.still && !page.shown)) {
      told = ''
      return
    }
    const box = rect()
    if (!box) {
      if (last && told !== NO_ROOM) {
        told = NO_ROOM
        void pages.place(tab.id, last, false)
      }
      return
    }
    const covered = coverOf(box)
    const at = covered.box
    const cut = settled(covered.cut, page.shot !== null, pages.cuts)
    last = at
    const visible = cut === null
    const corner = page.filling ? ([0, 0] as const) : cardCorner(hole)
    if (visible) leaving = 0
    else if (overlays.depth === 0) {
      if (leaving === 0) leaving = Date.now() + LEAVING
      if (Date.now() < leaving) follow()
    }
    if (!visible && hole && moving(hole)) follow()
    const frame = frameOf()
    const said = JSON.stringify([at, cut, frame?.window, devicePixelRatio, corner])
    if (said === told && page.live) return
    told = said
    page.space = space
    if (!page.live) page.own = apart
    return pages.show(tab.id, address, at, visible, { cut, frame, corner })
  }
  const address = $derived(page.url ?? tab.address ?? workspace.webAddressOf(tab) ?? '')
  const own = $derived(isOwnPage(address))
  const choosing = $derived(workspace.isNewTab(tab))
  $effect(() => {
    if (!own) return
    untrack(() => {
      page.url = address
      page.title = 'History'
      page.icon = HISTORY_MARK
    })
  })
  const space = $derived(workspace.spaceOf(tab.note))
  const book = webData.history()
  const apart = $derived(apartOf(tab))
  $effect(() => {
    const now = apart
    untrack(() => {
      if (page.own === now || !page.live) return
      const said = now ? 'This note keeps its own web data now' : 'Back on the shared web data'
      void pages.rehouse(tab.id, now, said)
    })
  })
  onMount(() => {
    handAppKeys()
    let unheard: (() => void) | null = null
    let gone = false
    if (isDesktop) {
      void import('../../windows/src/api')
        .then(({ hearHere }) =>
          hearHere('orden://keyboard-left-page', (event) => {
            const said = readLeft(event.payload)
            if (said?.tab === tab.id && hole) focusBeside(hole, said.next)
          }),
        )
        .then((stop) => {
          if (gone) stop()
          else unheard = stop
        })
        .catch(() => undefined)
    }
    const asking = () => {
      ready = true
      void look()
    }
    if (startup.reached('rooms')) asking()
    else void startup.turn('rooms').then(asking)
    window.addEventListener('resize', follow)
    const unscale = watchScale(follow)
    let lone = false
    const pressed = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        lone = event.key === 'Alt' && !event.repeat
        if (shortcuts.pressed('app.tab-overview', event)) glance(pages, tab.id)
      } else if (event.target instanceof Element && event.target.closest(OVERVIEW)) glance(pages, tab.id)
      follow()
    }
    const released = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && lone) glance(pages, tab.id)
      lone = false
    }
    window.addEventListener('pointerdown', pressed, true)
    window.addEventListener('keydown', pressed, true)
    window.addEventListener('keyup', released, true)
    const unwatch = overlays.watch(follow)
    const unarrive = watchArrivals(lookNow)
    return () => {
      gone = true
      unheard?.()
      cancelAnimationFrame(scheduled)
      watching?.disconnect()
      unwatch()
      unarrive()
      if (tab.path !== null) keepNow(tab.path)
      window.removeEventListener('resize', follow)
      unscale()
      window.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('keydown', pressed, true)
      window.removeEventListener('keyup', released, true)
      const held = pages.peek(tab.id)
      pages.typing(tab.id, false)
      if (held?.filling) {
        held.filling = false
        void invoke('web_unfill', { tab: tab.id }).catch(() => undefined)
        void filling.give(tab.id)
      }
      if (last) pages.hide(tab.id, last)
    }
  })
  $effect(() => {
    const said = page.notice
    if (said === null) return
    const gone = setTimeout(() => {
      if (page.notice === said) page.notice = null
    }, 4000)
    return () => clearTimeout(gone)
  })
  $effect(() => follow(worn !== null))
  $effect(() => follow(page.live))
  $effect(() => {
    untrack(() => {
      told = ''
      follow()
    })
  })
  $effect(() => follow(workspace.panes.dragging))
  $effect(() => follow(swiping.turn))
  $effect(() => {
    if (swiping.tab === tab.id && swiping.stage === 'tracking') untrack(() => pages.freshen(tab.id))
  })
  $effect(() => {
    const on = page.filling
    untrack(() => void (on ? filling.take(tab.id) : filling.give(tab.id)))
  })
  $effect(() => follow([page.filling, filling.by]))
  $effect(() => {
    const here = site
    if (!page.live || page.loading || !here) return
    untrack(() => {
      const aside = asideFor(tab.id, page)
      page.zoom = zoomOf(here, aside)
      void pages.zoom(tab.id, page.zoom)
      mute(tab.id, page, isMuted(here, aside))
    })
  })
  $effect(() => {
    if (page.url !== null && page.url !== tab.address) workspace.webWalked(tab, page.url)
  })
  $effect(() => {
    if (movedOn(page.landed, page.url)) untrack(() => workspace.keep(tab.id))
  })
  $effect(() => {
    const title = page.title
    untrack(() => workspace.webNamed(tab, title))
  })
  $effect(() => {
    page.path = tab.path
  })
  $effect(() => {
    const url = page.url
    const icon = page.kept
    const path = tab.path
    if (url === null || path === null) return
    untrack(() =>
      keepPage({
        path,
        text: () => tab.doc,
        url,
        icon,
        wrote: (text: string) => tab.note.replace(text, false),
      }),
    )
  })
  function clip() {
    void clipPage(tab.id, space, { url: page.url, title: page.title })
  }
  $effect(() => {
    if (address) marked = true
  })
  let showingSite = $state(false)
  let showingDownloads = $state(false)
  const extending = isDesktop
  let showingExtensions = $state(false)
  $effect(() => {
    if (extensions.shownIn !== tab.id) return
    untrack(() => {
      extensions.shownIn = null
      const anchor = root?.querySelector<HTMLElement>('[data-opens="extensions"]')
      hangs = anchor ? under(anchor) : 0
      showingExtensions = true
      showingSite = false
      showingDownloads = false
    })
  })
  let hangs = $state(0)
  let opener = $state<HTMLElement | null>(null)
  let head = $state<HTMLElement>()
  let root = $state<HTMLElement>()
  let onStore = $state<string | null>(null)
  const addable = $derived(
    onStore !== null && !extensions.list.some((one) => one.id === onStore || one.addon === onStore) ? onStore : null,
  )
  $effect(() => {
    const url = page.url
    if (!extending || !url) {
      onStore = null
      return
    }
    void extensions.named(url).then((id) => {
      if (page.url === url) onStore = id
    })
  })
  $effect(() => {
    if (isDesktop && passOn())
      return whenLoaded(
        () => import('../../pass-sync/src/api'),
        ({ autofill }) => void autofill.start(),
      )
  })
  const passBubble = $derived(passOn() ? passBubbles.of(tab.id) : null)
  onMount(() => {
    if (extending) void extensions.start()
    return () => {
      if (extensions.popped?.tab === tab.id) extensions.close()
    }
  })
  function under(anchor: HTMLElement): number {
    const bar = head?.getBoundingClientRect()
    const button = anchor.getBoundingClientRect()
    return bar ? Math.max(0, bar.right - button.right) : 0
  }
  async function pressExtension(one: Extension, anchor: HTMLElement | null) {
    showingExtensions = false
    if (one.popup) {
      if (anchor) hangs = under(anchor)
      opener = anchor ?? head?.querySelector<HTMLElement>(`[data-extension="${CSS.escape(one.id)}"]`) ?? null
      extensions.open(one.id, tab.id, page.store)
      return
    }
    const options = await extensions.optionsOf(one.id)
    if (options) workspace.openPage(options, 'front', tab.id)
  }
  const site = $derived(siteOf(page.url))
  const takeover = $derived(agentMarks.takeovers[tab.id] ?? null)
  $effect(() => {
    if (!page.find.open || page.loading) return
    untrack(() => seek(tab.id, page, page.find.query, 'fresh'))
  })
  function onKeydown(event: KeyboardEvent) {
    if (!focused || !isDesktop || !page.live) return
    if (event.defaultPrevented || keyElsewhere(event, root)) return
    const either = (id: string) => shortcuts.pressed(id, event) || shortcuts.pressed(`${id}.alt`, event)
    const look = shortcuts.pressed('edit.find', event)
      ? 'find'
      : either('edit.find-next')
        ? 'next'
        : either('edit.find-previous')
          ? 'previous'
          : null
    if (look) {
      event.preventDefault()
      sought(tab.id, page, look)
    } else if (either('web.devtools')) {
      event.preventDefault()
      void invoke('web_devtools', { tab: tab.id }).catch(() => undefined)
    } else if (shortcuts.pressed('web.mute', event)) {
      event.preventDefault()
      void muteSite(tab.id, !page.muted)
    }
  }
  async function showTrail(forward: boolean, event: MouseEvent) {
    event.preventDefault()
    const { urls, at } = await pages.trail(tab.id)
    const rows = trailSteps(urls, at, forward).map(({ url, by }) => ({
      label: visited.titleOf(book, url) || shownAddress(url),
      run: () => void pages.step(tab.id, forward ? 'forward' : 'back', by),
    }))
    menu.show(event, rows, { title: forward ? 'Forward' : 'Back' })
  }
  function zoomTo(factor: number) {
    zoomPageTo(tab.id, page, factor)
  }
  const actions: WebActions = {
    newTab: () => workspace.newTab(tab.paneId),
    get newPrivate() {
      return hiddenKinds.offers('private')
        ? () => void import('./private').then(({ openPrivate }) => openPrivate())
        : undefined
    },
    history: () => void import('./history-open').then(({ openHistory }) => openHistory(tab)),
    clearData: () => clearingAsked.ask(tab.id),
    bookmarks: () => workspace.showPanel('tree'),
    zoom: (factor: number) => {
      zoomTo(factor)
      menu.replace(webRows(page, factor, actions))
    },
    fullScreen: () => {
      workspace.activate(tab.id)
      void fullscreen.toggle(workspace.panes)
    },
    print: () => void pages.print(tab.id),
    find: isDesktop ? () => (page.find.open = true) : undefined,
    save: clip,
    get share() {
      const path = tab.path
      return path !== null && canShareItem(path) ? () => void shareThisFile(path) : undefined
    },
    settings: () => settingsWindow().show(),
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="web" bind:this={root}>
  <div class="head" class:gone={fullscreen.on} bind:this={head}>
    <WebBar
      {page}
      tab={tab.id}
      ground={chrome.barOf(tab.id)}
      theme={chrome.barTheme(tab.id)}
      {focused}
      {book}
      onstep={(step: Step, press?: MouseEvent) => {
        const ask = press ? tabAsk(press) : 'plain'
        if (step === 'back') workspace.goBack(tab.id, ask)
        else if (step === 'forward') workspace.goForward(tab.id, ask)
        else if (step === 'reload' && ask !== 'plain' && page.url !== null) workspace.openPage(page.url, ask, tab.id)
        else void pages.step(tab.id, step)
      }}
      onhistory={showTrail}
      onaddress={(said: string, aside: boolean, typed: string) => {
        const url = webAddress(said, searchEngine.url)
        if (!url) {
          const why = unopened(said)
          if (why === 'own page') actions.history()
          else if (why === 'file') page.notice = 'That file could not be read'
          else if (why === 'link') page.notice = 'that link could not be followed'
          return
        }

        if (!page.inPrivate) visited.typed(book, url)
        const upgrade = upgradeOf(typed || said, url)
        if (aside) {
          const opened = workspace.openPage(url, 'front', tab.id)
          if (opened) pages.of(opened).upgrade = upgrade
          return
        }
        void pages.go(tab.id, url, upgrade)
        void workspace.webAimed(tab, url)
      }}
      onnote={(path: string) => void import('./web-notes').then((one) => one.openWebNote(workspace, tab, path))}
      onmenu={(event: MouseEvent) => menu.show(event, webRows(page, page.zoom, actions), { title: 'Website' })}
      onsite={() => {
        showingSite = !showingSite
        showingDownloads = false
        showingExtensions = false
      }}
      ondownloads={() => {
        showingDownloads = !showingDownloads
        showingSite = false
        showingExtensions = false
      }}
      ontyping={(on: boolean) => pages.typing(tab.id, on)}
      onzoom={(step: ZoomStep) => zoomTo(step === 'reset' ? 1 : zoomed(page.zoom, step === 'in'))}
      onbrowser={(which: 'history' | 'clear') => (which === 'history' ? actions.history() : actions.clearData())}
      extending={extending
        ? {
            addable,
            open: extensions.popped?.tab === tab.id ? extensions.popped.id : null,
            onpress: (id: string, anchor: HTMLElement) => {
              const one = extensions.list.find((each) => each.id === id)
              if (one) void pressExtension(one, anchor)
            },
            onlist: (anchor: HTMLElement) => {
              hangs = under(anchor)
              showingExtensions = !showingExtensions
              showingSite = false
              showingDownloads = false
            },
            onadd: () => {
              if (page.url) void extensions.installFrom(tab.id, page.url)
            },
          }
        : null}
    />

    {#if page.notice !== null}
      <p class="waiting" transition:fade={{ duration: dur(140) }}>
        {page.notice}
      </p>
    {/if}

    {#snippet strip(said: string, label: string, open: () => void, close: () => void)}
      <div class="unplayable" role="status" transition:fade={{ duration: dur(140) }}>
        <p>{said}</p>
        <button class="orden-button is-quiet" onclick={open}>{label}</button>
        <button class="orden-glyph" aria-label="Close" title="Close" onclick={close}>
          <Cross small />
        </button>
      </div>
    {/snippet}
    {#if page.blocked}
      {@render strip(
        'Pop-up blocked',
        'Open',
        () => pages.openBlocked(tab.id),
        () => (page.blocked = null),
      )}
    {/if}
    {#if page.unplayable}
      {@render strip(
        "This media can't play here",
        'Open in the browser',
        () => void openExternal(page.at ?? address),
        () => (page.unplayable = false),
      )}
    {/if}

    {#if showingSite && page.url !== null}
      <WebSite url={page.url} {site} tab={tab.id} privately={page.inPrivate} onclose={() => (showingSite = false)} />
    {:else if showingDownloads}
      <WebDownloads onclose={() => (showingDownloads = false)} />
    {:else if extensions.popped?.tab === tab.id}
      {#key extensions.popped.id}
        <WebExtensionPopup popped={extensions.popped} right={hangs} from={opener} />
      {/key}
    {:else if showingExtensions}
      <WebExtensions
        right={hangs}
        onpress={(one: Extension) => void pressExtension(one, null)}
        onclose={() => (showingExtensions = false)}
      />
    {:else}
      <Door open={passBubble !== null} load={() => passFill()}>
        {#snippet children(PassFill)}<PassFill bubble={passBubble} />{/snippet}
      </Door>
    {/if}
  </div>

  {#if takeover}
    {#await takeoverBar() then TakeoverBar}
      <TakeoverBar id={takeover.id} reason={takeover.reason} />
    {/await}
  {/if}

  {#if page.find.open}
    {#await findBar() then FindBar}
      <FindBar
        query={page.find.query}
        count={page.find.count}
        current={page.find.at}
        onstep={(by: number) => seek(tab.id, page, page.find.query, by > 0 ? 'next' : 'previous')}
        onclose={() => shut(tab.id, page)}
        onquery={(typed: string) => seek(tab.id, page, typed, 'fresh')}
      />
    {/await}
  {/if}

  {#if clearingAsked.tab === tab.id}
    {#await import('./WebClear.svelte') then clear}
      <clear.default apart={pages.apart()} onclose={() => clearingAsked.close()} />
    {/await}
  {/if}

  {#if choosing}
    <NewHere paneId={tab.paneId} chosenOn={tab.id} />
  {:else if own}
    {#await import('./WebHistory.svelte') then history}
      <history.default
        {book}
        {focused}
        onopen={(url: string, ask: TabAsk) => {
          if (ask === 'plain') void pages.go(tab.id, url)
          else workspace.openPage(url, ask, tab.id)
        }}
        onclear={() => clearingAsked.ask(tab.id)}
      />
    {/await}
  {:else if isDesktop && page.crashed}
    <div class="card">
      <p class="name">{page.title || plainOrigin(address)}</p>
      <p class="site">{address}</p>
      {#if page.failure?.reason}
        <p class="why">{page.failure.reason}</p>
      {/if}
      <div class="rows">
        <button class="orden-button" onclick={() => void pages.step(tab.id, 'reload')}> Reload </button>
        <button class="orden-button is-quiet" onclick={() => void openExternal(address)}> Open in the browser </button>
      </div>
    </div>
  {:else if isDesktop && page.openable}
    <div
      class="hole"
      class:acted={worn !== null}
      class:resting={worn?.stopped}
      style:--agent={worn?.colour}
      class:still={pictured}
      style:background-image={pictured ? `url(${page.shot})` : 'none'}
      bind:this={hole}
      use:dropOver={(event) => hole && overPage(tab.id, hole, event, page.zoom)}
      ondragleave={() => leftPage(tab.id)}
      ondrop={(event) => hole && droppedOnPage(tab.id, hole, event, page.zoom)}
    ></div>
    <WebAsks tab={tab.id} />
  {:else if page.framing === 'frame' && address}
    <iframe
      class="framed"
      data-web-tab={tab.id}
      onload={() => landed(tab.id)}
      class:acted={worn !== null}
      class:resting={worn?.stopped}
      style:--agent={worn?.colour}
      title={page.title || plainOrigin(address)}
      src={address}
      sandbox={SANDBOX}
      allow={ALLOW}
      referrerpolicy="origin"
    ></iframe>
  {:else}
    <div class="card" class:acted={worn !== null} class:resting={worn?.stopped} style:--agent={worn?.colour}>
      {#if address}
        {@const mark = siteMark(page.icon, address) ?? favicon(address)}
        {#if marked && mark}
          <img class="mark" src={mark} alt="" draggable="false" onerror={() => (marked = false)} />
        {/if}
        <p class="name">{page.title || plainOrigin(address)}</p>
        <p class="site">{address}</p>

        <div class="rows">
          <button class="orden-button" onclick={() => (page.framing = 'frame')}> Show it here </button>
          <button class="orden-button is-quiet" onclick={() => void openExternal(address)}>
            Open in the browser
          </button>
        </div>
      {:else}
        <p class="site">Address</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .web {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    position: relative;
    z-index: var(--z-raised);
    flex: none;
  }
  .head.gone {
    display: none;
  }
  .hole {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }
  .waiting {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
  .unplayable {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
  .unplayable p {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--muted);
  }
  .hole.still {
    background-repeat: no-repeat;
    background-position: top left;
    background-size: 100% auto;
  }
  .framed {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: none;
    background: var(--bg);
  }
  .hole,
  .framed,
  .card {
    outline: 2px solid transparent;
    outline-offset: -2px;
    transition: outline-color var(--dur-base) var(--ease-out);
  }
  .acted {
    outline-color: var(--agent);
  }
  .acted.resting {
    outline-color: var(--muted);
  }
  .card {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    color: var(--muted);
    font-family: var(--font-ui);
    text-align: center;
  }
  .mark {
    width: calc(var(--icon-lg) * 2);
    height: calc(var(--icon-lg) * 2);
    border-radius: var(--radius-row);
  }
  .name {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }
  .rows {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
  }
  .site {
    margin: 0;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .why {
    max-width: 36em;
    margin: 0;
    color: var(--text);
    font-size: var(--text-sm);
  }
</style>
