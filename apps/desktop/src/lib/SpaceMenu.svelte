<script lang="ts">
  /** The list a press on a space's mark drops: every space, a digit away, with what each
   *  offers, New space, and the files other people shared on their own. Fetched with
   *  the first press, so none of it is in front of the first paint; the mark that
   *  opens it, and the header it hangs from, are SpaceSwitcher.svelte.
   *
   *  The rows are the switcher's in the middle of the window too (SpaceList.svelte),
   *  and so is what a key typed into them does: a digit goes to that space, a name
   *  waits for Enter. */
  import type { SharedItem } from './api'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { menu } from './menu.svelte'
  import { roving } from './roving'
  import RowMore from './RowMore.svelte'
  import SharedMark from './SharedMark.svelte'
  import { arrive, leave, LIST_STEP } from './slide'
  import { newSpace, spaceMenu } from './space-actions'
  import SpaceList from './SpaceList.svelte'
  import { spacePicker } from './space-picker.svelte'
  import { SpaceTyping } from './space-typing.svelte'
  import { sharedWithYou } from './sharing.svelte'
  import SpaceBadge from './SpaceBadge.svelte'
  import { spendClick } from './spent-click'
  import { trap } from './trap'
  import { type Space, workspace } from './workspace.svelte'

  const { close }: { close: () => void } = $props()

  function choose(space: Space) {
    close()
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

  /** The spaces put away, in the reader's order, each a row that takes it back; see
   *  space-archive.ts. */
  const archived = $derived(
    workspace.spaces.filter((one) => workspace.archivedSpaces.has(one.root)),
  )

  /** Takes a space back, where it was in the list, and goes to it. */
  async function bringBack(space: Space) {
    close()
    const { unarchiveSpace } = await import('./space-archive')
    await unarchiveSpace(space)
    await workspace.showSpace(space.id)
  }

  /** What an archived space offers: taking it back. */
  function aboutArchived(event: MouseEvent, space: Space) {
    menu.show(event, [{ label: t('Unarchive'), run: () => void bringBack(space) }], {
      title: space.name,
    })
  }

  /** What is typed into the list, the same as into the switcher in the middle of the
   *  window: a digit goes to that space, a name waits for Enter. New each time it opens,
   *  which is each time this is mounted. */
  const typing = new SpaceTyping(choose)
  $effect(() => () => typing.stop())

  // The switcher in the middle of the window is the same list; this one gives way to
  // it rather than standing open under it.
  $effect(() => {
    if (spacePicker.open) close()
  })
</script>

<!-- Takes the press that closes it, and the scroll that would otherwise reach
     the list underneath. No colour: this is a menu inside the panel, not a
     layer over the app. A tap's click comes after the catch has gone, and is
     spent rather than reaching what was under it (#411; see spent-click.ts). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="catch" onclick={close} onpointerdown={spendClick}></div>

<!-- The same walk and the same one tab stop every list in the app has, and the
     same trap every layer has: the arrows move, a digit or a name typed finds a
     space (SpaceTyping, ahead of the list's own keys), Enter chooses, and closing gives the keyboard back to the name it came from. The
     three dots on a row are reached with the row's own menu key rather than with
     Tab; see roving.ts and trap.ts. -->
<div
  class="nib-layer spaces"
  data-spaces-open
  role="menu"
  aria-label={t('Spaces')}
  onkeydowncapture={typing.press}
  use:trap
  use:roving={{
    current: '.is-on',
    wrap: true,
    quiet: '.more',
    open: (row) => row.click(),
    menu: (row, at) => row.dispatchEvent(at),
    leave: () => {
      close()
      return true
    },
  }}
  in:arrive={{ y: -LIST_STEP }}
  out:leave={{ y: -LIST_STEP }}
>
  <!-- Every space, the rows the switcher in the middle of the window has too; see
       SpaceList.svelte. -->
  {#if typing}
    <SpaceList {typing} {choose} {about} />
  {/if}

  <hr />

  <button
    class="nib-row"
    role="menuitem"
    onclick={() => {
      close()
      void newSpace()
    }}
  >
    <span class="nib-badge is-quiet" aria-hidden="true">
      <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
    </span>
    <span class="nib-row-label">{t('New space')}</span>
  </button>

  <!-- ── Archived ─────────────────────────────────────────────────────
       The spaces put away whole, under the list rather than in it: out of the way of
       choosing a space, and one press from coming back. A row takes it back and goes
       to it; its menu says Unarchive. See space-archive.ts. -->
  {#if archived.length}
    <hr />

    <div class="held" role="group" aria-label={t('Archived')} data-archived-spaces>
      <p class="from" aria-hidden="true">{t('Archived')}</p>

      {#each archived as space (space.id)}
        <div class="line" role="none">
          <button
            class="nib-row"
            role="menuitem"
            title={t('Unarchive')}
            onclick={() => void bringBack(space)}
            oncontextmenu={(event) => aboutArchived(event, space)}
            use:longPress={(event) => aboutArchived(event, space)}
          >
            <SpaceBadge {space} />
            <span class="nib-row-label">{space.name}</span>
          </button>
          <RowMore onclick={(event: MouseEvent) => aboutArchived(event, space)} />
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── Shared with you ────────────────────────────────────────────
       Files other people handed over on their own: one note or one canvas out
       of somebody else's space. They are not spaces and are not made into
       spaces - there is no folder for one and no row in the tree - so this is
       where they live: the foot of the list of everything you can open, under
       whoever gave it to you. See docs/sharing.md. -->
  {#if sharedWithYou.items.length}
    <hr />

    <!-- One person's files, which is a group of rows in the menu and is named by
         whoever gave them: their name is written once over the rows rather than
         again on each of them, so it is the group that carries it. -->
    {#each sharedWithYou.byOwner as group (group.owner)}
      <div class="held" role="group" aria-label={group.owner}>
        <p class="from" aria-hidden="true">{group.owner}</p>

        {#each group.items as item (item.id)}
          <div class="line" role="none">
            <button
              class="nib-row"
              class:is-on={workspace.showingShared(item.id)}
              role="menuitem"
              title={item.name}
              onclick={() => {
                close()
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

            <RowMore onclick={(event: MouseEvent) => aboutShared(event, item)} />
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  /* Under the head and as wide as the list below it, which is what makes this
     need no measuring: the panel is the anchor. The shape is `.nib-layer` in the
     themes package, the same as the two menus. */
  .spaces {
    position: absolute;
    top: 100%;
    left: var(--space-1);
    right: var(--space-1);
    z-index: var(--z-popover);
    padding: var(--space-1);
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .catch {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
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

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  /* One person's files, held together so the menu can say whose they are. Nothing
     to lay out: `display: contents` leaves the rows exactly where they were in the
     list, which is what makes this a name for them rather than a box around them. */
  .held {
    display: contents;
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
