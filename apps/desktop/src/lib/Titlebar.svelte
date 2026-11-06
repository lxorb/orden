<script lang="ts">
  import { swipeOpens } from './swipe-opens'
  import { chrome } from './glass/chrome.svelte'
  import { edgePeek, endPeek } from './edge-peek.svelte'
  import { sideToggles } from './side-toggles.svelte'
  import { i18n, t } from './i18n.svelte'
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
  import { settings } from './settings.svelte'
  import { tabOverview, toggleTabOverview } from './surfaces.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { startup } from './startup.svelte'
  import { webChannel } from './updater'
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

  $effect(() => {
    if (swiped && workspace.openOn('left')) {
      void import('./hints.svelte').then(({ hints }) => hints.dismiss('drawer'))
    }
  })

  $effect(() => {
    if (edgePeek.out || endPeek.out) {
      void import('./hints.svelte').then(({ hints }) => hints.dismiss('edge'))
    }
  })

  const shape = new WindowState()
  const maximized = $derived(shape.maximized)

  const mac = isDesktop && platform() === 'macos'
  const lights = $derived(mac && modes.frame === 'nib' && !shape.fullscreen)

  $effect(() => {
    if (lights) document.documentElement.dataset.lights = ''
    else delete document.documentElement.dataset.lights
  })

  const listless = $derived(
    workspace.restored && !workspace.spaces.length && !workspace.tabs.length,
  )

  const cornered = $derived(
    lights && (i18n.direction === 'rtl' || !(workspace.panel && !viewport.drawer)),
  )
  const bare = $derived(
    !(isDesktop && !mac && modes.frame === 'nib') && !(cornered && i18n.direction === 'rtl'),
  )

  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))

  const only = $derived(
    workspace.panes.count === 1 || workspace.panes.fills ? workspace.panes.focused : null,
  )
  const strips = $derived(only ?? topRow(workspace.panes.frame))

  let wide = $state(0)
  let leadWide = $state(0)
  let endWide = $state(0)
  const overPanes = $derived(endWide - wide + (panes || wide))

  const title = $derived(pad.on ? t('Scratchpad') : (workspace.active?.shown ?? 'Orden'))
  const showing = $derived(viewport.touch && pad.on ? null : workspace.active)

  async function minimize() {
    if (isDesktop) await (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    await shape.toggle(await currentWindow())
  }
</script>

{#snippet edgeMark()}
  {#if !__EVEN_PLUGIN__ && webChannel === 'unstable'}
    <button
      class="channel"
      data-overview-keeps
      title={t('Web version')}
      onclick={() => settings.show('general')}
    >
      {t('Unstable')}
    </button>
  {/if}
{/snippet}

{#snippet searchGlyph()}
  <button
    class="nib-glyph search"
    data-overview-keeps
    title={shortcuts.tooltip(t('Search'), 'app.palette')}
    aria-label={t('Search notes and commands')}
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={() => onpalette()}
  >
    <svg viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
  </button>
{/snippet}

{#snippet overviewGlyph()}
  <button
    class="nib-glyph overview"
    data-overview-keeps
    class:is-on={tabOverview.open}
    aria-pressed={tabOverview.open}
    title={shortcuts.tooltip(t('Tabs'), 'app.tab-overview')}
    aria-label={t('Tabs')}
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
  {:else if !sideToggles.inside}
    {#if workspace.right.length || !__EVEN_PLUGIN__}
      <SidebarToggle side="right" />
    {/if}
  {:else if (workspace.right.length || !__EVEN_PLUGIN__) && workspace.rightShows === null}
    <SidebarToggle side="right" unseen />
  {/if}
{/snippet}

{#snippet windowButtons()}
  {#if isDesktop && !mac}
    {#if modes.frame === 'nib'}
      <div class="controls" data-overview-keeps>
        <button onclick={minimize} aria-label={t('Minimize')}>
          <svg viewBox="0 0 10 10"><path d="M0 5h10" /></svg>
        </button>
        <button onclick={toggleMaximize} aria-label={maximized ? t('Restore') : t('Maximize')}>
          {#if maximized}
            <svg viewBox="0 0 10 10"><path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" /></svg>
          {:else}
            <svg viewBox="0 0 10 10"><path d="M0.5 0.5h9v9h-9z" /></svg>
          {/if}
        </button>
        <button
          class="close"
          onclick={closeWindow}
          title={shortcuts.tooltip(t('Close'), 'app.close-window')}
          aria-label={t('Close')}
        >
          <svg viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        </button>
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet leftToggle()}
  {#if !listless && (viewport.touch || !sideToggles.inside || !workspace.openOn('left'))}
    <SidebarToggle unseen={swiped || (!viewport.touch && sideToggles.inside)} />
    {#if swiped && startup.settled && !__EVEN_PLUGIN__}
      <span class="swipe-hint">
        {#await import('./HintCard.svelte') then card}
          <card.default
            hint="drawer"
            side="below"
            text={t('Swipe in from the edge to see your notes.')}
            onpress={() => workspace.toggleSidebar()}
          />
        {/await}
      </span>
    {/if}
  {/if}
  {#if !viewport.touch && sideToggles.inside && !listless && startup.settled && !__EVEN_PLUGIN__}
    <span class="swipe-hint">
      {#await import('./HintCard.svelte') then card}
        <card.default
          hint="edge"
          side="below"
          when={!workspace.openOn('left')}
          text={t('Point at the edge of the window to see your notes.')}
          onpress={() => workspace.toggleSidebar()}
        />
      {/await}
    </span>
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
    : `max(0px, calc(${overPanes}px + var(--lights-end, 0px) - var(--card-inset)))`}
>
  {#if viewport.touch}
    {@render leftToggle()}

    <h1 class="title" data-save-anchor>
      {#if showing}<TabMark tab={showing} />{:else if pad.on}<FileMark mark="note" />{/if}
      <span class="name">{title}</span>
      {#if showing && isDraft(showing.note)}
        <button class="nib-glyph" aria-label={t('Save')} onclick={() => askPlace(showing.id)}
          ><UnsavedDot pressable /></button
        >
      {/if}
    </h1>

    {@render edgeMark()}
    {@render searchGlyph()}
    {@render rightToggle()}
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
      {@render edgeMark()}
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
    background: var(--tab-frame);
    box-shadow: inset 0 -1px var(--chrome-seam);
  }

  header:has(:global([data-region='tabs'])) {
    box-shadow: none;
    overflow-x: clip;
  }

  header.lights {
    padding-left: var(--traffic-lights);
    --lights-start: var(--traffic-lights);
  }

  :global([dir='rtl']) header.lights {
    --lights-start: 0px;
    --lights-end: var(--traffic-lights);
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

  .channel {
    flex: none;
    align-self: center;
    margin-inline-end: var(--space-1);
    padding: 1px 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 999px;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: 1.4;
    white-space: nowrap;
    cursor: default;
  }

  @media (hover: hover) {
    .channel:hover {
      background: var(--accent-soft);
    }
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
    padding-inline-end: var(--inset-end);
    padding-inline-start: calc(var(--inset-start) + (var(--row-height) - var(--icon-lg)) / 2);
  }

  :global([data-touch]) header:has(> :global([data-side-toggle='left']:not(.nib-said))) {
    padding-inline-start: var(--inset-start);
  }
</style>
