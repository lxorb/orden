<script lang="ts">
  import { swipeOpens } from './swipe-opens'
  import { chrome } from './glass/chrome.svelte'
  import { keepFocus } from './focus'
  import { modes } from './modes.svelte'
  import { SEARCH_MARK } from './panel-marks'
  import SidebarToggle from './SidebarToggle.svelte'
  import FileMark from './FileMark.svelte'
  import TabMark from './TabMark.svelte'
  import UnsavedDot from './UnsavedDot.svelte'
  import { askPlace } from './save-place/door'
  import { shown as pad } from './scratchpad/is.svelte'
  import { isDraft } from './workspace/drafts'
  import TopStrips from './TopStrips.svelte'
  import { closeWindow, currentWindow, isDesktop, platform } from './tauri'
  import { tabOverview, toggleTabOverview } from './surfaces.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { startup } from './startup.svelte'
  import { viewport } from './viewport.svelte'
  import { WindowState } from './window-state.svelte'
  import { topRow } from './workspace/pane-tree'
  import { workspace } from './workspace.svelte'

  const {
    onpalette,
    panes = 0,
  }: {
    onpalette: () => void
    panes?: number
  } = $props()

  const swiped = $derived(swipeOpens())

  const BACK_MARK = 'M8.2 2.2 3.9 6.5l4.3 4.3'

  const MORE_MARK = 'M3 6.5h.1M6.5 6.5h.1M10 6.5h.1'

  const phone = $derived(viewport.device === 'phone' && !__EVEN_PLUGIN__)

  function showMore(event: MouseEvent) {
    const from = event.currentTarget as HTMLElement
    void (__EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./phone/note-more')).then(
      (one) => one.showNoteMore(from),
    )
  }

  $effect(() => {
    if (swiped && workspace.openOn('left')) {
      void import('./hints.svelte').then(({ hints }) => hints.dismiss('drawer'))
    }
  })

  const shape = new WindowState()
  const maximized = $derived(shape.maximized)

  const mac = isDesktop && platform() === 'macos'
  const lights = $derived(mac && modes.frame === 'orden' && !shape.fullscreen)

  $effect(() => {
    if (lights) document.documentElement.dataset.lights = ''
    else delete document.documentElement.dataset.lights
  })

  const listless = $derived(
    workspace.restored && !workspace.spaces.length && !workspace.tabs.length,
  )

  const cornered = $derived(lights && !(workspace.panel && !viewport.drawer))
  const bare = $derived(!(isDesktop && !mac && modes.frame === 'orden'))

  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))

  const only = $derived(
    workspace.panes.count === 1 || workspace.panes.fills ? workspace.panes.focused : null,
  )
  const strips = $derived(only ?? topRow(workspace.panes.frame))

  let wide = $state(0)
  let leadWide = $state(0)
  let endWide = $state(0)
  const overPanes = $derived(endWide - wide + (panes || wide))

  const title = $derived(pad.on ? 'Scratchpad' : (workspace.active?.shown ?? 'Orden'))
  const showing = $derived(viewport.touch && pad.on ? null : workspace.active)

  async function minimize() {
    if (isDesktop) await (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    await shape.toggle(await currentWindow())
  }
</script>

{#snippet searchGlyph()}
  <button
    class="orden-glyph search"
    data-overview-keeps
    title={shortcuts.tooltip('Search', 'app.palette')}
    aria-label="Search notes and commands"
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={() => onpalette()}
  >
    <svg viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
  </button>
{/snippet}

{#snippet overviewGlyph()}
  <button
    class="orden-glyph overview"
    data-overview-keeps
    class:is-on={tabOverview.open}
    aria-pressed={tabOverview.open}
    title={shortcuts.tooltip('Tabs', 'app.tab-overview')}
    aria-label="Tabs"
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={() => toggleTabOverview()}
  >
    <svg viewBox="0 0 14 14"
      ><rect x="1.5" y="2.5" width="5" height="4" rx="1.2" /><rect
        x="7.5"
        y="2.5"
        width="5"
        height="4"
        rx="1.2"
      /><rect x="1.5" y="8" width="5" height="4" rx="1.2" /><rect
        x="7.5"
        y="8"
        width="5"
        height="4"
        rx="1.2"
      /></svg
    >
  </button>
{/snippet}

{#snippet rightToggle()}
  {#if viewport.touch}
    {#if workspace.right.length}
      <SidebarToggle side="right" />
    {/if}
  {:else if workspace.right.length || !__EVEN_PLUGIN__}
    <SidebarToggle side="right" />
  {/if}
{/snippet}

{#snippet windowButtons()}
  {#if isDesktop && !mac}
    {#if modes.frame === 'orden'}
      <div class="controls" data-overview-keeps>
        <button onclick={minimize} aria-label="Minimize">
          <svg viewBox="0 0 10 10"><path d="M0 5h10" /></svg>
        </button>
        <button onclick={toggleMaximize} aria-label={maximized ? 'Restore' : 'Maximize'}>
          {#if maximized}
            <svg viewBox="0 0 10 10"><path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" /></svg>
          {:else}
            <svg viewBox="0 0 10 10"><path d="M0.5 0.5h9v9h-9z" /></svg>
          {/if}
        </button>
        <button
          class="close"
          onclick={closeWindow}
          title={shortcuts.tooltip('Close', 'app.close-window')}
          aria-label="Close"
        >
          <svg viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        </button>
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet leftToggle()}
  {#if !listless}
    <SidebarToggle unseen={swiped} />
    {#if swiped && startup.settled && !__EVEN_PLUGIN__}
      <span class="swipe-hint">
        {#await import('./HintCard.svelte') then card}
          <card.default
            hint="drawer"
            side="below"
            text="Swipe in from the edge to see your notes."
            onpress={() => workspace.toggleSidebar()}
          />
        {/await}
      </span>
    {/if}
  {/if}
{/snippet}

<header
  class:lights={cornered}
  data-chrome="top"
  data-theme={chrome.theme}
  bind:clientWidth={wide}
  style:--panes-wide={panes ? `${panes}px` : undefined}
  style:--strip-lead={viewport.touch
    ? undefined
    : `max(0px, calc(var(--space-1) + var(--lights-start, 0px) + ${leadWide}px - var(--card-inset)))`}
  style:--strip-end={viewport.touch
    ? undefined
    : `max(0px, calc(${overPanes}px - var(--card-inset)))`}
>
  {#if viewport.touch}
    {#if phone && !listless}
      <button
        class="orden-glyph back"
        data-phone-back
        aria-label="Back"
        onclick={() => workspace.toggleSidebar()}
      >
        <svg viewBox="0 0 13 13"><path d={BACK_MARK} /></svg>
      </button>
    {:else}
      {@render leftToggle()}
    {/if}

    <h1 class="title" data-save-anchor>
      {#if showing}<TabMark tab={showing} />{:else if pad.on}<FileMark mark="note" />{/if}
      <span class="name">{title}</span>
      {#if showing && isDraft(showing.note)}
        <button class="orden-glyph" aria-label="Save" onclick={() => askPlace(showing.id)}
          ><UnsavedDot pressable /></button
        >
      {/if}
    </h1>

    {#if phone}
      {#if showing}
        <button
          class="orden-glyph more"
          data-phone-more
          aria-label="More"
          aria-haspopup="menu"
          onclick={showMore}
        >
          <svg viewBox="0 0 13 13"><path d={MORE_MARK} /></svg>
        </button>
      {/if}
    {:else}
      {@render searchGlyph()}
      {@render rightToggle()}
    {/if}
    {@render windowButtons()}
  {:else}
    <div class="lead" bind:clientWidth={leadWide}>
      {@render searchGlyph()}
      {@render overviewGlyph()}
      {@render leftToggle()}
    </div>
    <div class="drag" data-tauri-drag-region></div>

    <div class="heads">
      <TopStrips frame={strips} />
    </div>

    <div class="end" class:bare bind:clientWidth={endWide}>
      {@render rightToggle()}
      {@render windowButtons()}
    </div>
  {/if}
</header>

<style>
  header {
    position: relative;
    height: var(--header-height);
    display: flex;
    align-items: stretch;
    flex: none;
    padding-inline-start: var(--space-1);
    user-select: none;
    -webkit-user-select: none;
    --overview-solid: calc(100% - 100% * var(--overview-bar, 0));
    background: color-mix(in srgb, var(--tab-frame) var(--overview-solid), transparent);
    box-shadow: inset 0 -1px
      color-mix(in srgb, var(--chrome-seam) var(--overview-solid), transparent);
  }

  header:has(:global([data-region='tabs'])) {
    box-shadow: none;
    overflow-x: clip;
  }

  header.lights {
    padding-left: var(--traffic-lights);
    --lights-start: var(--traffic-lights);
  }

  .lead,
  .end {
    flex: none;
    display: flex;
    align-items: stretch;
  }

  .end.bare {
    padding-inline-end: var(--space-1);
  }

  .heads {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--card-inset);
    width: calc(var(--panes-wide, 100%) - 2 * var(--card-inset));
    display: flex;
    pointer-events: none;
  }

  .heads > :global(*) {
    flex: 1;
  }

  .swipe-hint {
    position: relative;
    flex: none;
    width: 0;
  }

  .overview,
  .search {
    align-self: center;
  }

  .drag {
    flex: 1;
    min-width: var(--space-5);
  }

  .controls {
    position: relative;
    flex: none;
    display: flex;
    opacity: 0.45;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  header:hover .controls {
    opacity: 1;
  }

  .controls button {
    width: 44px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .controls button:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }

    .controls button.close:hover {
      background: var(--danger);
      color: #fff;
    }
  }

  .controls button:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .controls button.close:active {
    background: color-mix(in srgb, var(--danger) 82%, black);
    color: #fff;
  }

  .controls svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: square;
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    align-self: center;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  :global([data-touch]) header {
    height: auto;
    background: none;
    padding-top: var(--inset-top);
    padding-inline-end: var(--inset-right);
    padding-inline-start: calc(var(--inset-left) + (var(--row-height) - var(--icon-lg)) / 2);
  }

  .more svg {
    stroke-width: 2;
    stroke-linecap: round;
  }

  .back svg {
    stroke-width: 1.4;
  }

  :global([data-touch]) header:has(> :global([data-side-toggle='left']:not(.orden-said))) {
    padding-inline-start: var(--inset-left);
  }

  :global([data-touch]) header:has(> [data-phone-back]) {
    padding-inline-start: var(--inset-left);
  }
</style>
