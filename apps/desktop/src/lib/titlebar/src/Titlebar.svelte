<script lang="ts">
  import { chrome } from '../../theme/src/api'
  import { keepFocus, SEARCH_MARK, UnsavedDot, viewport } from '../../ui-kit/src/api'
  import { modes } from '../../modes/src/api'
  import SidebarToggle from './SidebarToggle.svelte'
  import { FileMark } from '../../marks/src/api'
  import { TabMark } from '../../marks/src/api'
  import { askPlace } from '../../save-place/src/api'
  import { isDraft } from '../../documents/src/api'
  import { TopStrips } from '../../pane-tree/src/api'
  import { closeWindow, currentWindow, isDesktop, platform } from '../../platform/src/api'
  import { scratchpadOn, swipeOpens, tabOverview, toggleTabOverview, workspace } from '../../workspace/src/api'
  import { shortcuts } from '../../shortcuts/src/api'
  import { WindowState } from '../../windows/src/api'
  import { topRow } from '../../panes/src/api'

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
  const phone = $derived(viewport.device === 'phone')
  const phoneDoor = () => import('../../phone/src/api')
  const touchTabs = $derived(viewport.touch)
  const tabCount = $derived(workspace.tabsIn(workspace.panes.focusedId).length)
  let grid = $state(false)
  let pressed: { x: number; y: number } | null = null
  function turned(event: PointerEvent) {
    const from = pressed
    pressed = null
    if (!from || !touchTabs) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    void phoneDoor()
      .then((one) => one.tabSwipe())
      .then((one) => one.turnTab(dx, dy))
  }
  function showMore(event: MouseEvent) {
    const from = event.currentTarget as HTMLElement
    void phoneDoor()
      .then((one) => one.noteMore())
      .then((one) => one.showNoteMore(from))
  }
  const shape = new WindowState()
  const maximized = $derived(shape.maximized)
  const mac = isDesktop && platform() === 'macos'
  const lights = $derived(mac && modes.frame === 'orden' && !shape.fullscreen)
  $effect(() => {
    if (lights) document.documentElement.dataset.lights = ''
    else delete document.documentElement.dataset.lights
  })
  const listless = $derived(workspace.restored && !workspace.spaces.length && !workspace.tabs.length)
  const cornered = $derived(lights && !(workspace.panel && !viewport.drawer))
  const bare = $derived(!(isDesktop && !mac && modes.frame === 'orden'))
  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))
  const only = $derived(workspace.panes.count === 1 || workspace.panes.fills ? workspace.panes.focused : null)
  const strips = $derived(only ?? topRow(workspace.panes.frame))
  let wide = $state(0)
  let leadWide = $state(0)
  let endWide = $state(0)
  const overPanes = $derived(endWide - wide + (panes || wide))
  const title = $derived(scratchpadOn() ? 'Scratchpad' : (workspace.active?.shown ?? 'Orden'))
  const showing = $derived(viewport.touch && scratchpadOn() ? null : workspace.active)
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
      ><rect x="1.5" y="2.5" width="5" height="4" rx="1.2" /><rect x="7.5" y="2.5" width="5" height="4" rx="1.2" /><rect
        x="1.5"
        y="8"
        width="5"
        height="4"
        rx="1.2"
      /><rect x="7.5" y="8" width="5" height="4" rx="1.2" /></svg
    >
  </button>
{/snippet}

{#snippet rightToggle()}
  {#if viewport.touch}
    {#if workspace.right.length}
      <SidebarToggle side="right" />
    {/if}
  {:else}
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
    : `max(0px, calc(var(--space-1) + var(--lights-start, 0px) + ${leadWide}px - var(--left-inset, var(--card-inset))))`}
  style:--strip-end={viewport.touch
    ? undefined
    : `max(0px, calc(${overPanes}px - var(--right-inset, var(--card-inset))))`}
>
  {#if viewport.touch}
    {#if phone && !listless}
      <button class="orden-glyph back" data-phone-back aria-label="Back" onclick={() => workspace.toggleSidebar()}>
        <svg viewBox="0 0 13 13"><path d={BACK_MARK} /></svg>
      </button>
    {:else}
      {@render leftToggle()}
    {/if}

    <h1
      class="title"
      data-save-anchor
      data-turns-pages={touchTabs || undefined}
      onpointerdown={(event) => (pressed = { x: event.clientX, y: event.clientY })}
      onpointerup={turned}
      onpointercancel={() => (pressed = null)}
    >
      {#if showing}<TabMark tab={showing} />{:else if scratchpadOn()}<FileMark mark="note" />{/if}
      <span class="name">{title}</span>
      {#if showing && isDraft(showing.note)}
        <button class="orden-glyph" aria-label="Save" onclick={() => askPlace(showing.id)}
          ><UnsavedDot pressable /></button
        >
      {/if}
    </h1>

    {#if touchTabs && tabCount}
      <button
        class="orden-glyph tabs"
        data-tabs-button
        aria-label="Tabs"
        aria-haspopup="dialog"
        onclick={() => (grid = true)}
      >
        <span class="count">{tabCount > 99 ? '99+' : tabCount}</span>
      </button>
    {/if}
    {#if grid}
      {#await phoneDoor().then((one) => one.loadTabGrid()) then TabGrid}
        <TabGrid.default onclose={() => (grid = false)} />
      {/await}
    {/if}

    {#if phone}
      {#if showing}
        <button class="orden-glyph more" data-phone-more aria-label="More" aria-haspopup="menu" onclick={showMore}>
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
    box-shadow: inset 0 -1px color-mix(in srgb, var(--chrome-seam) var(--overview-solid), transparent);
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
    inset-inline-start: var(--left-inset, var(--card-inset));
    width: calc(var(--panes-wide, 100%) - var(--left-inset, var(--card-inset)) - var(--right-inset, var(--card-inset)));
    display: flex;
    pointer-events: none;
  }
  .heads > :global(*) {
    flex: 1;
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
  .tabs .count {
    min-width: calc(var(--icon-lg) + 2px);
    height: calc(var(--icon-lg) + 2px);
    display: grid;
    place-items: center;
    padding: 0 2px;
    border: 1.5px solid currentColor;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: 1;
    font-variant-numeric: tabular-nums;
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
