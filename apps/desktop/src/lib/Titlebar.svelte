<script lang="ts">
  import type { EditorView } from '@nib/editor'
  import AppMenu from './AppMenu.svelte'
  import FileMark from './FileMark.svelte'
  import { markOf } from './file-mark'
  import { t } from './i18n.svelte'
  import SidebarToggle from './SidebarToggle.svelte'
  import Tabs from './Tabs.svelte'
  import { currentWindow, isDesktop } from './tauri'
  import { viewport } from './viewport.svelte'
  import { WindowState } from './window-state.svelte'
  import { workspace } from './workspace.svelte'

  const {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView | undefined; onpalette: () => void; onhistory: () => void } = $props()

  /** What the middle button says. Read off the window itself rather than off its
   *  own clicks, because dragging a maximised window off the top of the screen
   *  restores it too; see window-state.svelte.ts. */
  const shape = new WindowState()
  const maximized = $derived(shape.maximized)

  $effect(() => (isDesktop ? shape.follow(currentWindow) : undefined))

  /** The one pane, while there is only one. Null once something is split, and
   *  then the strips live in the panes. */
  const only = $derived(workspace.panes.count === 1 ? workspace.panes.focused : null)

  /** A phone and a tablet show one document, so the bar says which one, with the
   *  mark its kind wears in every list that shows it and the dot that says
   *  something in it is not written down yet. */
  const title = $derived(
    workspace.active ? workspace.active.shown + (workspace.active.unsaved ? ' ·' : '') : 'Nib',
  )
  const mark = $derived(workspace.active ? markOf(workspace.active.kind) : null)

  async function minimize() {
    if (isDesktop) await (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    await shape.toggle(await currentWindow())
  }

  async function close() {
    if (isDesktop) await (await currentWindow()).close()
  }
</script>

<!-- One row: the sidebar toggle, the open notes, and the window's own buttons.
     On a desktop the note's name lives in its tab, so there is no separate
     title; a phone and a tablet hold one document, so the name is the middle of
     the row and the whole of the app is behind the dots at the end of it. -->
<header>
  <SidebarToggle />

  {#if viewport.touch}
    <!-- One document at a time, so its name goes here rather than a strip of
         tabs too narrow to read: the mark for what it is, and what it is called.
         The rest is behind the three dots. -->
    <h1 class="title">
      {#if mark}<FileMark {mark} />{/if}
      <span class="name">{title}</span>
    </h1>

    <!-- Everything the desktop's menu bar holds, as one menu with its groups and
         their submenus: the same rows, the same order, asked for with the three
         dots a phone puts at this end of a bar. See AppMenu.svelte. -->
    <AppMenu {view} {onpalette} {onhistory} dots />
  {:else}
    <!-- One pane keeps its tabs up here, where a browser puts them. Split, each
         pane carries its own strip instead, so which tabs belong to which pane
         is never a question; see Pane.svelte. -->
    {#if only}
      <Tabs paneId={only.id} />
    {/if}

    <!-- The empty stretch is what the window is dragged by. -->
    <div class="drag" data-tauri-drag-region></div>
  {/if}

  <!-- A page in a browser has no window of its own to minimise or close, so it
       has none of these. Left out rather than hidden: three buttons a stylesheet
       hides are still three buttons a screen reader reads out and a key reaches. -->
  {#if isDesktop}
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
      <button class="close" onclick={close} aria-label={t('Close')}>
        <svg viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
      </button>
    </div>
  {/if}
</header>

<style>
  header {
    height: var(--titlebar-height);
    display: flex;
    align-items: stretch;
    flex: none;
    user-select: none;
    border-bottom: 1px solid var(--line);
  }

  .drag {
    flex: 1;
    min-width: var(--space-5);
  }

  .controls {
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
      background: var(--surface-2);
      color: var(--text-strong);
    }

    .controls button.close:hover {
      background: var(--danger);
      color: #fff;
    }
  }

  .controls button:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .controls button.close:active {
    background: color-mix(in srgb, var(--danger) 82%, black);
    color: #fff;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
    gap: var(--touch-gap);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 600;
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
    /* Under the clock and battery, and clear of a cutout on the side a tablet
       held sideways puts it. */
    padding-top: var(--inset-top);
    padding-right: var(--inset-right);
  }

  /* The note's name is the one thing on the bar to read, at the size everything
     else here is read at. The two buttons either side of it are sized where they
     are drawn: SidebarToggle.svelte and AppMenu.svelte. */
  :global([data-touch]) .title {
    font-size: var(--touch-text);
  }
</style>
