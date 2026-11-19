<script lang="ts">
  import { untrack } from 'svelte'
  import { Cross, segmented } from '../../ui-kit/src/api'
  import { draftOf, madeOf, type ServerView } from './mcp'
  import { mcp } from './servers.svelte'

  const {
    view,
    onback,
    onsaved,
  }: { view: ServerView | null; onback: () => void; onsaved: (made: ServerView) => void } = $props()
  const draft = $state(untrack(() => draftOf(view)))
  let replacing = $state<Record<number, boolean>>({})
  let problem = $state('')
  let saving = $state(false)
  const stdio = $derived(draft.kind === 'stdio')
  function addRow() {
    draft.rows.push({ name: '', value: '', saved: false })
  }
  function dropRow(at: number) {
    draft.rows.splice(at, 1)
    replacing = {}
  }
  async function save() {
    const made = madeOf(draft, view)
    if ('problem' in made) {
      problem = made.problem
      return
    }
    problem = ''
    saving = true
    const saved = await mcp.save(made.server, made.secrets)
    saving = false
    if (saved) onsaved(saved)
  }
</script>

<header class="who">
  <button class="orden-glyph back" aria-label="Back" title="Back" onclick={onback}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>
  <span class="title">{view ? `Edit ${view.name}` : 'Add server'}</span>
</header>

<div class="card">
  <label class="orden-setting">
    <span class="name">Name</span>
    <input
      class="orden-field is-value"
      bind:value={draft.name}
      placeholder="Files"
      aria-label="Name"
      spellcheck="false"
      autocomplete="off"
    />
  </label>
  <div class="orden-setting">
    <span class="name">Runs</span>
    <div class="orden-segmented" role="tablist" use:segmented>
      <button role="tab" class:on={stdio} aria-selected={stdio} onclick={() => (draft.kind = 'stdio')}
        >On this computer</button
      >
      <button role="tab" class:on={!stdio} aria-selected={!stdio} onclick={() => (draft.kind = 'http')}>At a URL</button
      >
    </div>
  </div>
  {#if stdio}
    <label class="orden-setting">
      <span class="name">Command</span>
      <input
        class="orden-field is-value mono"
        bind:value={draft.command}
        placeholder="npx"
        aria-label="Command"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
    <label class="orden-setting">
      <span class="name">Arguments</span>
      <input
        class="orden-field is-value mono"
        bind:value={draft.args}
        placeholder="-y @modelcontextprotocol/server-everything"
        aria-label="Arguments"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
    <label class="orden-setting">
      <span class="name">Working folder</span>
      <input
        class="orden-field is-value mono"
        bind:value={draft.cwd}
        placeholder="Optional"
        aria-label="Working folder"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
  {:else}
    <label class="orden-setting">
      <span class="name">URL</span>
      <input
        class="orden-field is-value mono"
        bind:value={draft.url}
        placeholder="https://example.com/mcp"
        aria-label="URL"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
  {/if}
</div>

<h3>{stdio ? 'Environment variables' : 'Headers'}</h3>
<div class="card">
  {#each draft.rows as row, at (at)}
    <div class="orden-setting pair" role="group" aria-label={row.name || (stdio ? 'Variable' : 'Header')}>
      <input
        class="orden-field is-value mono key"
        bind:value={row.name}
        placeholder={stdio ? 'API_KEY' : 'Authorization'}
        aria-label={stdio ? 'Variable name' : 'Header name'}
        spellcheck="false"
        autocomplete="off"
      />
      {#if row.saved && !replacing[at]}
        <span class="value saved">Saved</span>
        <button class="orden-chip is-quiet" onclick={() => (replacing = { ...replacing, [at]: true })}>Replace</button>
      {:else}
        <input
          class="orden-field is-value mono value"
          type="password"
          bind:value={row.value}
          placeholder={row.saved ? 'New value' : 'Value'}
          aria-label="Value"
          spellcheck="false"
          autocomplete="off"
        />
      {/if}
      <button class="orden-glyph" title="Remove" aria-label="Remove" onclick={() => dropRow(at)}>
        <Cross small />
      </button>
    </div>
  {/each}
  <button class="orden-setting add" onclick={addRow}>
    <span class="orden-setting-mark plus" aria-hidden="true"
      ><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg></span
    >
    <span class="name">{stdio ? 'Add variable' : 'Add header'}</span>
  </button>
</div>

{#if problem}
  <p class="hint bad">{problem}</p>
{/if}

<div class="actions">
  <button class="orden-button is-quiet" onclick={onback}>Cancel</button>
  <button class="orden-button" disabled={saving} onclick={() => void save()}>{view ? 'Save' : 'Add'}</button>
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
  .mono {
    font-family: var(--font-mono);
  }
  .pair {
    gap: var(--space-2);
  }
  .pair .key,
  .pair .value {
    flex: 1;
    min-width: 0;
  }
  .saved {
    flex: 1;
    color: var(--muted-strong);
    font-size: var(--text-sm);
  }
  .plus svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .add:hover {
      color: var(--text-strong);
    }
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
