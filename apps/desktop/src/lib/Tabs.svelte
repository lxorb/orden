<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { carryTab, dragged, draggedTab, isTabDrag, isTreeDrag } from './drag-paths'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { copyPathEntry, DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import { rooms } from './rooms.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import { inside } from './workspace/zones'

  const { paneId }: { paneId: string } = $props()

  const pane = $derived(workspace.panes.at(paneId))
  const tabs = $derived(workspace.tabsIn(paneId))
  /** The pane that acts on the keyboard is marked here rather than by a border
   *  around the words: quietly, and where the tabs already say what is what. */
  const focused = $derived(workspace.panes.focusedId === paneId)
  const alone = $derived(workspace.panes.count < 2)
  /** Shown only where there is another pane on this note to scroll with. */
  const twinned = $derived(workspace.twins(paneId).length > 0)

  /** What a double click on the tab does, for a finger that cannot double
   *  click. Only offered while the tab is still a preview: once kept, there is
   *  nothing left to keep. */
  function keepEntry(tab: Tab): MenuEntry[] {
    if (tab.id !== workspace.previewTabId) return []
    return [{ label: t('Keep open'), run: () => workspace.keep(tab.id) }]
  }

  /** Beside, and below. Left out where the pane has split as far as it may,
   *  rather than offered as a row that does nothing. */
  function splitEntries(tab: Tab): MenuEntry[] {
    const entries: MenuEntry[] = []

    if (workspace.canSplit('row', tab.id)) {
      entries.push({
        label: t('Split right'),
        hint: shortcuts.hint('pane.split-right'),
        run: () => workspace.split('row', tab.id),
      })
    }
    if (workspace.canSplit('column', tab.id)) {
      entries.push({
        label: t('Split down'),
        hint: shortcuts.hint('pane.split-down'),
        run: () => workspace.split('column', tab.id),
      })
    }

    return entries.length ? [...entries, DIVIDER] : []
  }

  /** The note's other face. Not offered for the graph, which has only one. */
  function readingEntry(tab: Tab): MenuEntry[] {
    if (tab.kind !== 'note') return []

    return [
      {
        label: tab.reading ? t('Leave reading') : t('Reading'),
        hint: shortcuts.hint('app.reading'),
        run: () => workspace.toggleReading(tab.id),
      },
      DIVIDER,
    ]
  }

  /** Left out while nothing has been closed, rather than offered as a row that
   *  does nothing. */
  function reopenEntry(): MenuEntry[] {
    if (!workspace.closed.any) return []

    return [
      {
        label: t('Reopen closed tab'),
        hint: shortcuts.hint('app.reopen'),
        run: () => void workspace.reopenClosed(),
      },
    ]
  }

  function tabMenu(tab: Tab): MenuEntry[] {
    return [
      ...readingEntry(tab),
      {
        label: t('Close'),
        hint: shortcuts.hint('app.close'),
        run: () => void workspace.closeAsking(tab.id),
      },
      {
        label: t('Close others'),
        disabled: tabs.length < 2,
        run: () => void workspace.closeOthers(tab.id),
      },
      ...reopenEntry(),
      DIVIDER,
      ...splitEntries(tab),
      ...keepEntry(tab),
      DIVIDER,
      ...copyPathEntry(tab.path),
      ...revealEntry(tab.path),
    ]
  }

  const showMenu = (event: MouseEvent, tab: Tab) =>
    menu.show(event, tabMenu(tab), { title: tab.shown })

  /** Whether the drag over the panes is one this strip takes: a tab out of any
   *  strip, or notes out of the file list. */
  const takes = (transfer: DataTransfer | null) => isTabDrag(transfer) || isTreeDrag(transfer)

  /** Where in the strip the pointer is: before the tab it is over, or after it
   *  once past the middle. The gap after the last tab is the end of the strip. */
  function placeIn(event: DragEvent & { currentTarget: HTMLElement }, at: number): number {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX > box.left + box.width / 2 ? at + 1 : at
  }

  /** Marks the place between the tabs the drop would take. The pane underneath
   *  offers the whole of itself and its four sides, so the strip keeps the event
   *  to itself rather than letting the pane answer for it as well. */
  function over(event: DragEvent & { currentTarget: HTMLElement }, at: number) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    workspace.panes.landing = { kind: 'strip', paneId, at }
  }

  function drop(event: DragEvent & { currentTarget: HTMLElement }, at: number) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()

    const landing = { kind: 'strip', paneId, at } as const
    const id = draggedTab(event.dataTransfer)
    const paths = dragged(event.dataTransfer)

    workspace.panes.landing = null
    workspace.panes.dragging = null

    if (id) workspace.dropTab(id, landing)
    else if (paths.length) void workspace.dropNotes(paths, landing)
  }

  /** Where the mark between the tabs sits, or null while the drag is elsewhere. */
  const mark = $derived.by(() => {
    const landing = workspace.panes.landing
    return landing?.kind === 'strip' && landing.paneId === paneId ? landing.at : null
  })

  /** The dot says one of three things, and says it in words to a reader who
   *  cannot see it. A note in a space wears no dot at all: nothing about it is
   *  ever waiting to be written down. */
  function saveLabel(tab: Tab): string {
    const state = workspace.savingOf(tab)
    if (state === 'saving') return t('Saving')
    if (state === 'saved') return t('Saved')
    return t('Unsaved')
  }
