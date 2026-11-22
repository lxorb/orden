<script lang="ts">
  import { dur, fade } from '../../platform/src/api'
  import { hang, overlays } from '../../ui-kit/src/api'
  import ActivityFind from './ActivityFind.svelte'

  const {
    from,
    chosen = null,
    onpick,
    onclose,
    onmanage,
  }: {
    from: HTMLElement
    chosen?: string | null
    onpick: (activity: string) => void
    onclose: () => void
    onmanage?: (() => void) | undefined
  } = $props()
  let list = $state<HTMLElement | null>(null)
  $effect(() => overlays.show(onclose, () => [list, from]))
</script>

<div
  class="layer orden-layer"
  role="listbox"
  aria-label="Activity"
  data-covers
  data-time-activities
  bind:this={list}
  use:hang={{ side: 'below', gap: 4, from }}
  transition:fade={{ duration: dur(120) }}
>
  <ActivityFind
    {chosen}
    onpick={(id: string) => {
      onpick(id)
      onclose()
    }}
    onescape={onclose}
  />
  {#if onmanage}
    <button
      type="button"
      class="orden-row is-short manage"
      onclick={() => {
        onclose()
        onmanage()
      }}>Manage activities</button
    >
  {/if}
</div>

<style>
  .layer {
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: max-content;
    min-width: 14rem;
    max-width: 20rem;
    max-height: 20rem;
    overflow: auto;
    padding: var(--space-1);
  }
  .manage {
    margin-top: var(--space-1);
    border-top: 1px solid var(--line);
    border-radius: 0 0 var(--radius-row) var(--radius-row);
    color: var(--muted);
  }
</style>
