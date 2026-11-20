<script lang="ts">
  import ActivityMark from './ActivityMark.svelte'
  import { nameOf, tintOf } from './look'

  const { activity, onclick }: { activity: string | null; onclick: (event: MouseEvent) => void } = $props()
</script>

<button
  type="button"
  class="chip"
  class:none={activity === null}
  style:--tint={tintOf(activity)}
  aria-haspopup="listbox"
  data-time-chip
  {onclick}
>
  {#if activity !== null}<ActivityMark {activity} size={14} />{/if}
  <span class="name" dir="auto">{nameOf(activity, 'Choose activity')}</span>
</button>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    height: 26px;
    padding: 0 var(--space-3) 0 var(--space-2);
    border: none;
    border-radius: var(--radius-pill, 99px);
    background: color-mix(in srgb, var(--tint) 18%, transparent);
    color: color-mix(in srgb, var(--tint) 70%, var(--text-strong));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .chip:hover {
      background: color-mix(in srgb, var(--tint) 28%, transparent);
    }
  }
  .none {
    border: 1px dashed var(--line-strong);
    background: none;
    color: var(--muted-strong);
    font-weight: var(--weight-row);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