</script>

<div class="strip">
  <!-- The whole strip takes a drop, so a tab dragged into it lands where it was
       let go of; past the last tab is the end of the strip. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tabs"
    class:quiet={!focused && !alone}
    ondragover={(event) => over(event, tabs.length)}
    ondragleave={(event) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (mark === null || inside(box, event.clientX, event.clientY)) return

      workspace.panes.landing = null
    }}
    ondrop={(event) => drop(event, tabs.length)}
  >
    {#each tabs as tab, at (tab.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={tab.id === pane?.activeTabId}
        class:preview={tab.id === workspace.previewTabId}
        class:before={mark === at}
        class:after={mark === tabs.length && at === tabs.length - 1}
        ondragover={(event) => over(event, placeIn(event, at))}
        ondrop={(event) => drop(event, placeIn(event, at))}
        transition:fly={{ y: -8, duration: 180, easing: cubicOut }}
      >
        <!-- A double click keeps a preview, the way VS Code does it. The two
             single clicks it is made of activate the tab twice, which costs
             nothing: activating the tab that is already active changes nothing.
             A long press stands in for the right click on a touch screen.
             Dragged, it goes along its own strip, into another pane's strip, or
             against a side of a pane to make one there. -->
        <button
          class="pick"
          draggable="true"
          title={tab.shown}
          onclick={() => workspace.activate(tab.id)}
          ondblclick={() => workspace.keep(tab.id)}
          oncontextmenu={(event) => showMenu(event, tab)}
          use:longPress={(event) => showMenu(event, tab)}
          ondragstart={(event) => {
            carryTab(event.dataTransfer, tab.id)
            workspace.panes.dragging = { tabId: tab.id }
          }}
          ondragend={() => {
            workspace.panes.dragging = null
            workspace.panes.landing = null
          }}
        >
          {#if tab.reading}
            <!-- An open book, quietly: the tab says which face of the note is up
                 without spending a word on it. -->
            <svg
              class="mark"
              viewBox="0 0 14 12"
              aria-label={t('Reading')}
              transition:fade={{ duration: 140 }}
            >
              <path d="M7 3.2v7.3M7 3.2C5.6 2 3.9 1.6 1.5 1.6v7.3c2.4 0 4.1.4 5.5 1.6" />
              <path d="M7 3.2c1.4-1.2 3.1-1.6 5.5-1.6v7.3c-2.4 0-4.1.4-5.5 1.6" />
            </svg>
          {/if}
          <!-- The name in an element of its own: a flex box draws no ellipsis on
               the text directly inside it, so the words were being cut through
               the middle of a letter. This is also the only part of the tab that
               gives way as the strip fills. -->
          <span class="label">{tab.shown}</span>
          <!-- Who else is in this note: one dot per other device, in the accent,
               and nothing at all while nobody is. No word, because the dots are
               already the whole sentence. -->
          {#if rooms.present[tab.note.key]}
            <span
              class="here"
              aria-label={t('Also open elsewhere')}
              title={t('Also open elsewhere')}
            >
              {#each { length: Math.min(rooms.present[tab.note.key] ?? 0, 3) } as _, at (at)}
                <span class="who" transition:fade={{ duration: 190 }}></span>
              {/each}
            </span>
          {/if}
          {#if tab.unsaved || workspace.savingOf(tab)}
            <span
              class="dot"
              class:writing={workspace.savingOf(tab) === 'saving'}
              class:down={workspace.savingOf(tab) === 'saved'}
              aria-label={saveLabel(tab)}
              title={saveLabel(tab)}
              transition:fade={{ duration: 190 }}
            ></span>
          {/if}
        </button>
        <button
          class="shut"
          title={t('Close')}
          aria-label={t('Close')}
          onclick={() => void workspace.closeAsking(tab.id)}
        >
          <svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>
    {/each}

    <button
      class="new"
      title={t('New note')}
      aria-label={t('New note')}
      onclick={() => {
        workspace.focusPane(paneId)
        workspace.openBlank()
      }}
    >
      <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg>
    </button>
  </div>

  <!-- Two links of a chain: this pane scrolls with the other one on the same
       note. Only there while there is another one. -->
  {#if twinned}
    <button
      class="link"
      class:on={pane?.linked}
      title={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-label={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-pressed={!!pane?.linked}
      onclick={() => workspace.toggleLink(paneId)}
    >
      <svg viewBox="0 0 14 14">
        <path
          d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
        />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* The room the tabs get. Measured from what they need (`auto`) and not from
     nothing: with a basis of zero the strip and the empty stretch it sits
     beside in the titlebar each took half the row, so the names were cut with
     half the bar standing empty. Grows into the rest of the row, gives it all
     back before the window controls do. */
  .strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1 1 auto;
  }

  /* Shrinks before the window controls do, and scrolls once it runs out. */
  .tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
    padding: 0 var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  /* The pane that is not being worked in says so by receding. Nothing is drawn
     around the words themselves; a line there is a line to read past. */
  .tabs.quiet {
    opacity: 0.55;
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

  .link {
    flex: none;
    align-self: center;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    margin: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .link:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .link:active {
    background: var(--press);
  }

  .link.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .link svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }

  /* Not selectable: a double click keeps the tab, and must not also paint
     its name blue the way it would any other text. */
  .tab {
    display: flex;
    align-items: center;
    position: relative;
    /* As wide as its name needs, capped at `--tab-name` by the name itself.
       Only once the strip is full do they give way, and never past
       `--tab-min`: below that the strip scrolls instead. */
    flex: 0 3 auto;
    min-width: var(--tab-min);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    user-select: none;
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      flex-shrink var(--dur-fast) var(--ease-out);
  }

  /* The tab being read gives way a third as fast as the rest, so the name of
     the note in front of you is the last one still worth reading. Eased, so
     that in a full strip the two tabs trade their width rather than swap it. */
  .tab.active {
    flex-shrink: 1;
  }

  .tab:hover {
    background: var(--surface-2);
  }

  /* The tab answers the click itself, before the note it holds has been laid
     out - which on a large note is the difference between prompt and slow. */
  .tab:active {
    background: var(--press);
  }

  /* Where a tab being dragged would land: a line down the edge it arrives at,
     the accent line the bookmarks draw for a row on its way somewhere. Drawn
     into the tab rather than beside it, so the underline the active tab wears
     underneath is left alone. */
  .tab.before {
    box-shadow: inset 2px 0 0 0 var(--accent);
  }

  .tab.after {
    box-shadow: inset -2px 0 0 0 var(--accent);
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

  /* In a pane nobody is writing in, the line is still there and no longer
     shouts: which pane the keys go to is the accent's job. */
  .tabs.quiet .tab.active::after {
    background: var(--muted);
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
    flex: 1 1 auto;
    min-width: 0;
    padding: 7px 4px 7px 10px;
    overflow: hidden;
    white-space: nowrap;
  }

  /* The name, and the whole of what a tab is as wide as. The dots and the book
     beside it keep their size; this is the part that shortens. */
  .label {
    min-width: 0;
    max-width: var(--tab-name);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab.active .pick {
    color: var(--text-strong);
  }

  /* Italic says the note is only being looked at, and that the next thing
     clicked in the file list will take this tab's place. */
  .tab.preview .pick {
    font-style: italic;
  }

  /* Before the name rather than after it, where the saving dot is: the two say
     different kinds of thing and should not be read as one pair. */
  .mark {
    width: 11px;
    height: 11px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
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

  /* One dot per other device in the note, stacked so they read as a small group
     rather than as a row of separate marks. Three at most: past that the answer
     is "several", and counting them is not what anyone is looking for. */
  .here {
    display: flex;
    flex: none;
    align-items: center;
    /* Overlapped by a third of themselves, which is what makes a stack. */
    margin-right: -2px;
  }

  .who {
    width: 5px;
    height: 5px;
    flex: none;
    margin-right: -2px;
    border-radius: 50%;
    background: var(--accent);
    /* A ring in the tab's own colour, so two dots against each other still read
       as two. */
    box-shadow: 0 0 0 1.5px var(--bg);
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
    flex: none;
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

  .shut svg {
    width: 7px;
    height: 7px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
</style>
