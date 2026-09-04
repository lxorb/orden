<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appCommands, type Command } from './commands'
  import { t } from './i18n.svelte'
  import { rank } from './fuzzy'
  import { workspace, type Entry } from './workspace.svelte'

  let { open = $bindable(false), view }: { open?: boolean; view?: EditorView } = $props()

  let query = $state('')
  let cursor = $state(0)
  let input = $state<HTMLInputElement>()

  const asCommands = $derived(query.startsWith('>'))
  const term = $derived(asCommands ? query.slice(1).trim() : query.trim())

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  const results = $derived.by((): (Command | Entry)[] => {
    if (asCommands) return rank(term, appCommands(view), (command) => command.label)
    return rank(term, workspace.notes, (note) => stripped(note.name)).slice(0, 40)
  })

  const label = (item: Command | Entry) =>
    'label' in item ? item.label : stripped(item.name)

  $effect(() => {
    void results
    cursor = 0
  })

  $effect(() => {
    if (open) input?.focus()
  })

  function choose(item: Command | Entry) {
    if ('run' in item) {
      if (item.disabled) return
      item.run()
    } else void workspace.open(item.path)

    open = false
    query = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      open = false
      query = ''
      return
    }

    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      cursor = (cursor + 1) % Math.max(results.length, 1)
      return
    }

    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      cursor = (cursor - 1 + results.length) % Math.max(results.length, 1)
      return
    }

    if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault()
      choose(results[cursor])
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 130 }} onclick={() => (open = false)}></div>

  <div class="palette" transition:scale={{ duration: 190, start: 0.97, easing: cubicOut }}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKeydown}
      placeholder={t('Go to note, or > for commands')}
      spellcheck="false"
      aria-label={t('Search notes and commands')}
    />

    {#if results.length}
      <ul>
        {#each results as item, index (label(item) + index)}
          <li>
            <button
              class:selected={index === cursor}
              class:dim={'disabled' in item && item.disabled}
              onmouseenter={() => (cursor = index)}
              onclick={() => choose(item)}
            >
              <span class="text">{label(item)}</span>
              {#if 'hint' in item && item.hint}<kbd>{item.hint}</kbd>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 20;
  }

  .palette {
    position: fixed;
    top: 16vh;
    left: 50%;
    translate: -50% 0;
    width: min(34rem, calc(100vw - 3rem));
    z-index: 21;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  input {
    width: 100%;
    padding: var(--space-4);
    border: none;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
  }

  input::placeholder {
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    max-height: 46vh;
    overflow-y: auto;
  }

  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button.selected {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  button.dim {
    opacity: 0.45;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  kbd {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  @media (max-width: 720px) {
    .palette {
      top: 0;
      left: 0;
      translate: none;
      width: 100%;
      border-radius: 0 0 var(--radius-lg) var(--radius-lg);
      padding-top: env(safe-area-inset-top);
    }
  }
</style>
