<script lang="ts">
  import { arrive, leave } from './slide'
  import Door from './Door.svelte'
  import NameField from './NameField.svelte'
  import { overlays } from './overlays'
  import { shortcuts } from './shortcuts.svelte'
  import { commitSpaceName } from './space-actions'
  import SharedMark from './SharedMark.svelte'
  import SpaceBadge from './SpaceBadge.svelte'
  import { spacesMenu } from './surfaces.svelte'
  import { isShared } from './sharing.svelte'
  import { workspace } from './workspace.svelte'

  let open = $state(false)

  const here = $derived(workspace.activeSpace)
  const name = $derived(here?.name ?? 'Spaces')

  const otherSpaces = $derived(
    workspace.spaces.filter((space) => space.id !== here?.id).map((space) => space.name),
  )

  let wrong = $state(false)

  $effect(() =>
    open
      ? overlays.show(
          () => (open = false),
          () => [...document.querySelectorAll('[data-spaces-open], [data-space-drop="switcher"]')],
        )
      : undefined,
  )
</script>

{#snippet mark()}
  {#if here}
    {@const space = here}
    <span class="mark">
      {#key space.id}
        <span class="fade" in:arrive={{ y: 0 }} out:leave={{ y: 0 }}>
          <SpaceBadge {space} />
        </span>
      {/key}
    </span>
  {/if}
{/snippet}

{#if here && workspace.naming?.path === here.root}
  <div class="name" class:is-wrong={wrong}>
    {@render mark()}
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
    data-space-drop="switcher"
    title={shortcuts.tooltip(name, 'space.switcher')}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {@render mark()}
    <span class="orden-row-label">{name}</span>
    {#if here && isShared(here.root)}
      <SharedMark />
    {/if}
    <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
  </button>
{/if}

<Door {open} load={() => spacesMenu()}>
  {#snippet children(SpaceMenu)}
    <SpaceMenu close={() => (open = false)} />
  {/snippet}
</Door>

<style>
  .name {
    flex: 1;
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
    text-align: start;
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

  .mark {
    flex: none;
    display: grid;
    margin-inline-end: calc(var(--row-gap) - var(--space-1));
  }

  .mark > .fade {
    grid-area: 1 / 1;
  }

  .name .orden-row-label {
    flex: 0 1 auto;
  }

  .chevron {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .name.open .chevron {
    transform: rotate(180deg);
  }
</style>
