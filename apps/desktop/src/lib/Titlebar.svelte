<script lang="ts">
  import { chrome } from './glass/chrome.svelte'
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
  import Tabs from './Tabs.svelte'
  import { closeWindow, currentWindow, isDesktop, platform } from './tauri'
  import { settings } from './settings.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { webChannel } from './updater'
  import { viewport } from './viewport.svelte'
  import { WindowState } from './window-state.svelte'
  import { workspace } from './workspace.svelte'

  const { onpalette }: { onpalette: () => void } = $props()

  /** What the middle button says. Read off the window itself rather than off its
   *  own clicks, because dragging a maximised window off the top of the screen
   *  restores it too; see window-state.svelte.ts. */
  const shape = new WindowState()
  const maximized = $derived(shape.maximized)

  /** A Mac keeps its own traffic lights at the top left of every window, and its
   *  menu in the bar at the top of the screen, so the bar draws neither: VS Code's
   *  and Obsidian's shape on a Mac. What it keeps is room for the lights, except in
   *  full screen, where the system takes them away. See launch.rs. */
  const mac = isDesktop && platform() === 'macos'
  const lights = $derived(mac && modes.frame === 'nib' && !shape.fullscreen)

  /** Said on the root, because the lights sit over whatever is in the window's top
   *  left corner: this bar, or the sidebar's head while the panel is docked open
   *  beside it, which is where Obsidian has them. See Sidebar.svelte. */
  $effect(() => {
    if (lights) document.documentElement.dataset.lights = ''
    else delete document.documentElement.dataset.lights
  })

  /** Nothing yet for the file list to show: no space, and no tab either. */
  const listless = $derived(
    workspace.restored && !workspace.spaces.length && !workspace.tabs.length,
  )

  /** Whether the lights are over this bar rather than over the docked panel. They are
   *  at the window's left however the words run, and with the words running right to
   *  left the panel docks at the right, so the corner is this bar's either way. */
  const cornered = $derived(
    lights && (i18n.direction === 'rtl' || !(workspace.panel && !viewport.drawer)),
  )

  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))

  /** The one pane, while there is only one or one fills the window. Null once
   *  something is split, and then the strips live in the panes. */
  const only = $derived(
    workspace.panes.count === 1 || workspace.panes.fills ? workspace.panes.focused : null,
  )

  /** A phone and a tablet show one document, so the bar says which one. The mark in
   *  front of the name is the same one the desktop's tab wears, because this bar is
   *  that strip on a screen that holds one document; see TabMark.svelte. */
  const title = $derived(pad.on ? t('Scratchpad') : (workspace.active?.shown ?? 'Orden'))
  /** None while the scratchpad, which is no tab, is the note there; see scratchpad/pad.ts. */
  const showing = $derived(viewport.touch && pad.on ? null : workspace.active)

  async function minimize() {
    if (isDesktop) await (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    await shape.toggle(await currentWindow())
  }
</script>

<!-- The edge of `unstable` running in this browser rather than the release, said in the
     one bar that is always there, beside the switches at its end, and a press from the
     row in Settings that goes back (#424). Never in the release, nor in the desktop and
     phone apps. -->
{#snippet edgeMark()}
  {#if !__EVEN_PLUGIN__ && webChannel === 'unstable'}
    <button class="channel" title={t('Web version')} onclick={() => settings.show('general')}>
      {t('Unstable')}
    </button>
  {/if}
{/snippet}

<!-- The scratchpad's switch. It leaves the keyboard where it is, and has no menu: the
     scratchpad is in no space, so nothing a tab's or a file's menu offers is its; see
     scratchpad/pad.ts. -->
{#snippet padGlyph()}
  {#if !__EVEN_PLUGIN__}
    <button
      class="nib-glyph pad"
      class:is-on={pad.on}
      aria-pressed={pad.on}
      title={shortcuts.tooltip(t('Scratchpad'), 'app.scratchpad')}
      aria-label={t('Scratchpad')}
      onpointerdown={keepFocus}
      onmousedown={keepFocus}
      onclick={() => pad.toggle()}
    >
      <svg viewBox="0 0 14 14"
        ><rect x="2.5" y="2.5" width="9" height="10" rx="1.6" /><path
          d="M5 1.2v2.6M9 1.2v2.6M4.9 7h4.2M4.9 9.6h2.8"
        /></svg
      >
    </button>
  {/if}
{/snippet}

<!-- The palette, for a hand that does not know its keys; the tooltip says them (#304).
     It keeps the keyboard where it was, for the palette to hand back. -->
{#snippet searchGlyph()}
  <button
    class="nib-glyph search"
    title={shortcuts.tooltip(t('Search'), 'app.palette')}
    aria-label={t('Search notes and commands')}
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={() => onpalette()}
  >
    <svg viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
  </button>
{/snippet}

<!-- One row: the palette, the button that opens the file list, the open notes, and
     the window's own buttons. On a desktop the note's name lives in its tab, so there
     is no separate title; a phone and a tablet hold one document, so the name is the
     middle of the row and the palette is at the end of it. No menu of the whole app:
     what it held is the palette's, a note's dots and the strip's (#304). -->
<header class:lights={cornered} data-chrome="top" data-theme={chrome.theme}>
  {#if !viewport.touch}
    {@render searchGlyph()}
  {/if}

  <!-- Not while there is no space and no tab: a list of nothing, in the moment before a
       fresh start's space is made (fresh-start.ts). -->
  {#if !listless}
    <SidebarToggle />
  {/if}

  {#if viewport.touch}
    <!-- One document at a time: its mark and name instead of a strip of tabs. -->
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
    {@render padGlyph()}
  {:else}
    <!-- One pane keeps its tabs up here; split, each pane has its own (Pane.svelte). -->
    {#if only}
      <Tabs paneId={only.id} caption />
    {/if}

    <!-- What the window is dragged by; a sliver beside a strip, whose own empty
         stretch is the caption too (Tabs.svelte). Then the scratchpad's switch. -->
    <div class="drag" class:sliver={!!only} data-tauri-drag-region></div>
    {@render edgeMark()}
    {@render padGlyph()}
  {/if}

  <!-- The other side's own button, while that side holds a panel. -->
  {#if workspace.right.length}
    <SidebarToggle side="right" />
  {/if}

  <!-- Left out, not hidden, in a browser (no window of its own) and under the
       system's own frame (which has these three already); see modes.svelte.ts. -->
  {#if isDesktop && !mac}
    {#if modes.frame === 'nib'}
      <div class="controls">
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
</header>

<style>
  /* A step in from the edge, because the first thing in this row is a button and
     a button against the window's own border reads as cramped rather than as
     flush. Only the leading edge: the other end is the window's own buttons,
     which go right to the corner the way every window's do. */
  header {
    height: var(--header-height);
    display: flex;
    align-items: stretch;
    flex: none;
    padding-inline-start: var(--space-1);
    user-select: none;
    -webkit-user-select: none;
    /* The frame the tabs are cut out of, and the hairline between it and the page.
       The line is drawn inside the bar rather than under it, so the active tab -
       which runs down to the bottom of the bar - covers it and becomes one surface
       with what is below: Chrome's active tab. See Tabs.svelte. */
    background: var(--tab-frame);
    box-shadow: inset 0 -1px var(--line);
  }

  /* With tabs in it, the strip draws the line, leaving the open tab out. */
  header:has(:global([data-region='tabs'])) {
    box-shadow: none;
    overflow-x: clip;
  }

  /* The three lights and the gap after them, the room a Mac's own apps leave. On the
     left whichever way the words run: the lights are the system's, about the screen
     rather than about reading, and AppKit keeps them at the window's left edge. */
  header.lights {
    padding-left: var(--traffic-lights);
  }

  .pad,
  .search {
    align-self: center;
  }

  /* Small and quiet, in the accent: a note on which build this is, not an alarm. */
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

  .drag.sliver {
    flex: none;
    width: var(--space-5);
  }

  /* Placed, so a lit button is drawn over the strip's line. */
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

  /* The document's name, taking whatever room the two buttons leave, with its
     mark in front of it the way every list in the app puts one. */
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

  /* The one part of the bar that gives way: a long name is cut, the mark and the
     buttons either side of it are not. */
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* A phone has no window to drag and a thumb to hit this with. The bar grows
     to a comfortable target and clears the status bar. */
  :global([data-touch]) header {
    height: auto;
    /* No tabs to cut out of the frame on a phone: the bar is the page's own ground,
       as it always was. */
    background: none;
    /* Under the clock and battery, and clear of a cutout on the side a tablet
       held sideways puts it. */
    padding-top: var(--inset-top);
    padding-inline-end: var(--inset-end);
    /* A phone's own inset already steps this row in, and it is the larger of the
       two; the desktop's hairline would only fight it. */
    padding-inline-start: var(--inset-start);
  }
</style>
