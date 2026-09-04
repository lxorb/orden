<script lang="ts">
  import { account } from './account.svelte'
  import AppMenu from './AppMenu.svelte'
  import type { EditorView } from '@nib/editor'
  import IconPicker from './IconPicker.svelte'
  import { type IconNode, loadIcons } from './icons'
  import { longPress } from './longpress'
  import { t } from './i18n.svelte'
  import { DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import { deleteSpace, moveSpace, newSpace, renameSpace } from './space-actions'
  import { settings } from './settings.svelte'
  import { type Space, workspace } from './workspace.svelte'
  import { theme } from './theme.svelte'

  let {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView; onpalette: () => void; onhistory: () => void } = $props()

  let picker = $state<IconPicker>()
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
    if (event.dataTransfer?.types.includes('text/nib-path')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
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

    const note = event.dataTransfer?.getData('text/nib-path')
    if (note) void workspace.move(note, space.root)
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
    return [
      { label: t('New note'), run: () => workspace.createNote(space.root) },
      { label: t('Rename'), run: () => void renameSpace(space) },
      { label: t('Choose an icon'), run: () => void picker?.choose(space.id) },
      ...revealEntry(space.root),
      DIVIDER,
      { label: t('Delete space'), danger: true, run: () => void deleteSpace(space) },
    ]
  }

  function initial(name: string): string {
    return [...name.trim()][0]?.toUpperCase() ?? '·'
  }

  const icon = (id: string) => {
    const name = workspace.iconFor(id)
    return name ? (library[name] ?? null) : null
  }

  // Only worth loading the set once a space actually uses one.
  $effect(() => {
    if (Object.keys(workspace.icons).length && !Object.keys(library).length) {
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
        onclick={() => workspace.selectSpace(space.id)}
        onmouseenter={(event) => showLabel(event, space.name)}
        onmouseleave={() => (label = null)}
        oncontextmenu={(event) => menu.show(event, spaceMenu(space))}
        use:longPress={(event) => menu.show(event, spaceMenu(space))}
      >
        {#if icon(space.id)}
          <svg class="glyph" viewBox="0 0 24 24">
            {#each icon(space.id)! as [tag, attrs] (JSON.stringify(attrs))}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
        {:else}
          {initial(space.name)}
        {/if}
      </button>
    {/each}

    <!-- The rail is the list of spaces, so its plus makes one. New notes are
         made from the plus beside the tabs. -->
    <button class="add" title={t('New space')} aria-label={t('New space')} onclick={() => newSpace()}>
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
      <button class="add" title={t('Settings')} aria-label={t('Settings')} onclick={() => settings.show()}>
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
         account it has nothing left to do; the settings sheet owns it. -->
    {#if !account.signedIn}
      <button
        class="add account"
        title={t('Sign in')}
        aria-label={t('Sign in')}
        onclick={() => (account.open = true)}
      >
        <svg viewBox="0 0 14 14"><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg>
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
        <svg viewBox="0 0 14 14"><path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" /></svg>
      {/if}
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

  /* Pointer only: a touch browser keeps the last tap "hovered", which left a
     space grown and lit after choosing it. */
  @media (hover: hover) {
    .space:hover {
      background: var(--surface-3);
      color: var(--text-strong);
      transform: scale(1.08);
    }
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

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /* Touch: 30px squares are hard to hit with a thumb. */
  @media (max-width: 720px) {
    .space,
    .add {
      width: 48px;
      height: 48px;
    }

    nav {
      width: auto;
      padding: var(--space-3) var(--space-2);
      padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
    }

    svg {
      width: 22px;
      height: 22px;
    }

    .glyph {
      width: 24px;
      height: 24px;
    }

    .space {
      font-size: 18px;
    }

    /* No hover on a touch screen, so the label would never show. */
    .name {
      display: none;
    }
  }
</style>
