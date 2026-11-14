<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { Copyable } from '../../../ui-controls/src/api'
  import { CopyButton } from '../../../ui-controls/src/api'
  import { dur, slide } from '../../../platform/src/api'
  import { type McpClient, mcpLine } from '../mcp'
  import type { AgentsPane } from '../settings/pane.svelte'

  const {
    pane,
    client,
  }: { pane: AgentsPane; client: 'claude-code' | 'codex' | 'antigravity' | 'other' } = $props()

  const lineOf = (way: typeof client): McpClient =>
    way === 'claude-code' ? 'claude' : way === 'codex' ? 'codex' : 'json'

  let making = $state(false)
  let name = $state('')

  const line = $derived(pane.program === null ? null : mcpLine(pane.program, lineOf(client)))

  function fold() {
    making = !making
    if (making) return
    pane.minted = null
    name = ''
  }
</script>

{#if line !== null}
  {#if client === 'antigravity'}
    <p class="hint">
      In Antigravity, open the … menu at the top of the agent panel, then MCP Servers → Manage MCP
      Servers → View raw config, and add this entry to it.
    </p>
    <pre>{line}</pre>
    <CopyButton value={line} wide />
  {:else if client === 'other'}
    <pre>{line}</pre>
    <CopyButton value={line} wide />
  {:else}
    <Copyable label="Command" value={line} />
  {/if}
{/if}

{#if client === 'other'}
  <button class="disclose" aria-expanded={making} onclick={fold}>
    <svg class="chevron" class:open={making} viewBox="0 0 16 16" aria-hidden="true"
      ><path d="M6 3l5 5-5 5" /></svg
    >
    A client on another machine?
  </button>

  {#if making}
    <div class="made" transition:slide={{ duration: dur(180), easing: cubicOut }}>
      {#if pane.minted}
        <Copyable value={pane.minted.token} />
        <p class="hint">Shown only once.</p>
      {:else}
        <form
          class="make"
          onsubmit={(event) => {
            event.preventDefault()
            void pane.mint(name)
          }}
        >
          <input
            class="named"
            bind:value={name}
            placeholder="Name"
            aria-label="Name"
            spellcheck="false"
            autocomplete="off"
          />
          <button class="orden-chip" type="submit" disabled={!name.trim()}>Create a token</button>
        </form>
      {/if}
    </div>
  {/if}
{/if}

<style>
  pre {
    width: 100%;
    margin: 0;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-x: auto;
    color: var(--muted-strong);
  }

  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .disclose:hover {
      color: var(--text-strong);
    }
  }

  .disclose:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .disclose .chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .disclose .chevron.open {
    transform: rotate(90deg);
  }

  .made {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline-start: 17px;
  }

  .make {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .named {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .named::placeholder {
    color: var(--muted);
  }

  .named:focus {
    background: var(--bg);
  }
</style>
