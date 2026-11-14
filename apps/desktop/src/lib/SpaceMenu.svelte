<script lang="ts">
  import type { SharedItem } from './accounts/src/api'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { longPress } from './longpress'
  import { menu } from './menu.svelte'
  import { roving } from './roving'
  import RowMore from './RowMore.svelte'
  import SharedMark from './SharedMark.svelte'
  import { arrive, letGo, LIST_STEP } from './ui-kit/src/api'
  import { newSpace, spaceMenu } from './space-actions'
  import SpaceList from './SpaceList.svelte'
  import { spacePicker } from './space-picker.svelte'
  import { SpaceTyping } from './space-typing.svelte'
  import { sharedWithYou } from './sharing/src/api'
  import SpaceBadge from './SpaceBadge.svelte'
  import { spendClick } from './spent-click'
  import { trap } from './ui-controls/src/api'
  import { type Space, workspace } from './workspace.svelte'

  const { close }: { close: () => void } = $props()

  function choose(space: Space) {
    close()
    if (space.id !== workspace.activeSpaceId) void workspace.showSpace(space.id)
  }

  function about(event: MouseEvent, space: Space) {
    menu.show(event, spaceMenu(space), { title: space.name })
  }

  function aboutShared(event: MouseEvent, item: SharedItem) {
    menu.show(
      event,
      [
        {
          label: 'Remove from your list',
          danger: true,
          run: () => void sharedWithYou.leave(item),
        },
      ],
      { title: item.name },
    )
  }

  const archived = $derived(
    workspace.spaces.filter((one) => workspace.archivedSpaces.has(one.root)),
  )

  async function bringBack(space: Space) {
    close()
    const { unarchiveSpace } = await import('./space-archive')
    await unarchiveSpace(space)
    await workspace.showSpace(space.id)
  }

  function aboutArchived(event: MouseEvent, space: Space) {
    menu.show(event, [{ label: 'Unarchive', run: () => void bringBack(space) }], {
      title: space.name,
    })
  }

  const typing = new SpaceTyping(choose)
  $effect(() => () => typing.stop())

  $effect(() => {
    if (spacePicker.open) close()
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="catch" data-covers="all" onclick={close} onpointerdown={spendClick} out:letGo></div>

<div
  class="orden-layer spaces"
  data-spaces-open
  role="menu"
  aria-label="Spaces"
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
  transition:arrive={{ y: -LIST_STEP }}
>
  {#if typing}
    <SpaceList {typing} {choose} {about} />
  {/if}

  <hr />

  <button
    class="orden-row"
    role="menuitem"
    onclick={() => {
      close()
      void newSpace()
    }}
  >
    <span class="orden-badge is-quiet" aria-hidden="true">
      <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
    </span>
    <span class="orden-row-label">New space</span>
  </button>

  {#if archived.length}
    <hr />

    <div class="held" role="group" aria-label="Archived" data-archived-spaces>
      <p class="from" aria-hidden="true">Archived</p>

      {#each archived as space (space.id)}
        <div class="line" role="none">
          <button
            class="orden-row"
            role="menuitem"
            title="Unarchive"
            onclick={() => void bringBack(space)}
            oncontextmenu={(event) => aboutArchived(event, space)}
            use:longPress={(event) => aboutArchived(event, space)}
          >
            <SpaceBadge {space} />
            <span class="orden-row-label">{space.name}</span>
          </button>
          <RowMore onclick={(event: MouseEvent) => aboutArchived(event, space)} />
        </div>
      {/each}
    </div>
  {/if}

  {#if sharedWithYou.items.length}
    <hr />

    {#each sharedWithYou.byOwner as group (group.owner)}
      <div class="held" role="group" aria-label={group.owner}>
        <p class="from" aria-hidden="true">{group.owner}</p>

        {#each group.items as item (item.id)}
          <div class="line" role="none">
            <button
              class="orden-row"
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
              <span class="orden-badge is-quiet" aria-hidden="true">
                <FileMark mark={fileMark(item.path)} />
              </span>
              <span class="orden-row-label">{item.name}</span>
              <SharedMark label="Shared with you" />
            </button>

            <RowMore onclick={(event: MouseEvent) => aboutShared(event, item)} />
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
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

  .line {
    display: flex;
    align-items: center;
  }

  .line .orden-row {
    flex: 1;
    min-width: 0;
  }

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  .held {
    display: contents;
  }

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
