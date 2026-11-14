<script lang="ts">
  import Facts from '../../Facts.svelte'
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { region } from '../../platform/src/api'
  import { dur, fly } from '../../platform/src/api'
  import { segmented } from '../../ui-kit/src/api'
  import { ordered } from './chat-parts'
  import type { Effort } from '../../ai-providers/src/api'
  import { usable, ProviderMark, ai } from '../../ai-providers/src/api'
  import { chat } from './chat-parts'
  import { hostHere } from './host'
  import { tokens } from './chat-parts'
  import { effortWord } from './words'

  const here = hostHere()
  const open = $derived(chat.popover === 'model' && chat.host === here)
  const head = $derived(chat.head)
  const provider = $derived(chat.provider)
  const model = $derived(chat.model)
  const providers = $derived(ai.providers.filter((one) => usable(one)))
  const list = $derived(provider ? (chat.models[provider.id] ?? []) : [])
  const levels = $derived<Effort[]>(model ? ordered(model.efforts) : ['auto'])
  const columns = $derived(levels.length <= 5 ? levels.length : Math.ceil(levels.length / 2))

  let query = $state('')
  let lit = $state(0)
  let field = $state<HTMLElement>()

  const shown = $derived.by(() => {
    const want = query.trim().toLowerCase()
    const all = list.length ? list : model ? [model] : []
    return want
      ? all.filter(
          (one) => one.name.toLowerCase().includes(want) || one.id.toLowerCase().includes(want),
        )
      : all
  })

  const label = $derived.by((): string[] => {
    if (!head) return []
    const name = [model?.name, head.model, provider?.name].find(Boolean) ?? ''
    return head.effort === 'auto' ? [name] : [name, effortWord(head.effort)]
  })

  $effect(() => {
    if (!open) return
    untrack(() => {
      query = ''
      lit = Math.max(
        0,
        shown.findIndex((one) => one.id === head?.model),
      )
      if (provider) void chat.loadModels(provider)
    })
    requestAnimationFrame(() => field?.focus())
  })

  function toggle() {
    chat.popover = open ? null : 'model'
  }

  function pick(id: string) {
    if (!provider) return
    void chat.chooseModel(provider.id, id)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      lit = (lit + step + shown.length) % Math.max(1, shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const one = shown[lit]
      if (one) pick(one.id)
      close()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  function close() {
    chat.popover = null
    chat.focus()
  }
</script>

<div class="picker">
  <button
    class="chip"
    class:on={open}
    aria-haspopup="dialog"
    aria-expanded={open}
    disabled={!head || !provider}
    title="Model and effort"
    onclick={toggle}
  >
    <span dir="auto"
      >{#if label.some(Boolean)}<Facts line parts={label} />{:else}Model{/if}</span
    >
    <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
  </button>

  {#if open && head}
    <div
      class="pop orden-layer"
      role="dialog"
      aria-label="Model and effort"
      tabindex="-1"
      onkeydown={onKey}
      transition:fly={{ y: 6, duration: dur(150), easing: cubicOut }}
    >
      {#if providers.length > 1}
        <div class="providers">
          {#each providers as one (one.id)}
            <button
              class="orden-chip provider"
              class:is-on={one.id === provider?.id}
              onclick={() => void chat.chooseModel(one.id, one.model)}
              ><ProviderMark account={one} />{one.name}</button
            >
          {/each}
        </div>
      {/if}

      {#if shown.length > 6 || query}
        <input
          class="orden-field filter"
          bind:this={field}
          bind:value={query}
          placeholder="Model"
          aria-label="Model"
          oninput={() => (lit = 0)}
        />
      {:else}
        <span class="catch" tabindex="-1" bind:this={field}></span>
      {/if}

      <div class="models" role="listbox">
        {#each shown as one, index (one.id)}
          <button
            class="orden-row model"
            class:lit={index === lit}
            role="option"
            aria-selected={one.id === head.model}
            onpointermove={() => (lit = index)}
            onclick={() => {
              pick(one.id)
              close()
            }}
          >
            <span class="orden-row-label">{one.name}</span>
            {#if one.window}<span class="window">{tokens(one.window, region())}</span>{/if}
            <span class="tick" aria-hidden="true">{one.id === head.model ? '✓' : ''}</span>
          </button>
        {/each}
      </div>

      {#if levels.length > 1}
        <div class="line effort">
          <span class="what">Effort</span>
          <div
            class="orden-segmented levels"
            style:grid-template-columns={`repeat(${columns}, 1fr)`}
            role="radiogroup"
            aria-label="Effort"
            use:segmented
          >
            {#each levels as level (level)}
              <button
                type="button"
                class:on={level === head.effort}
                aria-pressed={level === head.effort}
                onclick={() => chat.setEffort(level)}>{effortWord(level)}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      {#if model?.fast}
        <button class="line fast" onclick={() => chat.setFast()}>
          <span class="what">Fast</span>
          <span class="orden-switch" class:on={head.fast}></span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: static;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    height: var(--row-height-sm);
    padding: 0 4px 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip svg {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .chip:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .chip.on {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .pop {
    position: absolute;
    inset-inline-end: var(--space-1);
    bottom: calc(100% + 6px);
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: max-content;
    min-width: min(17rem, calc(100cqw - 2 * var(--space-1)));
    max-width: min(22rem, calc(100cqw - 2 * var(--space-1)));
    padding: var(--space-1);
    outline: none;
  }

  .providers {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: var(--space-1) var(--space-1) 0;
  }

  .provider {
    --mark: var(--icon-sm);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .catch {
    position: absolute;
    outline: none;
  }

  .models {
    display: flex;
    flex-direction: column;
    max-height: 15rem;
    overflow-y: auto;
  }

  .model {
    color: var(--text);
    white-space: nowrap;
  }

  .model.lit {
    background: var(--surface-hover);
    color: var(--item-hover-text-color);
  }

  .window {
    flex: none;
    margin-inline-start: var(--space-3);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .tick {
    flex: none;
    width: 1em;
    margin-inline-start: var(--space-3);
    color: var(--accent);
    font-size: var(--text-sm);
    text-align: end;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-1);
    border: 0;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .what {
    flex: none;
    min-width: 3.5rem;
    color: var(--muted);
    text-align: start;
  }

  .fast {
    justify-content: space-between;
  }

  .effort {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .levels {
    grid-auto-flow: row;
  }

  .levels button {
    min-width: 0;
    padding: 3px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
  }

  .levels button.on {
    color: var(--text-strong);
  }
</style>
