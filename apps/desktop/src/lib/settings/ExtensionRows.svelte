<script lang="ts">
  import { onMount } from 'svelte'
  import Puzzle from 'lucide/dist/esm/icons/puzzle.mjs'
  import Switch from '../Switch.svelte'
  import { dur, slide } from '../motion'
  import { workspace } from '../workspace.svelte'
  import ExtensionGaps from '../web-tab/ExtensionGaps.svelte'
  import { extensions } from '../web-tab/extensions.svelte'

  let opened = $state<string | null>(null)
  let link = $state('')

  onMount(() => void extensions.start())

  async function add(event: SubmitEvent) {
    event.preventDefault()
    if (!link.trim()) return
    if (await extensions.install(link.trim())) link = ''
  }

  async function options(id: string) {
    const page = await extensions.optionsOf(id)
    if (!page) return
    workspace.openPage(page, 'front')
  }
</script>

{#each extensions.list as one (one.id)}
  <div class="orden-setting setting extension">
    <button
      class="name"
      aria-expanded={opened === one.id}
      onclick={() => (opened = opened === one.id ? null : one.id)}
    >
      {#if one.picture}
        <img src={one.picture} alt="" draggable="false" />
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {#each Puzzle as [tag, attrs], index (index)}
            <svelte:element this={tag} {...attrs} />
          {/each}
        </svg>
      {/if}
      <span class="what">
        <span class="named">{one.name}</span>
        {#if one.problem}
          <small class="warn">Did not load</small>
        {:else if one.pending}
          <small>Starts when Orden next opens</small>
        {:else}
          <small>{one.version}</small>
        {/if}
      </span>
    </button>
    <Switch
      on={one.enabled}
      label="Turn {one.name} on or off"
      onchange={(on: boolean) => void extensions.enable(one.id, on)}
    />
  </div>
  {#if opened === one.id}
    <div class="details" transition:slide={{ duration: dur(140) }}>
      {#if one.problem}
        <p class="warn">{one.problem}</p>
      {/if}
      {#if one.gaps}
        <ExtensionGaps gaps={one.gaps} />
      {/if}
      {#if one.permissions.length}
        <ul class="asks" aria-label="Permissions">
          {#each one.permissions as ask (ask)}
            <li>{ask}</li>
          {/each}
        </ul>
      {/if}
      <div class="rows">
        {#if one.options}
          <button class="orden-chip is-quiet" onclick={() => void options(one.id)}>
            Options
          </button>
        {/if}
        <button class="orden-chip is-quiet danger" onclick={() => void extensions.remove(one.id)}>
          Remove
        </button>
      </div>
    </div>
  {/if}
{/each}

<form class="orden-setting setting" onsubmit={add}>
  <input
    class="orden-field"
    type="url"
    bind:value={link}
    placeholder="Paste a Chrome Web Store or Firefox Add-ons link"
    aria-label="Paste a Chrome Web Store or Firefox Add-ons link"
    spellcheck="false"
    autocomplete="off"
    disabled={extensions.installing !== null}
  />
</form>
{#if extensions.failed}
  <p class="warn">{extensions.failed}</p>
{:else if extensions.asking}
  <ExtensionGaps gaps={extensions.asking.gaps} asking />
{/if}

<style>
  .extension .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .extension img,
  .extension svg {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
    object-fit: contain;
  }

  .extension svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .what {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .named {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .warn {
    color: var(--danger);
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 0 var(--space-2) calc(var(--icon-lg) + var(--space-2));
  }

  .details p {
    margin: 0;
    font-size: var(--text-xs);
  }

  .asks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .asks li {
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .rows {
    display: flex;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  form input {
    flex: 1;
    min-width: 0;
  }

  p.warn {
    margin: 0;
    font-size: var(--text-xs);
  }
</style>
