<script lang="ts">
  import { dragged, isTreeDrag } from './drag-paths'
  import { account } from './account.svelte'
  import AppMenu from './AppMenu.svelte'
  import type { EditorView } from '@nib/editor'
  import IconPicker from './IconPicker.svelte'
  import { type IconNode, loadIcons } from './icons'
  import { longPress } from './longpress'
  import { t } from './i18n.svelte'
  import { DIVIDER, menu, type MenuEntry, revealEntry, trim } from './menu.svelte'
  import { deleteSpace, moveSpace, newSpace, renameSpace, shareSpace } from './space-actions'
  import { settings } from './settings.svelte'
  import { canShare, isShared, roleOf } from './sharing.svelte'
  import { sync } from './sync.svelte'
  import { SOURCE_URL } from './app-menu'
  import { openExternal } from './tauri'
  import { type Space, workspace } from './workspace.svelte'
  import { theme } from './theme.svelte'

  const {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView | undefined; onpalette: () => void; onhistory: () => void } = $props()

  /** The icon sheet, once it is on the page. */
  let picker = $state<{ choose(id: string): Promise<void> }>()

  /** The settings button doubles as the sync light, so its tooltip says what
   *  the light means rather than leaving a colour to be guessed at. */
  function syncTitle(): string {
    if (sync.status === 'syncing') return t('Syncing')
    if (sync.status === 'error') return sync.lastError ?? t('Sync failed')
    return t('Settings')
  }
  /** Filled once any space has an icon, so the rail can draw them. */
  let library = $state<Record<string, IconNode>>({})

  /** The space being dragged, and the gap the line is drawn in. `null` for the
   *  gap under the last space, which is where a drop past the end lands. */
  let dragging = $state<string | null>(null)
  let gap = $state<string | null | undefined>(undefined)
  /** The space a note from the explorer is being held over. */
  let receiving = $state<string | null>(null)
  /** The name to show beside the rail, and how far down to put it. Rendered
   *  outside the scrolling column on purpose: a label sticking out of a box
   *  that scrolls makes the box scrollable sideways, and a drag near the edge
   *  would then slide every space out of sight. */
  let label = $state<{ name: string; y: number } | null>(null)

  function showLabel(event: MouseEvent, name: string) {
    const button = event.currentTarget as HTMLElement
    const bar = button.closest('nav')
    if (!bar) return

    const box = button.getBoundingClientRect()
    label = { name, y: box.top - bar.getBoundingClientRect().top + box.height / 2 }
  }

  function start(event: DragEvent, id: string) {
    dragging = id
    if (!event.dataTransfer) return

    event.dataTransfer.effectAllowed = 'move'
    // Firefox starts no drag at all unless something is on the clipboard.
    event.dataTransfer.setData('text/plain', id)
  }

  /** Two drags land here. A note from the explorer goes into a space; a space
   *  goes beside one, in front of it above the middle and after it below. */
  function over(event: DragEvent, id: string, next: string | null) {
    if (isTreeDrag(event.dataTransfer)) {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      receiving = id
      return
    }

    if (!dragging) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    gap = event.clientY < box.top + box.height / 2 ? id : next
  }

  /** `dragleave` also fires when the pointer moves onto a child - the label
   *  inside a row, the icon inside a space - and the `dragover` that follows
   *  sets it straight back. That off-on-off is the flicker. Geometry settles
   *  it: still inside the box means still over the thing. */
  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    )
  }

  function drop(event: DragEvent, space: Space) {
    event.preventDefault()

    const notes = dragged(event.dataTransfer)
    if (notes.length) void workspace.moveMany(notes, space.root)
    else if (dragging && gap !== undefined) void moveSpace(dragging, gap)

    stop()
  }

  function stop() {
    dragging = null
    gap = undefined
    receiving = null
  }

  /** The same menu whether it was asked for with a right click or a held
   *  finger, so a phone is not missing what a desktop offers. */
  function spaceMenu(space: Space): MenuEntry[] {
    // A space somebody shared to read is theirs; the only thing this menu can
    // offer about it is a way out of it.
    const mine = roleOf(space.root) !== 'read'
    const theirs = roleOf(space.root) !== 'owner'

    return trim([
      ...(mine ? [{ label: t('New note'), run: () => void workspace.createNote(space.root) }] : []),
      ...(theirs ? [] : [{ label: t('Rename'), run: () => void renameSpace(space) }]),
      { label: t('Choose an icon'), run: () => void picker?.choose(space.id) },
      ...(canShare(space) ? [{ label: t('Share'), run: () => void shareSpace(space) }] : []),
      ...revealEntry(space.root),
      DIVIDER,
      {
        label: theirs ? t('Leave space') : t('Delete space'),
        danger: true,
        run: () => void deleteSpace(space),
      },
    ])
  }

  function initial(name: string): string {
    const first = name.trim().codePointAt(0)
    return first === undefined ? '·' : String.fromCodePoint(first).toUpperCase()
  }

  const icon = (id: string) => {
    const name = workspace.iconFor(id)
    return name ? (library[name] ?? null) : null
  }

  // Only worth loading the set once a space actually uses one.
  $effect(() => {
    if (Object.keys(workspace.device.icons).length && !Object.keys(library).length) {
      void loadIcons().then((all) => (library = all))
    }
  })
