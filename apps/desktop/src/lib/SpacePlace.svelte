<script lang="ts">
  import type { Snippet } from 'svelte'
  import { keytipIn, keytipOut } from './keytip'
  import { isNumber } from './space-pick'

  const {
    place,
    typed = '',
    held = false,
    children,
  }: {
    place: number
    typed?: string
    held?: boolean
    children: Snippet
  } = $props()

  const number = $derived(String(place + 1))
  const typing = $derived(isNumber(typed))
  const hit = $derived(typing && number.startsWith(typed) ? typed.length : 0)
</script>

<span class="at">
  {@render children()}
  {#if typing || held}
    <span class="orden-keytip place" aria-hidden="true" in:keytipIn out:keytipOut
      >{#if hit}<b>{number.slice(0, hit)}</b>{/if}{number.slice(hit)}</span
    >
  {/if}
</span>

<style>
  .at {
    position: relative;
    flex: none;
    display: flex;
  }

  .place {
    position: absolute;
    inset-inline-end: 0;
    bottom: 0;
    transform: translate(40%, 40%);
  }

  :global(:root[dir='rtl']) .place {
    transform: translate(-40%, 40%);
  }

  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
</style>
