<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import Pin from 'lucide/dist/esm/icons/pin.mjs'
  import PinOff from 'lucide/dist/esm/icons/pin-off.mjs'
  import Puzzle from 'lucide/dist/esm/icons/puzzle.mjs'
  import Settings from 'lucide/dist/esm/icons/settings.mjs'
  import { dur, fly } from '../motion'
  import { overlays } from '../overlays'
  import { settings } from '../settings.svelte'
  import ExtensionGaps from './ExtensionGaps.svelte'
  import { extensions, type Extension } from './extensions.svelte'

  const {
    right,
    onpress,
    onclose,
  }: {
    right: number
    onpress: (one: Extension) => void
    onclose: () => void
  } = $props()

  let link = $state('')
  let bubble = $state<HTMLElement>()

  $effect(() =>
    overlays.show(onclose, () => [
      bubble,
      ...document.querySelectorAll('[data-opens="extensions"]'),
    ]),
  )

  async function add(event: SubmitEvent) {
    event.preventDefault()
    if (!link.trim()) return
    if (await extensions.install(link.trim())) link = ''
  }
</script>

<div
  bind:this={bubble}
  class="extensions orden-bubble is-pressable"
  style:right="{right}px"
  role="dialog"
  aria-label="Extensions"
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  {#if extensions.list.length}
    <ul>
      {#each extensions.list as one (one.id)}
        <li class:off={!one.enabled}>
          <button
            class="orden-row name"
            disabled={!one.enabled || (!one.popup && !one.options)}
            title={one.name}
            onclick={() => onpress(one)}
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
            <span class="words">{one.name}</span>
          </button>
          {#if one.action && one.enabled}
            <button
              class="orden-glyph"
              class:is-on={one.pinned}
              title={one.pinned ? 'Unpin' : 'Pin'}
              aria-label={one.pinned ? 'Unpin' : 'Pin'}
              aria-pressed={one.pinned}
              onclick={() => void extensions.pin(one.id, !one.pinned)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {#each one.pinned ? Pin : PinOff as [tag, attrs], index (index)}
                  <svelte:element this={tag} {...attrs} />
                {/each}
              </svg>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form onsubmit={add}>
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
  {#if extensions.installing}
    <span class="line sweeping"><span class="done"></span></span>
  {:else if extensions.failed}
    <p class="said">{extensions.failed}</p>
  {:else if extensions.asking}
    <ExtensionGaps gaps={extensions.asking.gaps} asking />
  {/if}

  <button
    class="orden-row manage"
    onclick={() => {
      onclose()
      settings.show('general')
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Settings as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    <span class="words">Manage extensions</span>
  </button>
</div>

<style>
  .extensions {
    position: absolute;
    top: 100%;
    z-index: var(--z-float);
    width: min(20rem, calc(100% - var(--space-4)));
    max-width: none;
    max-height: 60vh;
    overflow-y: auto;
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .name,
  .manage {
    flex: 1;
    min-width: 0;
    color: var(--text);
  }

  .off .name {
    color: var(--muted);
  }

  .name img,
  .name svg,
  .manage svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
  }

  .name svg,
  .manage svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  form {
    display: flex;
    padding: var(--space-1);
  }

  form input {
    flex: 1;
    min-width: 0;
  }

  .said {
    margin: 0;
    padding: 0 var(--space-2);
    color: var(--danger);
    font-size: var(--text-xs);
  }

  .line {
    position: relative;
    height: 2px;
    margin: 0 var(--space-2);
    border-radius: 1px;
    background: var(--line);
    overflow: hidden;
  }

  .done {
    position: absolute;
    inset: 0;
    width: 30%;
    background: var(--accent);
    animation: sweep 1.2s var(--ease-in-out) infinite;
  }

  @keyframes sweep {
    from {
      translate: -100% 0;
    }
    to {
      translate: 340% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .done {
      animation: none;
    }
  }
</style>
