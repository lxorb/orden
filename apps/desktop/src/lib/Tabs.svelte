<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { copyPathEntry, DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  /** What a double click on the tab does, for a finger that cannot double
   *  click. Only offered while the tab is still a preview: once kept, there is
   *  nothing left to keep. */
  function keepEntry(tab: Tab): MenuEntry[] {
    if (tab.id !== workspace.previewTabId) return []
    return [{ label: t('Keep open'), run: () => workspace.keep(tab.id) }]
  }

  function tabMenu(tab: Tab): MenuEntry[] {
    return [
      { label: t('Close'), hint: 'Ctrl W', run: () => workspace.close(tab.id) },
      {
        label: t('Close others'),
        disabled: workspace.tabs.length < 2,
        run: () => {
          for (const other of workspace.tabs.filter((entry) => entry.id !== tab.id)) {
            workspace.close(other.id)
          }
        },
      },
      DIVIDER,
      ...keepEntry(tab),
      DIVIDER,
      ...copyPathEntry(tab.path),
      ...revealEntry(tab.path),
    ]
  }

  const showMenu = (event: MouseEvent, tab: Tab) =>
    menu.show(event, tabMenu(tab), { title: stripped(tab.name) })

  /** The dot says one of three things, and says it in words to a reader who
   *  cannot see it. */
  function saveLabel(tab: Tab): string {
    const state = workspace.saveState[tab.id]
    if (state === 'saving') return t('Saving')
    if (state === 'saved') return t('Saved')
    return t('Unsaved')
  }
</script>

<div class="tabs">
  {#each workspace.tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tab.id === workspace.activeTabId}
      class:preview={tab.id === workspace.previewTabId}
      transition:fly={{ y: -8, duration: 180, easing: cubicOut }}
    >
      <!-- A double click keeps a preview, the way VS Code does it. The two
           single clicks it is made of activate the tab twice, which costs
           nothing: activating the tab that is already active changes nothing.
           A long press stands in for the right click on a touch screen. -->
      <button
        class="pick"
        onclick={() => workspace.activate(tab.id)}
        ondblclick={() => workspace.keep(tab.id)}
        oncontextmenu={(event) => showMenu(event, tab)}
        use:longPress={(event) => showMenu(event, tab)}
      >
        {stripped(tab.name)}
        {#if tab.dirty || workspace.saveState[tab.id]}
          <span
            class="dot"
            class:writing={workspace.saveState[tab.id] === 'saving'}
            class:down={workspace.saveState[tab.id] === 'saved'}
            aria-label={saveLabel(tab)}
            title={saveLabel(tab)}
            transition:fade={{ duration: 190 }}
          ></span>
        {/if}
      </button>
      <button class="shut" title={t('Close')} aria-label={t('Close')} onclick={() => workspace.close(tab.id)}>
        <svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" /></svg>
      </button>
    </div>
  {/each}

  <button class="new" title={t('New note')} aria-label={t('New note')} onclick={() => workspace.openBlank()}>
    <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg>
  </button>
</div>

<style>
  /* Shrinks before the window controls do, and scrolls once it runs out. */
  .tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-width: 0;
    padding: 0 var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .new {
    flex: none;
    align-self: center;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    margin-left: 2px;
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .new:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .new:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .new svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /* Not selectable: a double click keeps the tab, and must not also paint
     its name blue the way it would any other text. */
  .tab {
    display: flex;
    align-items: center;
    position: relative;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    user-select: none;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .tab:hover {
    background: var(--surface-2);
  }

  /* The tab answers the click itself, before the note it holds has been laid
     out - which on a large note is the difference between prompt and slow. */
  .tab:active {
    background: var(--press);
  }

  /* The active tab is marked by a line that slides in, not by a label. */
  .tab.active::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 2px;
    background: var(--accent);
    animation: underline var(--dur-base) var(--ease-out);
  }

  @keyframes underline {
    from {
      transform: scaleX(0);
    }
  }

  button {
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 15rem;
    padding: 7px 4px 7px 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab.active .pick {
    color: var(--text-strong);
  }

  /* Italic says the note is only being looked at, and that the next thing
     clicked in the file list will take this tab's place. */
  .tab.preview .pick {
    font-style: italic;
  }

  /* The whole report on saving: unwritten, going down, down. Colour and a
     breath of movement rather than a spinner - it is ambient, not an event. */
  .dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .dot.writing {
    animation: breathe 900ms var(--ease-in-out) infinite;
  }

  .dot.down {
    background: var(--success);
    transform: scale(0.8);
  }

  @keyframes breathe {
    50% {
      opacity: 0.35;
    }
  }

  /* Movement is a preference, and a dot that pulses forever is exactly what
     it is about. The colour still says which state it is in. */
  @media (prefers-reduced-motion: reduce) {
    .dot.writing {
      animation: none;
      opacity: 0.55;
    }
  }

  .shut {
    display: grid;
    place-items: center;
    width: 20px;
    height: 100%;
    padding: 0 6px 0 0;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .tab:hover .shut,
  .shut:focus-visible {
    opacity: 1;
  }

  .shut:hover {
    color: var(--danger);
  }

  .shut:active {
    color: color-mix(in srgb, var(--danger) 78%, black);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  svg {
    width: 7px;
    height: 7px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
</style>
