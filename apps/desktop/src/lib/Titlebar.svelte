<script lang="ts">
  import { t } from './i18n.svelte'
  import { DIVIDER, menu } from './menu.svelte'
  import Tabs from './Tabs.svelte'
  import { currentWindow, isDesktop } from './tauri'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  let { onopennotes }: { onopennotes?: () => void } = $props()

  let maximized = $state(false)

  const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

  /** A phone shows one document, so the bar says which one. */
  const title = $derived(
    workspace.active
      ? workspace.active.name.replace(MARKDOWN, '') + (workspace.active.dirty ? ' ·' : '')
      : 'Nib',
  )

  /** What the tab strip and the rail offer on a desktop, where a phone has
   *  room for neither. */
  function overflow(event: MouseEvent) {
    menu.show(event, [
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('Open notes'), run: () => onopennotes?.() },
      DIVIDER,
      { label: t('Save'), disabled: !workspace.active?.dirty, run: () => void workspace.save() },
    ])
  }

  async function minimize() {
    if (isDesktop) (await currentWindow()).minimize()
  }

  async function toggleMaximize() {
    if (!isDesktop) return
    const win = await currentWindow()
    await win.toggleMaximize()
    maximized = await win.isMaximized()
  }

  async function close() {
    if (isDesktop) (await currentWindow()).close()
  }
</script>

<!-- One row: the sidebar toggle, the open notes, and the window's own buttons.
     The note's name lives in its tab, so there is no separate title. -->
<header>
  <button
    class="toggle"
    class:on={!!workspace.panel}
    title={workspace.panel ? t('Hide sidebar') : t('Show sidebar')}
    aria-label={workspace.panel ? t('Hide sidebar') : t('Show sidebar')}
    aria-pressed={!!workspace.panel}
    onclick={() => workspace.toggleSidebar()}
  >
    <svg viewBox="0 0 14 14">
      <rect x="1" y="2.5" width="12" height="9" rx="1.5" />
      <path d="M5.5 2.5v9" />
    </svg>
  </button>

  {#if viewport.phone}
    <!-- One document at a time, so its name goes here rather than a strip of
         tabs too narrow to read. The rest is behind the overflow. -->
    <h1 class="title">{title}</h1>

    <button class="more" onclick={overflow} aria-label={t('More')}>
      <svg viewBox="0 0 14 14"
        ><circle cx="7" cy="2.5" r="1.2" /><circle cx="7" cy="7" r="1.2" /><circle
          cx="7"
          cy="11.5"
          r="1.2"
        /></svg
      >
    </button>
  {:else}
    <Tabs />

    <!-- The empty stretch is what the window is dragged by. -->
    <div class="drag" data-tauri-drag-region></div>
  {/if}

  <!-- A page in a browser has no window of its own to minimise or close. -->
  <div class="controls" class:hidden={!isDesktop}>
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

  .toggle {
    width: 38px;
    flex: none;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  /* Only where there is a pointer to hover with. A touch browser pretends the
     last finger is still hovering, which left this lit after every swipe from
     the corner it sits in. */
  @media (hover: hover) {
    .toggle:hover {
      background: var(--surface-2);
      color: var(--text-strong);
    }
  }

  .toggle.on {
    color: var(--accent);
  }

  .toggle svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }

  .controls.hidden {
    display: none;
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

  /* The document's name, taking whatever room the two buttons leave. */
  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    align-self: center;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more {
    width: 48px;
    flex: none;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted-strong);
    cursor: default;
  }

  .more svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
    stroke: none;
  }

  /* A phone has no window to drag and a thumb to hit this with. The bar grows
     to a comfortable target and clears the status bar. */
  @media (max-width: 720px) {
    header {
      height: auto;
      padding-top: env(safe-area-inset-top);
    }

    .toggle {
      width: 52px;
      height: 48px;
    }

    .toggle svg {
      width: 22px;
      height: 22px;
    }

    .more {
      height: 48px;
    }

    .more svg {
      width: 22px;
      height: 22px;
    }
  }
</style>
