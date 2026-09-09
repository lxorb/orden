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
  import { arrive, leave, LIST_STEP } from './slide'
  import { iconLibrary } from './icon-library.svelte'
  import { initial } from './icons'
  import { longPress } from './longpress'
  import { menu } from './menu.svelte'
  import { overlays } from './overlays'
  import { newSpace, spaceMenu } from './space-actions'
  import { t } from './i18n.svelte'
  import { isShared } from './sharing.svelte'
  import { type Space, workspace } from './workspace.svelte'

  let open = $state(false)

  const here = $derived(workspace.activeSpace)
  const name = $derived(here?.name ?? t('Spaces'))

  const glyph = (space: Space) => iconLibrary.spaceShape(workspace.iconFor(space.id))

  function choose(space: Space) {
    open = false
    if (space.id !== workspace.activeSpaceId) void workspace.showSpace(space.id)
  }

  function about(event: MouseEvent, space: Space) {
    menu.show(event, spaceMenu(space), { title: space.name })
  }

  // Escape closes it, the way Escape closes everything else the app opens over
  // what is under it; see overlays.ts.
  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))

  // Only worth fetching the set once a space actually wears an icon.
  $effect(() => {
    if (Object.keys(workspace.device.icons).length) iconLibrary.load()
  })
</script>

<button
  class="name"
  class:open
  title={name}
  aria-haspopup="menu"
  aria-expanded={open}
  onclick={() => (open = !open)}
>
  <span class="nib-row-label">{name}</span>
  <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
</button>

{#if open}
  <!-- Takes the press that closes it, and the scroll that would otherwise reach
       the list underneath. No colour: this is a menu inside the panel, not a
       layer over the app. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="catch" onclick={() => (open = false)}></div>

  <div class="spaces" role="menu" in:arrive={{ y: -LIST_STEP }} out:leave={{ y: -LIST_STEP }}>
    {#each workspace.spaces as space (space.id)}
      {@const shape = glyph(space)}
      <div class="line">
        <button
          class="nib-row"
          class:is-on={space.id === workspace.activeSpaceId}
          role="menuitem"
          onclick={() => choose(space)}
          oncontextmenu={(event) => about(event, space)}
          use:longPress={(event) => about(event, space)}
        >
          <span class="badge" class:here={space.id === workspace.activeSpaceId} aria-hidden="true">
            {#if shape}
              <svg viewBox="0 0 24 24">
                {#each shape as [tag, attrs] (JSON.stringify(attrs))}
                  <svelte:element this={tag} {...attrs} />
                {/each}
              </svg>
            {:else}
              {initial(space.name)}
            {/if}
          </span>

          <span class="nib-row-label">{space.name}</span>

          <!-- Not only yours. The same fact a note's tab says with a stack of
               devices, said once here. -->
          {#if isShared(space.root)}
            <span class="with" aria-hidden="true"></span>
          {/if}
        </button>

        <!-- What the space itself offers. Also a right click on the row and a
             held finger, so the gesture is the one every other list in the app
             answers to. -->
        <button
          class="more"
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
      <span class="badge plus" aria-hidden="true">
        <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
      </span>
      <span class="nib-row-label">{t('New space')}</span>
    </button>
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

  /* The mark a space is known by: its drawing, or the letter it starts with when
     it has none. A square with a corner a third of its side, which is the shape
     the squares down the side of the window wore. */
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: calc(var(--row-height-sm) * 0.32);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-size: calc(var(--row-height-sm) * 0.46);
    font-weight: 620;
    letter-spacing: 0.01em;
  }

  /* The space you are in wears the accent on its mark, and the row it is in is
     filled the way the note you have open is; that fill is `.nib-row.is-on` in
     the themes package and is not restated here. */
  .badge.here {
    background: var(--accent);
    color: #fff;
  }

  .badge svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .badge.plus {
    background: none;
    color: var(--muted);
  }

  /* Somebody else is in this space. A dot at the end of the row, where every
     other list in the app puts what it has to add about a name. */
  .with {
    flex: none;
    width: 6px;
    height: 6px;
    margin-left: var(--space-1);
    border-radius: 50%;
    background: var(--accent);
  }

  .more {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--row-height);
    height: var(--row-height);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
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

    .more:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }

  .more:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .more svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: currentColor;
    stroke: none;
  }

  hr {
    margin: var(--space-1) 4px;
    border: none;
    border-top: 1px solid var(--line);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
</style>
