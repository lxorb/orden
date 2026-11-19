<script lang="ts">
  import { hasRequested, request } from './kept'
  import Logo from './Logo.svelte'

  interface Props {
    name: string
    icon?: string | null
    colour?: string | null
    asked: string
  }
  const { name, icon = null, colour = null, asked }: Props = $props()
  let sent = $derived(hasRequested(asked))
  function ask() {
    request(asked)
    sent = true
  }
</script>

<div class="row">
  <Logo {name} {icon} {colour} size={28} />
  <span class="name">{name}</span>
  {#if sent}
    <span class="o-done" role="status" aria-label="Done">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  {:else}
    <button class="orden-chip o-end" type="button" onclick={ask}>Request</button>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    font-size: 15px;
  }
  .name {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
