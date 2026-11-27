<script lang="ts">
  import type { ServerView } from './mcp'
  import { mcp } from './servers.svelte'

  const { view }: { view: ServerView } = $props()
  const busy = $derived(mcp.signing === view.id)
</script>

{#if view.signIn !== 'none'}
  <button
    class="orden-chip is-quiet"
    disabled={busy}
    aria-busy={busy}
    onclick={(event) => {
      event.stopPropagation()
      void (view.signIn === 'needed' ? mcp.signIn(view.id) : mcp.signOut(view.id))
    }}
    onkeydown={(event) => event.stopPropagation()}>{view.signIn === 'needed' ? 'Sign in' : 'Sign out'}</button
  >
{/if}
