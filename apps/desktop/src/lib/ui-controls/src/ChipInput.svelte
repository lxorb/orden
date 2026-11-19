<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { keepFocus } from '../../ui-kit/src/api'
  import {
    carried,
    chipEndingAt,
    chosen,
    type Marked,
    type Offer,
    piecesOf,
    type Spot,
    type Token,
    tokenAt,
  } from './chip-field'

  /* eslint-disable prefer-const -- value, kept and input are bindable, and a $props() pattern cannot be split */
  let {
    value = $bindable(''),
    kept = $bindable([]),
    input = $bindable(),
    chips,
    signs = [],
    offers = () => [],
    class: look = '',
    onkeydown,
    oninput,
    ...rest
  }: Omit<HTMLInputAttributes, 'value' | 'class' | 'onkeydown' | 'oninput'> & {
    value?: string | undefined
    kept?: Spot[] | undefined
    input?: HTMLInputElement | undefined
    chips: readonly Marked[]
    signs?: readonly string[] | undefined
    offers?: ((token: Token) => readonly Offer[]) | undefined
    class?: string | undefined
    onkeydown?: ((event: KeyboardEvent) => void) | undefined
    oninput?: ((event: Event) => void) | undefined
  } = $props()
  /* eslint-enable prefer-const */
  let mirror = $state<HTMLElement>()
  let seen = untrack(() => value)
  let caret = $state(-1)
  let dismissed = $state(-1)
  let active = $state(0)
  $effect.pre(() => {
    const now = value
    if (now === seen) return
    const before = seen
    seen = now
    kept = carried(
      untrack(() => kept),
      before,
      now,
    )
  })
  const pieces = $derived(piecesOf(value, chips))
  const token = $derived(caret >= 0 && signs.length ? tokenAt(value, caret, signs) : null)
  const offered = $derived(token && token.from !== dismissed ? offers(token) : [])
  $effect.pre(() => {
    if (offered.length >= 0) active = 0
  })
  function follow() {
    if (input && mirror) mirror.scrollLeft = input.scrollLeft
    caret = input && input.selectionStart === input.selectionEnd ? (input.selectionStart ?? -1) : -1
  }
  function take(one: Offer) {
    const field = input
    if (!token || !field) return
    const next = chosen(value, token, one.value)
    value = next.text
    void tick().then(() => {
      field.setSelectionRange(next.caret, next.caret)
      follow()
    })
  }
  function offerKey(event: KeyboardEvent): boolean {
    if (!offered.length || event.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const by = event.key === 'ArrowDown' ? 1 : -1
      active = (active + by + offered.length) % offered.length
      return true
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      const one = offered[active]
      if (one === undefined) return false
      event.preventDefault()
      take(one)
      return true
    }
    if (event.key === 'Escape' && token) {
      event.preventDefault()
      event.stopPropagation()
      dismissed = token.from
      return true
    }
    return false
  }
  function unchip(chip: Spot) {
    kept = [...kept, { from: chip.from, to: chip.to }]
  }
  function chipKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Backspace' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false
    const field = input
    if (!field || field.selectionStart !== field.selectionEnd) return false
    const chip = chipEndingAt(chips, field.selectionStart ?? -1)
    if (!chip) return false
    event.preventDefault()
    unchip(chip)
    return true
  }
  function keyed(event: KeyboardEvent) {
    if (offerKey(event) || chipKey(event)) return
    onkeydown?.(event)
  }
  function typed(event: Event) {
    follow()
    oninput?.(event)
  }
  function pressed(event: PointerEvent) {
    if (!mirror) return
    for (const chip of mirror.querySelectorAll<HTMLElement>('[data-chip]')) {
      const box = chip.getBoundingClientRect()
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      ) {
        const from = Number(chip.dataset.from)
        unchip({ from, to: from + chip.textContent.length })
        return
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="chip-input {look}" onpointerdown={pressed}>
  <div class="letters" bind:this={mirror} aria-hidden="true">
    {#each pieces as piece (piece.from)}{#if piece.chip}<span class="chip" data-chip={piece.chip} data-from={piece.from}
          >{piece.text}</span
        >{:else}{piece.text}{/if}{/each}&#8203;
  </div>
  <input
    spellcheck="false"
    autocomplete="off"
    {...rest}
    bind:this={input}
    bind:value
    class="field"
    aria-autocomplete="list"
    aria-expanded={offered.length > 0}
    onkeydown={keyed}
    oninput={typed}
    onscroll={follow}
    onselect={follow}
    onkeyup={follow}
    onclick={follow}
    onfocus={follow}
  />
  {#if offered.length}
    <div class="offers" data-covers role="listbox" aria-label={rest['aria-label'] ?? undefined}>
      {#each offered as one, index (one.value)}
        <button
          type="button"
          class="orden-row is-short"
          class:is-on={index === active}
          role="option"
          aria-selected={index === active}
          data-kind={one.kind}
          tabindex="-1"
          onpointerdown={keepFocus}
          onmousedown={keepFocus}
          onclick={() => take(one)}
        >
          <span class="orden-row-label">{one.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chip-input {
    position: relative;
    min-width: 0;
  }
  .letters,
  .field {
    box-sizing: border-box;
    width: 100%;
    padding: var(--chip-input-pad, var(--space-1));
    border: none;
    font: inherit;
    letter-spacing: normal;
    white-space: pre;
  }
  .letters {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--text-strong);
    pointer-events: none;
  }
  .field {
    position: relative;
    background: none;
    color: transparent;
    caret-color: var(--text-strong);
    outline: none;
  }
  .field:focus {
    box-shadow: none;
  }
  .field::placeholder {
    color: var(--muted);
  }
  .field::selection {
    background: var(--accent-soft);
    color: transparent;
  }
  .chip {
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent-soft);
    color: var(--accent);
  }
  .offers {
    position: absolute;
    top: calc(100% + var(--space-1));
    inset-inline-start: 0;
    z-index: var(--z-popover);
    min-width: 14rem;
    max-width: 100%;
    padding: var(--space-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-md);
  }
</style>
