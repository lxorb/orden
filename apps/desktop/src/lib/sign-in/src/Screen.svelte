<script lang="ts">
  import type { Snippet } from 'svelte'
  import { showField, viewport } from '../../ui-kit/src/api'

  interface Action {
    label: string
    disabled?: boolean
    busy?: boolean
    onclick: () => void
  }
  interface Props {
    title?: string
    primary?: Action | null
    quiet?: Action | null
    head?: Snippet
    children?: Snippet
    back?: (() => void) | null
  }
  const { title = '', primary = null, quiet = null, head, children, back = null }: Props = $props()
  let body = $state<HTMLElement>()
  function shown() {
    const on = document.activeElement
    if (!body || !(on instanceof HTMLElement) || !body.contains(on)) return
    showField(on, body, body.getBoundingClientRect().bottom)
  }
  $effect(() => {
    if (viewport.keyboard >= 0) shown()
  })
  function pressed(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !primary || primary.disabled || primary.busy) return
    const on = event.target instanceof Element ? event.target : null
    if (on?.closest('button, input, textarea, [contenteditable]')) return
    event.preventDefault()
    primary.onclick()
  }
</script>

<svelte:window onkeydown={pressed} />

<section class="screen" aria-label={title}>
  <div class="top">
    {#if back}
      <button class="back" type="button" onclick={back}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        Back
      </button>
    {/if}
  </div>
  <div class="body" bind:this={body} onfocusin={shown}>
    <div class="col">
      {@render head?.()}
      {#if title}<h1 class="rise">{title}</h1>{/if}
      {@render children?.()}
    </div>
  </div>
  <div class="actions">
    {#if primary}
      <button
        class="orden-button go"
        type="button"
        disabled={(primary.disabled ?? false) || (primary.busy ?? false)}
        aria-busy={primary.busy}
        onclick={primary.onclick}
      >
        {#if primary.busy}<span class="spin" aria-hidden="true"></span>{/if}
        {primary.label}
      </button>
    {/if}
    {#if quiet}
      <button class="orden-button is-quiet skip" type="button" disabled={quiet.disabled} onclick={quiet.onclick}>
        {quiet.label}
      </button>
    {/if}
  </div>
</section>

<style>
  .screen {
    position: absolute;
    inset-block: 0 var(--keyboard, 0px);
    inset-inline: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding-block: calc(var(--inset-top, 0px) + 20px)
      calc(max(0px, var(--inset-bottom, 0px) - var(--keyboard, 0px)) + 28px);
    padding-inline: max(16px, var(--inset-left, 0px)) max(16px, var(--inset-right, 0px));
  }
  .top {
    height: 36px;
    display: flex;
    align-items: center;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--accent);
    font: inherit;
    font-size: 15px;
    min-height: 48px;
    margin-block: -6px;
    padding: 6px 8px 6px 2px;
    border-radius: 8px;
  }
  .back svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .body {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 0;
    overflow-x: clip;
    overflow-y: auto;
  }
  .col {
    margin-block: auto;
    width: min(520px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding-block: 8px;
  }
  h1 {
    margin: 0;
    font-size: clamp(26px, 4.2vw, 34px);
    line-height: 1.12;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-strong);
    text-align: center;
    text-wrap: balance;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 12px;
  }
  .go {
    min-width: min(320px, 100%);
    height: 50px;
    padding: 0 28px;
    border-radius: 14px;
    font-size: 16px;
  }
  .skip {
    color: var(--accent);
    font-size: 15px;
  }
  .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: turn 0.7s linear infinite;
  }
  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
