<script lang="ts">
  import { tick } from 'svelte'
  import { longPress } from './longpress'
  import RowMore from './RowMore.svelte'
  import SpaceRow from './SpaceRow.svelte'
  import type { SpaceTyping } from './space-typing.svelte'
  import { type Space, workspace } from './workspace.svelte'

  const {
    typing,
    choose,
    about,
  }: {
    typing: SpaceTyping
    choose: (space: Space) => void
    about?: (event: MouseEvent, space: Space) => void
  } = $props()

  const buttons = $state<Record<number, HTMLButtonElement | null>>({})

  const shown = $derived(
    typing.reading.shown.flatMap((at) => {
      const space = workspace.shownSpaces[at]
      return space ? [{ space, at }] : []
    }),
  )

  $effect(() => {
    const best = typing.reading.best
    if (best >= 0) void tick().then(() => buttons[best]?.focus())
  })
</script>

{#each shown as { space, at } (space.id)}
  <div class="line" role="none">
    <button
      class="orden-row"
      class:is-on={space.id === workspace.activeSpaceId}
      data-space-drop={space.id}
      data-lands={space.id === workspace.activeSpaceId ? '' : undefined}
      role="menuitem"
      bind:this={buttons[at]}
      onclick={() => choose(space)}
      oncontextmenu={(event) => about?.(event, space)}
      use:longPress={(event) => about?.(event, space)}
    >
      <SpaceRow
        {space}
        place={at}
        typed={typing.typed}
        held={typing.held}
        on={space.id === workspace.activeSpaceId}
      />
    </button>

    {#if about}
      <RowMore onclick={(event: MouseEvent) => about(event, space)} />
    {/if}
  </div>
{/each}

<style>
  .line {
    display: flex;
    align-items: center;
  }

  .line .orden-row {
    flex: 1;
    min-width: 0;
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  button:global(.is-drop) {
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-soft);
  }
</style>
