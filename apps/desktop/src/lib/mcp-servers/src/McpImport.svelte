<script lang="ts">
  import { TickBox } from '../../ui-controls/src/api'
  import { commandLine, type Found, importable, type Pick, said } from './mcp'
  import { mcp } from './servers.svelte'

  const { found, onimported }: { found: Found[]; onimported?: (count: number) => void } = $props()
  const shown = $derived(importable(found))
  const keyOf = (source: string, name: string) => `${source}\u0000${name}`
  let ticks = $state<Record<string, boolean>>({})
  const picks = $derived<Pick[]>(
    shown.flatMap((one) =>
      one.servers
        .filter((server) => !server.already && (ticks[keyOf(one.source, server.name)] ?? true))
        .map((server) => ({ source: one.source, name: server.name })),
    ),
  )
  let busy = $state(false)
  let problem = $state('')
  async function bring() {
    busy = true
    problem = ''
    try {
      const views = await mcp.imported(picks)
      onimported?.(views.length)
    } catch (error) {
      problem = said(error)
    } finally {
      busy = false
    }
  }
</script>

<div class="import">
  {#each shown as one (one.source)}
    <section class="source" aria-label={one.sourceName}>
      <h4>{one.sourceName}</h4>
      <div class="card">
        {#each one.servers as server (server.name)}
          {@const key = keyOf(one.source, server.name)}
          <div class="orden-setting server" class:already={server.already}>
            {#if server.already}
              <span class="name">
                {server.name}
                <small>Already added</small>
              </span>
            {:else}
              <span class="name">
                <TickBox
                  label={server.name}
                  checked={ticks[key] ?? true}
                  onchange={(on: boolean) => (ticks = { ...ticks, [key]: on })}
                />
                <small class="mono">{commandLine(server.transport)}</small>
                {#if server.needsInput.length}
                  <small class="needs">Fill in after import: {server.needsInput.join(', ')}</small>
                {/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}
  {#if problem}
    <p class="hint bad">{problem}</p>
  {/if}
  <div class="actions">
    <button class="orden-button" disabled={busy || picks.length === 0} onclick={() => void bring()}>Import</button>
  </div>
</div>

<style>
  .import,
  .source {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }
  .import {
    gap: var(--space-4);
  }
  .card {
    display: flex;
    flex-direction: column;
  }
  h4 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }
  .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  small {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .needs {
    color: var(--muted-strong);
  }
  .already {
    opacity: 0.55;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .hint.bad {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
