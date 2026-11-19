<script lang="ts">
  import { Select, Switch } from '../../ui-controls/src/api'
  import { commandLine, type Permission, PERMISSIONS, type ServerView, stateWords } from './mcp'
  import { mcp } from './servers.svelte'

  const { view, onback, onedit }: { view: ServerView; onback: () => void; onedit: () => void } = $props()
  let restarting = $state(false)
  async function restart() {
    restarting = true
    await mcp.restart(view.id)
    restarting = false
  }
  async function remove() {
    if (await mcp.remove(view)) onback()
  }
</script>

<header class="who">
  <button class="orden-glyph back" aria-label="Back" title="Back" onclick={onback}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>
  <span class="title">{view.name}</span>
</header>

<div class="card">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-setting pressable" onclick={() => void mcp.switch(view.id, !view.on)}>
    <span class="name">
      {stateWords(view)}
      <small class="detail">{commandLine(view.transport)}</small>
    </span>
    <Switch on={view.on} label={`Use ${view.name}`} onchange={(on: boolean) => void mcp.switch(view.id, on)} />
  </div>
  {#if view.state === 'failed' && view.error}
    <p class="orden-setting error bad" role="alert">{view.error}</p>
  {/if}
</div>

{#if view.listed.length}
  <h3>Tools</h3>
  <div class="card">
    {#each view.listed as tool (tool.name)}
      <div class="orden-setting">
        <span class="name">
          {tool.title ?? tool.name}
          {#if tool.description}<small>{tool.description}</small>{/if}
        </span>
        <Select
          plain
          label={`Permission for ${tool.name}`}
          value={tool.permission}
          options={PERMISSIONS}
          onchange={(value: string) => void mcp.permission(view.id, tool.name, value as Permission)}
        />
      </div>
    {/each}
  </div>
{:else if view.state === 'ready'}
  <p class="hint">This server offers no tools.</p>
{/if}

<div class="card">
  <button class="orden-action" disabled={restarting || !view.on} onclick={() => void restart()}>Restart</button>
  <button class="orden-action" onclick={onedit}>Edit</button>
  <button class="orden-action is-danger" onclick={() => void remove()}>Remove</button>
</div>

<style>
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .back {
    margin-inline-start: -6px;
  }
  .title {
    flex: 1;
    min-width: 0;
    padding: 3px 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    overflow-wrap: anywhere;
  }
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }
  .detail {
    font-family: var(--font-mono);
  }
  .error {
    margin: 0;
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
