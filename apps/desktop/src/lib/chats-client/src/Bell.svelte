<script lang="ts">
  import type { Notify } from '@orden/chats'
  import { menu } from '../../ui-kit/src/api'
  import { askToShow } from '../../notify/src/api'
  import { bellRows, ringOf } from './bell'

  const {
    notify,
    mutedUntil,
    members,
    onchange,
  }: {
    notify: Notify | null
    mutedUntil: number | null
    members: number
    onchange: (notify: Notify | null, mutedUntil: number | null) => void
  } = $props()
  let now = $state(Date.now())
  $effect(() => {
    const ticking = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(ticking)
  })
  const ring = $derived(ringOf(notify, mutedUntil, members, now))
  function open(event: MouseEvent) {
    askToShow()
    menu.show(event, bellRows(notify, mutedUntil, members, now, onchange))
  }
</script>

<button class="orden-glyph" aria-haspopup="menu" title="Notifications" aria-label="Notifications" onclick={open}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    {#if ring === 'off'}
      <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
      <path d="m2 2 20 20" />
      <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
    {:else}
      <path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
      />
      {#if ring === 'mentions'}
        <circle class="dot" cx="18.5" cy="5.5" r="3" />
      {/if}
    {/if}
  </svg>
</button>

<style>
  .dot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 2;
  }
</style>
