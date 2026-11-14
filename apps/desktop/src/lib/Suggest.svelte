<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from './platform/src/api'
  import type { Piece } from './palette/pieces'

  const {
    values,
    typed,
    active,
    id,
    label,
    onchoose,
    shown = (value: string) => value,
    aside,
    lead,
    marks,
    badge,
  }: {
    values: string[]
    typed: string
    active: number
    id: string
    label: string
    onchoose: (value: string) => void
    shown?: (value: string) => string
    aside?: (value: string) => string
    lead?: Snippet<[string]>
    marks?: (value: string, shown: string) => Piece[] | null
    badge?: (value: string) => string
  } = $props()

  function piecesOf(value: string, text: string): Piece[] {
    const found = marks?.(value, text)
    if (found) return found
    const { before, hit, after } = split(text)
    return [
      { text: before, hit: false },
      { text: hit, hit: true },
      { text: after, hit: false },
    ].filter((one) => one.text)
  }

  function split(value: string) {
    const at = typed ? value.toLowerCase().indexOf(typed.trim().toLowerCase()) : -1
    if (at === -1) return { before: value, hit: '', after: '' }

    return {
      before: value.slice(0, at),
      hit: value.slice(at, at + typed.trim().length),
      after: value.slice(at + typed.trim().length),
    }
  }
</script>

<ul
  {id}
  class="orden-layer suggest"
  role="listbox"
  aria-label={label}
  transition:fly={{ y: -4, duration: dur(130), easing: cubicOut }}
>
  {#each values as value, index (value)}
    {@const parts = piecesOf(value, shown(value))}
    {@const after = aside?.(value) ?? ''}
    {@const kind = badge?.(value) ?? ''}
    <li role="none">
      <button
        id="{id}-{index}"
        role="option"
        tabindex="-1"
        aria-selected={index === active}
        class:on={index === active}
        onpointerdown={(event) => {
          event.preventDefault()
          onchoose(value)
        }}
      >
        {@render lead?.(value)}
        <span class="words"
          >{#each parts as part, at (at)}{#if part.hit}<span class="matched">{part.text}</span
              >{:else}{part.text}{/if}{/each}
          {#if after}<span class="aside">{after}</span>{/if}</span
        >
        {#if kind}<span class="badge">{kind}</span>{/if}
      </button>
    </li>
  {/each}
</ul>

<style>
  .suggest {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: var(--z-popover);
    max-height: 15em;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px 10px;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:hover,
  button.on {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .words {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .aside {
    margin-inline-start: var(--space-2);
    color: var(--muted);
  }

  button:hover .aside,
  button.on .aside {
    color: var(--muted-strong);
  }

  .badge {
    flex: none;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .matched {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  :global([data-touch]) button {
    min-height: var(--touch-target);
    font-size: var(--text-base);
  }
</style>
