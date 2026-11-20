<script lang="ts">
  import ActivityLayer from './ActivityLayer.svelte'
  import ActivityMark from './ActivityMark.svelte'
  import { nameOf } from './look'

  const {
    value,
    placeholder,
    onpick,
    onmanage,
    strong = false,
  }: {
    value: string | null
    placeholder: string
    onpick: (activity: string) => void
    onmanage?: (() => void) | undefined
    strong?: boolean
  } = $props()
  let open = $state(false)
  let button = $state<HTMLElement | null>(null)
</script>

<button
  type="button"
  class="choose"
  class:strong
  aria-haspopup="listbox"
  aria-expanded={open}
  data-time-pick
  bind:this={button}
  onclick={() => (open = !open)}
>
  {#if value !== null}<ActivityMark activity={value} size={strong ? 18 : 14} />{/if}
  <span class="name" class:none={value === null} dir="auto"
    >{value === null ? placeholder : nameOf(value, placeholder)}</span
  >
  <svg class="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" /></svg>
</button>
{#if open && button}
  <ActivityLayer from={button} chosen={value} {onpick} {onmanage} onclose={() => (open = false)} />
{/if}

<style>
  .choose {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    max-width: 100%;
    min-height: var(--row-height);
    padding: 0 var(--space-2);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .choose:hover {
      border-color: var(--accent);
    }
  }
  .strong {
    font-size: var(--text-base, 1rem);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    color: var(--muted-strong);
  }
  .chevron {
    flex: none;
    width: 9px;
    height: 9px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  [aria-expanded='true'] .chevron {
    transform: rotate(180deg);
  }
</style>
