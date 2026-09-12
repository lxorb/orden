<script lang="ts">
  /** Which space this is, and the way to any other one.
   *
   *  The column of wordless squares down the left of the window is gone: there
   *  were two ways to choose a space and this is the better one, because it says
   *  the name. What the column carried comes here - every space with its own
   *  mark, the quiet dot that says somebody else is in it, and what a space
   *  itself offers, on the row it is about.
   *
   *  It opens *inside* the panel rather than floating over the app: the anchor is
   *  always the top of the list, so the list of spaces is the width of the list
   *  of notes and needs no measuring, no flipping at an edge and no second sheet
   *  written for a phone. A drawer is a panel too, so a thumb gets exactly what a
   *  pointer gets. */
  import type { SharedItem } from './api'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { arrive, leave, LIST_STEP } from './slide'
  import { longPress } from './longpress'
  import { menu } from './menu.svelte'
  import NameField from './NameField.svelte'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import { trap } from './trap'
  import { commitSpaceName, newSpace, spaceMenu } from './space-actions'
  import SharedMark from './SharedMark.svelte'
  import SpaceMark from './SpaceMark.svelte'
  import { t } from './i18n.svelte'
  import { isShared, sharedWithYou } from './sharing.svelte'
  import { type Space, workspace } from './workspace.svelte'

  let open = $state(false)

  const here = $derived(workspace.activeSpace)
  const name = $derived(here?.name ?? t('Spaces'))

  /** The names the switcher already holds, so the field can say a name is taken;
   *  a space keeping its own name is not taking it from itself. */
  const otherSpaces = $derived(
    workspace.spaces.filter((space) => space.id !== here?.id).map((space) => space.name),
  )

  /** Whether the name being typed cannot be written, which the header wears as a
   *  hairline in red exactly as a row does; the field is what knows why. */
  let wrong = $state(false)

  function choose(space: Space) {
    open = false
    if (space.id !== workspace.activeSpaceId) void workspace.showSpace(space.id)
  }

  function about(event: MouseEvent, space: Space) {
    menu.show(event, spaceMenu(space), { title: space.name })
  }

  /** What a file somebody shared with you offers: the one thing it can, which is
   *  handing it back. It is not yours to rename, to move or to delete - it is one
   *  document out of somebody else's space - and letting go of it is exactly what
   *  leaving a shared space is. */
  function aboutShared(event: MouseEvent, item: SharedItem) {
    menu.show(
      event,
      [
        {
          label: t('Remove from your list'),
          danger: true,
          run: () => void sharedWithYou.leave(item),
        },
      ],
      { title: item.name },
    )
  }

  // Escape closes it, the way Escape closes everything else the app opens over
  // what is under it; see overlays.ts.
  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))

  // What a space wears in its badge, and which set has to be fetched to draw it,
  // are the badge's own business: SpaceMark.svelte reads what was chosen and
  // Icon.svelte draws whichever of the three kinds it is.
</script>