</script>

<nav>
  <!-- Above the spaces and set apart from them: this is the whole application,
       not one more place to keep notes. -->
  <div class="top">
    <AppMenu {view} {onpalette} {onhistory} />
  </div>

  <div class="spaces">
    {#each workspace.spaces as space, index (space.id)}
      {@const glyph = icon(space.id)}
      <button
        class="space"
        class:active={space.id === workspace.activeSpaceId}
        class:dragging={space.id === dragging}
        class:before={gap === space.id}
        class:after={gap === null && index === workspace.spaces.length - 1}
        class:receiving={receiving === space.id}
        title={space.name}
        aria-label={space.name}
        aria-current={space.id === workspace.activeSpaceId}
        draggable="true"
        ondragstart={(event) => start(event, space.id)}
        ondragover={(event) => over(event, space.id, workspace.spaces[index + 1]?.id ?? null)}
        ondragleave={(event) => stillInside(event) || (receiving = null)}
        ondrop={(event) => drop(event, space)}
        ondragend={stop}
        onclick={() => workspace.showSpace(space.id)}
        onmouseenter={(event) => showLabel(event, space.name)}
        onmouseleave={() => (label = null)}
        oncontextmenu={(event) => menu.show(event, spaceMenu(space), { title: space.name })}
        use:longPress={(event) => menu.show(event, spaceMenu(space), { title: space.name })}
      >
        {#if glyph}
          <svg class="glyph" viewBox="0 0 24 24">
            {#each glyph as [tag, attrs] (JSON.stringify(attrs))}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
        {:else}
          {initial(space.name)}
        {/if}

        <!-- Somebody else is in this space. The same stack of dots a tab draws
             for the devices in a note, because it is the same fact said about a
             space: not only yours. -->
        {#if isShared(space.root)}
          <span class="with" aria-hidden="true">
            <span class="who"></span>
            <span class="who"></span>
          </span>
        {/if}
      </button>
    {/each}

    <!-- The rail is the list of spaces, so its plus makes one. New notes are
         made from the plus beside the tabs. -->
    <button
      class="add"
      title={t('New space')}
      aria-label={t('New space')}
      onclick={() => newSpace()}
    >
      <svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
    </button>
  </div>

  {#if label}
    <span class="name" style:top="{label.y}px">{label.name}</span>
  {/if}

  <div class="foot">
    <!-- Sliders, not a cog: the cog reads as the sun in the theme button.
         Signing in comes first, so the rail offers nothing else until then;
         Ctrl+, still opens settings for anyone who wants them sooner. -->
    {#if account.signedIn}
      <!-- Syncing happens on its own and mostly wants no attention, so its
           only ambient sign is a mark on the button that leads to it: lit
           while a pass is running, red when the last one failed. -->
      <button
        class="add"
        class:syncing={sync.status === 'syncing'}
        class:failed={sync.status === 'error'}
        title={syncTitle()}
        aria-label={t('Settings')}
        onclick={() => settings.show()}
      >
        <!-- An actual gear: eight teeth around a hub. -->
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.2" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    {/if}

    <!-- Signing in is the only thing this button is for, so once there is an
         account it has nothing left to do; the settings sheet owns it.

         It also waits while the stores are still being asked. Signed out and
         not known yet are different states, and on a phone the difference is
         the seconds the phone app takes to answer: a form offered inside them
         is a session typed in again for nothing. -->
    {#if !account.signedIn}
      <button
        class="add account"
        class:looking={account.restoring}
        title={t('Sign in')}
        aria-label={t('Sign in')}
        disabled={account.restoring}
        onclick={() => (account.open = true)}
      >
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
        >
      </button>
    {/if}

    <button
      class="add"
      title={theme.current === 'dark' ? t('Light') : t('Dark')}
      aria-label={t('Switch theme')}
      onclick={() => theme.toggle()}
    >
      {#if theme.current === 'dark'}
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="7" r="3" /><path
            d="M7 0v2M7 12v2M0 7h2M12 7h2M2.5 2.5l1.4 1.4M10.1 10.1l1.4 1.4M11.5 2.5l-1.4 1.4M3.9 10.1l-1.4 1.4"
          /></svg
        >
      {:else}
        <svg viewBox="0 0 14 14"
          ><path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" /></svg
        >
      {/if}
    </button>

    <!-- The code behind the app, for anyone curious: opened outside, in the
         browser, since the app has no page of its own to show it on. -->
    <button
      class="add"
      title={t('Source code')}
      aria-label={t('Source code')}
      onclick={() => void openExternal(SOURCE_URL)}
    >
      <svg class="mark" viewBox="0 0 16 16">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    </button>
  </div>
</nav>

<IconPicker bind:this={picker} />

<style>
  nav {
    position: relative;
    width: var(--rail-width);
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-2) 0 var(--space-3);
    gap: var(--space-2);
    border-right: 1px solid var(--line);
    background: var(--surface);
  }

  /* Its own row with a rule under it, so the menu reads as belonging to the
     app rather than being the first space in the list. */
  .top {
    flex: none;
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-1);
    border-bottom: 1px solid var(--line);
  }

  .spaces {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-height: 0;
    /* Room either side for a space to grow under the pointer. Scrolling this
       column clips whatever leaves it, so the growth has to happen inside. */
    padding: 0 6px;
    overflow-y: auto;
    /* Nothing in here may stick out sideways. Setting one axis to `auto` makes
       the other scrollable too, and a drag near the edge would then auto-scroll
       the spaces out of sight. `overflow-x: clip` does not help - next to
       `auto` it is coerced to `hidden`, which still scrolls programmatically.
       So the hover label lives beside this column instead of inside it. */
    scrollbar-width: none;
  }

  button {
    border: none;
    background: none;
    color: var(--muted-strong);
    cursor: default;
    display: grid;
    place-items: center;
    position: relative;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .space {
    width: 30px;
    height: 30px;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 620;
    letter-spacing: 0.01em;
    background: var(--surface-2);
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-base) var(--ease-spring);
  }

  /* Not only yours: a small stack of dots on the corner of the square, the same
     shape and the same overlap as the devices in a note's tab. Two of them,
     because the fact is "somebody else" rather than how many, and on the corner
     rather than under the letter, which is where the letter is.

     The rail is the one place a colour has to be read at four pixels, so the
     accent is the mark and the rail's own surface is the ring around it. */
  .with {
    position: absolute;
    right: -1px;
    bottom: -1px;
    display: flex;
    align-items: center;
    pointer-events: none;
  }

  .who {
    width: 5px;
    height: 5px;
    flex: none;
    margin-right: -2px;
    border-radius: 50%;
    background: var(--accent);
    /* A ring in the rail's own colour, so two dots against each other still
       read as two, and so the stack lifts off the square under it. */
    box-shadow: 0 0 0 1.5px var(--surface);
  }

  /* Pointer only: a touch browser keeps the last tap "hovered", which left a
     space grown and lit after choosing it. */
  @media (hover: hover) {
    .space:hover {
      background: var(--surface-3);
      color: var(--text-strong);
      transform: scale(1.08);
    }
  }

  /* Reading a whole folder is what picking a space costs, so the button gives
     under the pointer rather than waiting for the listing. */
  .space:active {
    background: var(--press);
    color: var(--text-strong);
    transform: scale(0.94);
  }

  /* Dragged spaces get out of the way of the line showing where they land. */
  .space.dragging {
    opacity: 0.4;
  }

  .space.before::after,
  .space.after::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .space.before::after {
    top: -4px;
  }

  .space.after::after {
    bottom: -4px;
  }

  /* A note held over a space: the whole square lights up, because the note
     goes into it rather than beside it. */
  .space.receiving {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--text-strong);
    transform: scale(1.08);
  }

  /* The active space grows a marker rather than announcing itself in words. */
  .space.active {
    background: var(--accent);
    color: #fff;
  }

  .space.active::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 50%;
    width: 2px;
    height: 16px;
    border-radius: 1px;
    background: var(--accent);
    transform: translateY(-50%) scaleY(0);
    animation: mark var(--dur-base) var(--ease-spring) forwards;
  }

  @keyframes mark {
    to {
      transform: translateY(-50%) scaleY(1);
    }
  }

  /* The label is text on demand: it exists only while pointed at. */
  /* Beside the rail rather than inside the scrolling column, and placed from
     the hovered button's own position. */
  .name {
    position: absolute;
    left: calc(100% + 10px);
    transform: translateY(-50%);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 450;
    white-space: nowrap;
    box-shadow: var(--shadow-md);
    pointer-events: none;
    animation: name-in var(--dur-fast) var(--ease-out);
    z-index: 5;
  }

  @keyframes name-in {
    from {
      opacity: 0;
      transform: translateY(-50%) translateX(-4px);
    }
  }

  .add {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-md);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-base) var(--ease-spring);
  }

  @media (hover: hover) {
    .add:hover {
      background: var(--surface-2);
      color: var(--text-strong);
      transform: rotate(90deg);
    }
  }

  /* A dot in the corner, not a badge: it is there to be noticed out of the
     corner of an eye and otherwise ignored. */
  .add.syncing::after,
  .add.failed::after {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .add.syncing::after {
    animation: breathe 1100ms var(--ease-in-out) infinite;
  }

  .add.failed::after {
    background: var(--danger);
  }

  @keyframes breathe {
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .add.syncing::after {
      animation: none;
      opacity: 0.6;
    }
  }

  .foot {
    /* Pushed to the bottom now that the menu holds the top. */
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .foot .add:hover {
    transform: none;
  }

  .add:active,
  .foot .add:active {
    background: var(--press);
    color: var(--text-strong);
    transform: scale(0.9);
  }

  .glyph {
    width: 19px;
    height: 19px;
    stroke-width: 1.7;
    stroke-linejoin: round;
  }

  .account {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 620;
  }

  /* Still asking the stores whether there is a session. Not a spinner and not a
     sentence: the button that would sign you in simply waits, and breathes
     while it does. */
  .looking {
    animation: looking 1.6s var(--ease-in-out) infinite;
    cursor: default;
  }

  @keyframes looking {
    0%,
    100% {
      opacity: 0.4;
    }

    50% {
      opacity: 0.85;
    }
  }

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /* A filled mark, not a line drawing: the GitHub logo is a silhouette. */
  .mark {
    fill: currentColor;
    stroke: none;
  }

  /* Touch: 30px squares are hard to hit with a thumb. */
  :global([data-touch]) .space,
  :global([data-touch]) .add {
    width: var(--touch-target);
    height: var(--touch-target);
  }

  :global([data-touch]) nav {
    width: auto;
    padding: var(--space-3) var(--space-2);
    /* Standalone on a phone the rail runs under the status bar, so the
       menu button has to start below the clock and battery. */
    padding-top: calc(var(--space-3) + var(--inset-top));
    padding-bottom: calc(var(--space-3) + var(--inset-bottom));
  }

  :global([data-touch]) svg {
    width: 22px;
    height: 22px;
  }

  :global([data-touch]) .glyph {
    width: 24px;
    height: 24px;
  }

  :global([data-touch]) .space {
    font-size: 18px;
  }

  /* No hover on a touch screen, so the label would never show. */
  :global([data-touch]) .name {
    display: none;
  }
</style>
