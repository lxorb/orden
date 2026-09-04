<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { type IconNode, loadIcons, search } from './icons'
  import { workspace } from './workspace.svelte'

  let open = $state(false)
  let spaceId = $state<string | null>(null)
  let query = $state('')
  let library = $state<Record<string, IconNode>>({})
  let field = $state<HTMLInputElement>()

  const names = $derived(Object.keys(library))
  const shown = $derived(search(names, query))

  export async function choose(id: string) {
    spaceId = id
    query = ''
    open = true

    library = await loadIcons()
    setTimeout(() => field?.focus(), 40)
  }

  function pick(name: string | null) {
    if (spaceId) workspace.setIcon(spaceId, name)
    open = false
  }

  $effect(() => closeOnBack(open, () => (open = false)))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 130 }} onclick={() => (open = false)}></div>

  <div class="sheet" transition:scale={{ duration: 190, start: 0.97, easing: cubicOut }}>
    <input
      bind:this={field}
      bind:value={query}
      placeholder={t('Search icons - work, journal, money…')}
      spellcheck="false"
      onkeydown={(event) => event.key === 'Escape' && (open = false)}
    />

    {#if !names.length}
      <p class="empty">{t('Loading…')}</p>
    {:else if !shown.length}
      <p class="empty">{t('Nothing found')}</p>
    {:else}
      <div class="grid">
        {#each shown as name (name)}
          <button
            title={name}
            aria-label={name}
            class:active={workspace.iconFor(spaceId) === name}
            onclick={() => pick(name)}
          >
            <svg viewBox="0 0 24 24">
              {#each library[name] as [tag, attrs] (JSON.stringify(attrs))}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {/each}
      </div>
    {/if}

    <button class="clear" onclick={() => pick(null)}>{t('Use the first letter instead')}</button>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 14vh;
    left: 50%;
    translate: -50% 0;
    width: min(30rem, calc(100vw - 3rem));
    z-index: 51;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
    gap: 4px;
    max-height: 46vh;
    overflow-y: auto;
  }

  .grid button {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .grid button:hover {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .grid button.active {
    background: var(--accent);
    color: #fff;
  }

  .grid svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .empty {
    margin: 0;
    padding: var(--space-5) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .clear {
    align-self: flex-start;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .clear:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  @media (max-width: 720px) {
    .sheet {
      top: auto;
      bottom: 0;
      left: 0;
      translate: none;
      width: 100%;
      max-height: 88dvh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    }
  }
</style>