{#if here && workspace.naming?.path === here.root}
  <!-- Renaming a space happens where its name is written, in the same field a row
       in the list uses: the header keeps its height, its weight and its chevron,
       and only the name becomes editable. See NameField.svelte. -->
  <div class="name" class:is-wrong={wrong}>
    <NameField
      value={here.name}
      taken={otherSpaces}
      bind:wrong
      oncommit={(typed: string) => void commitSpaceName(here, typed)}
      oncancel={() => workspace.cancelNaming()}
    />
    <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
  </div>
{:else}
  <button
    class="name"
    class:open
    title={name}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="nib-row-label">{name}</span>
    <!-- Said on the header as well as on the row, so a space being shared is a
         fact you can see without opening the list of spaces to look for it. -->
    {#if here && isShared(here.root)}
      <SharedMark />
    {/if}
    <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
  </button>
{/if}

{#if open}
  <!-- Takes the press that closes it, and the scroll that would otherwise reach
       the list underneath. No colour: this is a menu inside the panel, not a
       layer over the app. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="catch" onclick={() => (open = false)}></div>

  <!-- The same walk and the same one tab stop every list in the app has, and the
       same trap every layer has: the arrows move, a letter spells a name, Enter
       chooses, and closing gives the keyboard back to the name it came from. The
       three dots on a row are reached with the row's own menu key rather than with
       Tab; see roving.ts and trap.ts. -->
  <div
    class="spaces"
    role="menu"
    use:trap
    use:roving={{
      current: '.is-on',
      wrap: true,
      quiet: '.more',
      open: (row) => row.click(),
      menu: (row, at) => row.dispatchEvent(at),
      leave: () => {
        open = false
        return true
      },
    }}
    in:arrive={{ y: -LIST_STEP }}
    out:leave={{ y: -LIST_STEP }}
  >
    {#each workspace.spaces as space (space.id)}
      <div class="line">
        <button
          class="nib-row"
          class:is-on={space.id === workspace.activeSpaceId}
          role="menuitem"
          onclick={() => choose(space)}
          oncontextmenu={(event) => about(event, space)}
          use:longPress={(event) => about(event, space)}
        >
          <span
            class="nib-badge"
            class:is-on={space.id === workspace.activeSpaceId}
            aria-hidden="true"
          >
            <SpaceMark id={space.id} name={space.name} />
          </span>

          <span class="nib-row-label">{space.name}</span>

          <!-- Not only yours, in the mark the whole app says that with; see
               SharedMark.svelte. It used to be a dot in the accent, which is the
               same shape a tab uses for "not written down yet". -->
          {#if isShared(space.root)}
            <SharedMark />
          {/if}
        </button>

        <!-- What the space itself offers. Also a right click on the row and a
             held finger, so the gesture is the one every other list in the app
             answers to. -->
        <button
          class="nib-glyph more"
          title={t('More')}
          aria-label={t('More')}
          onclick={(event) => about(event, space)}
        >
          <svg viewBox="0 0 13 13"
            ><circle cx="3" cy="6.5" r="1" /><circle cx="6.5" cy="6.5" r="1" /><circle
              cx="10"
              cy="6.5"
              r="1"
            /></svg
          >
        </button>
      </div>
    {/each}

    <hr />

    <button
      class="nib-row"
      role="menuitem"
      onclick={() => {
        open = false
        void newSpace()
      }}
    >
      <span class="nib-badge is-quiet" aria-hidden="true">
        <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
      </span>
      <span class="nib-row-label">{t('New space')}</span>
    </button>

    <!-- ── Shared with you ────────────────────────────────────────────
         Files other people handed over on their own: one note or one canvas out
         of somebody else's space. They are not spaces and are not made into
         spaces - there is no folder for one and no row in the tree - so this is
         where they live: the foot of the list of everything you can open, under
         whoever gave it to you. See docs/sharing.md. -->
    {#if sharedWithYou.items.length}
      <hr />

      {#each sharedWithYou.byOwner as group (group.owner)}
        <!-- The owner's name, quietly, once over their files rather than again on
             every row: "who gave me this" is one fact about the group. -->
        <p class="from">{group.owner}</p>

        {#each group.items as item (item.id)}
          <div class="line">
            <button
              class="nib-row"
              class:is-on={workspace.showingShared(item.id)}
              role="menuitem"
              title={item.name}
              onclick={() => {
                open = false
                void sharedWithYou.open(item)
              }}
              oncontextmenu={(event) => aboutShared(event, item)}
              use:longPress={(event) => aboutShared(event, item)}
            >
              <span class="nib-badge is-quiet" aria-hidden="true">
                <FileMark mark={fileMark(item.path)} />
              </span>
              <span class="nib-row-label">{item.name}</span>
              <SharedMark label={t('Shared with you')} />
            </button>

            <button
              class="nib-glyph more"
              title={t('More')}
              aria-label={t('More')}
              onclick={(event) => aboutShared(event, item)}
            >
              <svg viewBox="0 0 13 13"
                ><circle cx="3" cy="6.5" r="1" /><circle cx="6.5" cy="6.5" r="1" /><circle
                  cx="10"
                  cy="6.5"
                  r="1"
                /></svg
              >
            </button>
          </div>
        {/each}
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* The space's name, and the whole of what the switcher is. As wide as the word
     and no wider: a control the width of the panel puts a grey block across the
     header the moment it is pressed, and says the whole bar is the button when
     the name is. It gives way rather than pushing the plus off the end. */
  .name {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--row-height);
    padding: 0 calc(var(--row-pad) - var(--space-1));
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    text-align: left;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .name:hover {
      background: var(--surface-hover);
    }
  }

  .name:active,
  .name.open {
    background: var(--surface-press);
  }

  /* Beside the word rather than at the far end of the panel: the two are one
     control, and a chevron floating in the middle of a bar belongs to nothing.
     What stays full width is the button, so there is still a header-sized thing
     to press. */
  .name .nib-row-label {
    flex: 0 1 auto;
  }

  /* Says the name can be pressed, and turns over while what it opened is open.
     `--icon-md`, the size of a mark that belongs to a name, so it grows with the
     word under a thumb instead of staying a pointer's size beside 19px type. */
  .chevron {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .name.open .chevron {
    transform: rotate(180deg);
  }

  /* Under the head and as wide as the list below it, which is what makes this
     need no measuring: the panel is the anchor. */
  .spaces {
    position: absolute;
    top: 100%;
    left: var(--space-1);
    right: var(--space-1);
    z-index: 12;
    padding: var(--space-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .catch {
    position: fixed;
    inset: 0;
    z-index: 11;
  }

  /* A row and the button at the end of it share one line, so the name gives way
     to the button rather than running under it. */
  .line {
    display: flex;
    align-items: center;
  }

  .line .nib-row {
    flex: 1;
    min-width: 0;
  }

  /* The mark a space is known by - its drawing, or the letter it starts with
     when it has none - is `.nib-badge` in the themes package, and what goes in it
     is SpaceMark.svelte. Neither is drawn again here: the space you are in wears
     the accent on its badge, which is `is-on`. Nor is the shared mark at the end
     of the row, which is SharedMark.svelte for the same reason. */

  /* `.nib-glyph` in the themes package draws it; what is here is whether it is
     there at all. */
  .more {
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* Where there is a pointer it appears on the row it belongs to; where there is
     not, it is simply there, because a finger cannot hover and a held finger is
     a gesture nobody can see. */
  @media (hover: hover) {
    .line:hover .more,
    .more:focus-visible {
      opacity: 1;
    }

  }

  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }

  /* Three dots: a shape rather than a stroke, so it is filled. */
  .more svg {
    fill: currentColor;
    stroke: none;
  }

  hr {
    margin: var(--space-1) 4px;
    border: none;
    border-top: 1px solid var(--line);
  }

  /* Who shared the files under it. A label rather than a row: there is nothing to
     press, and the name is here so the files below it need not repeat it. Indented
     to where a row's name starts, so the group reads as holding them. */
  .from {
    margin: var(--space-1) 0 2px;
    padding: 0 var(--row-pad);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button:focus-visible {
    outline-offset: -1px;
  }
</style>
