<script lang="ts">
  /** A website in a pane: the bar, and under it the page.
   *
   *  Three builds, one design, and the difference is only what fills the space under
   *  the bar. On a desktop it is a hole: the page is a webview of its own, placed
   *  over this rectangle by the crate, and what is in the document here is an empty
   *  box that reports where it is. In a browser it is a frame, where the site allows
   *  one. On a phone neither - the tab never opens there; the system browser does,
   *  and `workspace.openWeb` says why.
   *
   *  The hole has to follow the pane exactly, so it is measured rather than
   *  guessed: a resize observer for the pane being dragged, the window's own resize,
   *  and a check after anything the app puts over it. A native webview draws above
   *  every pixel of HTML in the window, so while something of the app's is over the
   *  page the page is hidden - otherwise a menu would come up behind it. */

  import { onMount, untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { isDesktop, openExternal } from '../tauri'
  import type { Tab } from '../workspace.svelte'
  import { workspace } from '../workspace.svelte'
  import { plainOrigin, webAddress } from './address'
  import { clipPage } from './clip'
  import { ALLOW, PATIENCE, refused, SANDBOX } from './frame'
  import { webRows } from './menu'
  import { pages, type Rect, type Step } from './pages.svelte'
  import WebBar from './WebBar.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  const page = $derived(pages.of(tab.id))

  let hole = $state<HTMLElement>()
  let frame = $state<HTMLIFrameElement>()

  /** Where the hole is, as the window measures it. Null before it is on the page. */
  function rect(): Rect | null {
    const box = hole?.getBoundingClientRect()
    if (!box || box.width < 1 || box.height < 1) return null

    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  /** Whether something of the app's is over the middle of the hole.
   *
   *  Asked of the document rather than of a list of everything that can be opened: a
   *  menu, a sheet, the palette and the settings are all just the topmost element at
   *  a point, and the browser already knows which that is. */
  function under(): boolean {
    const box = hole?.getBoundingClientRect()
    if (!box || !hole) return false

    const on = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return on !== null && on !== hole && !hole.contains(on)
  }

  let scheduled = 0
  let late: ReturnType<typeof setTimeout> | undefined
  /** The last thing the crate was told, so nothing is told to it twice. A press
   *  anywhere in the window asks this question, and most presses have not moved
   *  anything. */
  let told = ''

  /** Puts the page where the hole is. Coalesced onto a frame, because a pane being
   *  dragged reports every pixel, and silent when nothing has changed. */
  function follow() {
    if (!isDesktop) return

    cancelAnimationFrame(scheduled)
    scheduled = requestAnimationFrame(() => {
      const box = rect()
      if (!box) return

      const visible = !under()
      const said = `${box.x},${box.y},${box.width},${box.height},${String(visible)}`
      if (said === told) return

      told = said
      if (visible) void pages.show(tab.id, address, box)
      else void pages.place(tab.id, box, false)
    })
  }

  /** Where this tab points: the address the page is on, else the one the session
   *  remembered, else what the file says. */
  const address = $derived(page.url ?? tab.address ?? workspace.webAddressOf(tab) ?? '')

  onMount(() => {
    const box = rect()
    if (box && address) void pages.show(tab.id, address, box)

    const watching = new ResizeObserver(follow)
    if (hole) watching.observe(hole)

    window.addEventListener('resize', follow)
    // Anything the app opens over the page is opened by a press: after one, look
    // again at what is on top. Twice, because a sheet arrives over a transition.
    const pressed = () => {
      follow()
      // Again after the transition an overlay arrives on, and only once however
      // many keys were pressed while it was on its way.
      clearTimeout(late)
      late = setTimeout(follow, 220)
    }
    window.addEventListener('pointerdown', pressed, true)
    window.addEventListener('keydown', pressed, true)

    return () => {
      cancelAnimationFrame(scheduled)
      clearTimeout(late)
      watching.disconnect()
      window.removeEventListener('resize', follow)
      window.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('keydown', pressed, true)

      // The tab is no longer the one showing. The page goes out of sight and, if
      // nobody comes back to it, is taken down; see pages.svelte.ts.
      const last = rect()
      if (last) pages.hide(tab.id, last)
      else void pages.sleep(tab.id)
    }
  })

  // The address the tab remembers, so a restart comes back on the page it was on
  // rather than at the site's front door.
  $effect(() => {
    if (page.url !== null && page.url !== tab.address) workspace.webWalked(tab, page.url)
  })

  // A website in the space keeps itself, the way a note in a space does: as soon as
  // the page has said what it is called, there is a file. Nothing to press.
  $effect(() => {
    const url = page.url
    const title = page.title
    if (url === null) return

    void untrack(() => workspace.keepWeb(tab, url, title))
  })

  function clip() {
    void clipPage(tab.id, { url: page.url, title: page.title })
  }

  // A browser build finds out whether the site allows a frame at all. The frame is
  // keyed on the address, so every new page asks again.
  $effect(() => {
    if (isDesktop || !frame || !address) return

    const showing = frame
    page.framing = 'asking'

    const decide = () => {
      page.framing = refused(showing) ? 'refused' : 'framed'
    }
    const waited = setTimeout(() => {
      // A site being slow and a site that will never answer look the same from
      // here; after this long the difference has stopped mattering.
      if (page.framing === 'asking') page.framing = 'refused'
    }, PATIENCE)

    showing.addEventListener('load', decide)

    return () => {
      clearTimeout(waited)
      showing.removeEventListener('load', decide)
    }
  })
</script>

<div class="web">
  <WebBar
    {page}
    {focused}
    reads={isDesktop}
    asked={pages.asked}
    onstep={(step: Step) => void pages.step(tab.id, step)}
    onaddress={(typed: string) => {
      const url = webAddress(typed)
      if (url) void pages.go(tab.id, url)
    }}
    onclip={clip}
    onmenu={(event: MouseEvent) => menu.show(event, webRows(page, clip), { title: t('Website') })}
    ontyping={(on: boolean) => {
      page.typing = on
    }}
  />

  {#if isDesktop}
    <!-- The hole. Nothing is drawn in it: the page is a webview over this box, and
         anything here would be under it. Its colour is the page's own background
         while a page is loading, so the pane does not flash. -->
    <div class="hole" bind:this={hole}></div>
  {:else if page.framing !== 'refused' && address}
    <iframe
      bind:this={frame}
      class="framed"
      title={page.title || plainOrigin(address)}
      src={address}
      sandbox={SANDBOX}
      allow={ALLOW}
      referrerpolicy="origin"
    ></iframe>
  {:else}
    <!-- The site refuses to be framed, which is its right and is most of the web.
         What is left to say is where it goes, said as the row that takes you
         there. -->
    <div class="card">
      {#if address}
        <img class="mark" src={new URL('/favicon.ico', address).href} alt="" />
        <p class="name">{page.title || plainOrigin(address)}</p>
        <p class="site">{plainOrigin(address)}</p>
        <button class="nib-button" onclick={() => void openExternal(address)}>
          {t('Open in the browser')}
        </button>
      {:else}
        <p class="site">{t('Address')}</p>
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

  /* The page's own room. `--bg` rather than nothing, because for one frame between
     the hole being measured and the webview arriving this box is what shows. */
  .hole {
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }

  .framed {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: none;
    background: var(--bg);
  }

  /* A card in the middle of the space the page would have filled: the same quiet
     centred block a note still on its way shows. */
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
    width: var(--icon-lg);
    height: var(--icon-lg);
  }

  .name {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .site {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
