<script lang="ts">
  import { dragged, isTreeDrag } from './drag-paths'
  import { account } from './account.svelte'
  import AppMenu from './AppMenu.svelte'
  import type { EditorView } from '@nib/editor'
  import IconPicker from './IconPicker.svelte'
  import { type IconNode, loadIcons } from './icons'
  import { longPress } from './longpress'
  import { t } from './i18n.svelte'
  import { DIVIDER, menu, type MenuEntry, trim } from './menu.svelte'
  import { overlays } from './overlays'
  import { prompt } from './prompt.svelte'
  import { canPublish } from './publishing.svelte'
  import {
    deleteSpace,
    moveSpace,
    newSpace,
    publishSpace,
    renameSpace,
    shareSpace,
  } from './space-actions'
  import { settings } from './settings.svelte'
  import { canShare, isShared, roleOf } from './sharing.svelte'
  import { sync } from './sync.svelte'
  import { SOURCE_URL } from './app-menu'
  import { openExternal } from './tauri'
  import { viewport } from './viewport.svelte'
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

  /** The space being put somewhere else by hand, where a finger cannot drag.
   *
   *  A held finger opens the row's menu before any drag could begin, and the
   *  browser fires no drag events from a touch anyway, so a thumb had no way to
   *  reorder the rail at all. The menu offers it instead: the square lifts, and a
   *  chevron above and below it move it one place at a time. Steps rather than a
   *  finger following the square, because a step is exact, it works with movement
   *  turned down, and it needs no second implementation of dragging. */
  let lifting = $state<string | null>(null)

  /** Where the lifted space sits now, so the chevrons know what is left. */
  const liftedAt = $derived(workspace.spaces.findIndex((one) => one.id === lifting))

  /** Moves it one place. `moveSpace` places it in front of a space, so going
   *  down means going in front of the one after next. */
  async function nudge(by: -1 | 1) {
    const id = lifting
    const at = liftedAt
    if (!id || at < 0) return

    const to = at + by
    if (to < 0 || to >= workspace.spaces.length) return

    const before = by === -1 ? workspace.spaces[to] : workspace.spaces[to + 1]
    await moveSpace(id, before?.id ?? null)
  }

  // Escape puts it down, the way Escape closes everything else the app opens
  // over a note; see overlays.ts.
  $effect(() => (lifting ? overlays.show(() => (lifting = null)) : undefined))

  /** The same menu whether it was asked for with a right click or a held
   *  finger, so a phone is not missing what a desktop offers. */
  function spaceMenu(space: Space): MenuEntry[] {
    // A space somebody shared to read is theirs; the only thing this menu can
    // offer about it is a way out of it.
    const theirs = roleOf(space.root) !== 'owner'

    // What a space is, rather than what to put in it: the file list's own menu
    // makes notes, and it is where somebody looking for a new note already is.
    // The folder behind the space is not what the rail is about either, so
    // revealing it went with the note.
    return trim([
      ...(theirs ? [] : [{ label: t('Rename'), run: () => void renameSpace(space) }]),
      // Only where a drag is impossible. On a desktop the rail is dragged, and
      // an entry for what the pointer already does would be one more row to read.
      ...(viewport.touch && workspace.spaces.length > 1
        ? [{ label: t('Move'), run: () => (lifting = space.id) }]
        : []),
      { label: t('Choose an icon'), run: () => void picker?.choose(space.id) },
      ...(canShare(space) ? [{ label: t('Share'), run: () => void shareSpace(space) }] : []),
      // Beside it, because it is the same question about the same folder: who
      // else may read this.
      ...(canPublish(space) ? [{ label: t('Publish'), run: () => publishSpace(space) }] : []),
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

  /** Who is at this device. Signed out, the sign-in; and for a guest a link let
   *  in, the name over their caret, which is the one thing they own here. */
  async function whoIsHere() {
    const guest = account.guest
    if (!guest) {
      account.open = true
      return
    }

    const named = await prompt.ask({
      title: t('Your name'),
      value: guest.name,
      placeholder: t('Your name'),
      confirmLabel: t('Save'),
    })
    if (named !== null) await account.rename(named).catch(() => undefined)
  }

  // Only worth loading the set once a space actually uses one.
  $effect(() => {
    if (!Object.keys(workspace.device.icons).length || Object.keys(library).length) return

    let current = true
    void loadIcons().then((all) => {
      if (current) library = all
    })

    return () => {
      current = false
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
      {@const lifted = space.id === lifting}

      <!-- The two steps a lifted square takes, in the gaps either side of it, so
           the rail stays one column and the row keeps its size. -->
      {#if lifted && index > 0}
        <button class="nudge" aria-label={t('Move up')} onclick={() => void nudge(-1)}>
          <svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4" /></svg>
        </button>
      {/if}

      <button
        class="space"
        class:active={space.id === workspace.activeSpaceId}
        class:dragging={space.id === dragging}
        class:lifted
        class:before={gap === space.id}
        class:after={gap === null && index === workspace.spaces.length - 1}
        class:receiving={receiving === space.id}
        title={space.name}
        aria-label={space.name}
        aria-current={space.id === workspace.activeSpaceId}
        aria-grabbed={lifted ? true : undefined}
        draggable="true"
        ondragstart={(event) => start(event, space.id)}
        ondragover={(event) => over(event, space.id, workspace.spaces[index + 1]?.id ?? null)}
        ondragleave={(event) => stillInside(event) || (receiving = null)}
        ondrop={(event) => drop(event, space)}
        ondragend={stop}
        onclick={() => {
          // A square that is up goes down again, and touching any other one puts
          // it down and shows that space, which is what a tap elsewhere means.
          if (lifting) {
            lifting = null
            if (lifted) return
          }

          return workspace.showSpace(space.id)
        }}
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

      {#if lifted && index < workspace.spaces.length - 1}
        <button class="nudge" aria-label={t('Move down')} onclick={() => void nudge(1)}>
          <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></svg>
        </button>
      {/if}
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

    <!-- Who is at this device, which is one of two things. Signed out it is the
         sign-in, and once there is an account it has nothing left to do; the
         settings sheet owns it. For a guest a link let in it is their name,
         because that is the whole of who they are here and the other people in
         the note are reading it over a caret: one tap changes it.

         It also waits while the stores are still being asked. Signed out and
         not known yet are different states, and on a phone the difference is
         the seconds the phone app takes to answer: a form offered inside them
         is a session typed in again for nothing. -->
    {#if !account.user}
      <button
        class="add account"
        class:looking={account.restoring}
        title={account.guest ? account.guest.name : t('Sign in')}
        aria-label={account.guest ? t('Your name') : t('Sign in')}
        disabled={account.restoring}
        onclick={() => void whoIsHere()}
      >
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
        >
      </button>
    {/if}

    <!-- Off while the theme in force has only the one scheme: there is no other
         side of it to show, and swapping it for a built-in is not the switch
         anybody pressed. See theme.svelte.ts. -->
    <button
      class="add"
      title={theme.current === 'dark' ? t('Light') : t('Dark')}
      aria-label={t('Switch theme')}
      disabled={!theme.switchable}
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

  /* Off the surface and lit, so it reads as held rather than selected. The same
     spring the square already uses for the pointer, at the stage duration. */
  .space.lifted {
    background: var(--surface-3);
    color: var(--text-strong);
    box-shadow: var(--shadow-lg);
    transform: scale(1.08);
    transition: transform var(--dur-stage) var(--ease-spring);
  }

  /* One step, in the gap the square would move into. Wide as the column so a
     thumb cannot miss it, and quiet, because the square is the thing being
     looked at. */
  .nudge {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 22px;
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .nudge:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .nudge:active {
    background: var(--surface-3);
  }

  .nudge svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
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
    .add:hover:not(:disabled) {
      background: var(--surface-2);
      color: var(--text-strong);
      transform: rotate(90deg);
    }
  }

  .add:disabled {
    opacity: 0.5;
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

  .add:active:not(:disabled),
  .foot .add:active:not(:disabled) {
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

  /* Touch: 30px squares are hard to hit with a thumb. A square here is the
     column's whole width, so it takes the row size the lists beside it use
     rather than the bare floor. */
  :global([data-touch]) .space,
  :global([data-touch]) .add {
    width: var(--touch-row);
    height: var(--touch-row);
  }

  :global([data-touch]) nav {
    width: auto;
    padding: var(--space-3) var(--space-2);
    /* Standalone on a phone the rail runs under the status bar, so the
       menu button has to start below the clock and battery. */
    padding-top: calc(var(--space-3) + var(--inset-top));
    padding-bottom: calc(var(--space-3) + var(--inset-bottom));
  }

  :global([data-touch]) svg,
  :global([data-touch]) .glyph {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  /* The letter a space is known by stands in for an icon, so it is drawn at the
     size of the ones above and below it. */
  :global([data-touch]) .space {
    font-size: var(--touch-icon);
  }

  /* No hover on a touch screen, so the label would never show. */
  :global([data-touch]) .name {
    display: none;
  }

  /* A thumb's step, and the one place these are ever shown. As wide as the
     squares it moves between, and no taller than the gap it sits in. */
  :global([data-touch]) .nudge {
    width: var(--touch-row);
    height: 34px;
  }

  :global([data-touch]) .nudge svg {
    width: 18px;
    height: 18px;
  }
</style>
