<script lang="ts">
  import type { Canvas } from './canvas/format'
  import { type Found, matches } from './canvas/find'
  import { t } from './i18n.svelte'
  import Cross from './Cross.svelte'

  const {
    canvas,
    hits,
    label = t('Find on the canvas'),
    onterm,
    onpick,
    onclose,
  }: {
    canvas: Canvas
    hits?: readonly Found[]
    label?: string
    onterm?: (term: string) => void
    onpick: (id: string) => void
    onclose: () => void
  } = $props()

  let term = $state('')
  let at = $state(-1)
  let field = $state<HTMLInputElement>()

  const found = $derived(hits ?? matches(canvas, term))

  $effect(() => {
    onterm?.(term)
  })

  const follows = (_value: unknown) => undefined

  $effect(() => {
    field?.focus()
  })

  $effect(() => {
    follows(found.length)
    at = -1
  })

  function go(step: number) {
    if (!found.length) return

    at = at < 0 ? (step > 0 ? 0 : found.length - 1) : (at + step + found.length) % found.length
    const one = found[at]
    if (one) onpick(one.id)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      go(event.shiftKey ? -1 : 1)
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="orden-bar find"
  onkeydown={onKey}
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
>
  <input
    bind:this={field}
    bind:value={term}
    type="text"
    placeholder={label}
    aria-label={label}
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
  />

  <span class="count">{found.length ? `${Math.max(at + 1, 1)}/${found.length}` : ''}</span>

  <button type="button" aria-label={t('Previous')} title={t('Previous')} onclick={() => go(-1)}>
    <svg viewBox="0 0 14 14"><path d="M4 8.5 7 5.5l3 3" /></svg>
  </button>
  <button type="button" aria-label={t('Next')} title={t('Next')} onclick={() => go(1)}>
    <svg viewBox="0 0 14 14"><path d="M4 5.5 7 8.5l3-3" /></svg>
  </button>
  <button type="button" class="shut" aria-label={t('Close')} title={t('Close')} onclick={onclose}>
    <Cross />
  </button>
</div>

{#if term && found.length}
  <ul
    class="hits"
    onpointerdown={(event) => event.stopPropagation()}
    onpointermove={(event) => event.stopPropagation()}
    onpointerup={(event) => event.stopPropagation()}
  >
    {#each found.slice(0, 12) as one, index (one.id)}
      <li>
        <button
          type="button"
          class:on={index === at}
          onclick={() => {
            at = index
            onpick(one.id)
          }}
        >
          {one.says}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .find {
    position: absolute;
    right: var(--space-3);
    top: var(--space-3);
    z-index: var(--z-bars);
    align-items: center;
    gap: 2px;
  }

  input {
    width: 180px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .count {
    min-width: 34px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  svg,
  .shut :global(svg) {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .hits {
    position: absolute;
    right: var(--space-3);
    top: calc(var(--space-3) + 40px);
    z-index: var(--z-bars);
    width: 280px;
    max-height: 40vh;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    animation: drop var(--dur-fast) var(--ease-out);
  }

  @keyframes drop {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  .hits button {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hits button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
