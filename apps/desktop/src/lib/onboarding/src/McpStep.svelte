<script lang="ts">
  import type { Component } from 'svelte'
  import { mcpImporting } from './bring'
  import Screen from './Screen.svelte'
  import { setup } from './setup-state.svelte'

  interface Props {
    found: readonly unknown[]
    onimported?: (count: number) => void
  }
  let McpImport = $state.raw<Component<Props> | null>(null)
  let imported = $state(0)
  void mcpImporting()
    .picker()
    .then((one) => (McpImport = one.default as Component<Props>))
    .catch(() => setup.next('mcp'))
</script>

<Screen
  title="Bring your MCP servers"
  primary={{ label: 'Continue', disabled: imported === 0, onclick: () => setup.next('mcp') }}
  quiet={imported === 0 ? { label: 'Skip', onclick: () => setup.next('mcp') } : null}
>
  <p class="lead rise">Orden's AI can use the tools of the servers your other apps already reach.</p>
  {#if McpImport}
    <div class="o-pane rise">
      <McpImport found={setup.mcp} onimported={(count) => (imported += count)} />
    </div>
  {/if}
</Screen>

<style>
  .lead {
    margin: 0;
    color: var(--muted);
    font-size: 16px;
    line-height: 1.45;
    text-align: center;
    text-wrap: balance;
  }
</style>
